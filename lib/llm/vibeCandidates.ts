/**
 * The DB half of vibe matching: loading the rows the scorer ranks, plus the two small lookups that
 * ground the Stage A prompt and the artist resolver.
 *
 * Kept separate from vibeScore.ts/vibeResolve.ts so those stay pure and loadable by
 * scripts/vibe-eval.mts. Everything here touches Drizzle; nothing here makes a decision.
 *
 * Note what is NOT here any more: the old `buildCandidatePool` broadening ladder, `SQL_POOL_LIMIT`
 * and `MIN_POOL_SIZE`. Candidate selection is no longer a filter that has to yield 20 rows -- the
 * scorer ranks whatever it is given, so this just hands over the library.
 */
import { and, eq, desc, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client";
import { albums, artists, tracks } from "../db/schema";
import { buildGenreVocabulary } from "./vibeVocabulary";
import { buildArtistIndex, type ArtistIndexEntry } from "./vibeArtistIndex";
import type { ResolvedVibeFilter } from "./vibeResolve";
import { satisfiesHardConstraints, type ScoringRow } from "./vibeScore";

/**
 * Below this, every active track is scored -- no LIMIT, no ORDER BY. This library has 447 tracks, so
 * that is the normal path, and it is what removes the old ladder's structural recency bias (every
 * stage was `ORDER BY date_added DESC LIMIT 500`, which silently made older matches unreachable in a
 * larger library regardless of the prompt). 11 small columns x 20k rows is a few MB and a few ms.
 */
const FULL_SCAN_MAX_ROWS = 20_000;
/** Broad-sample rows unioned into the prefilter path, so a prompt with no usable predicate still has
 *  something to rank in a very large library. */
const PREFILTER_FILLER_ROWS = 2_000;

const scoringColumns = {
  id: tracks.id,
  title: tracks.title,
  artistId: tracks.artistId,
  artistName: artists.name,
  albumTitle: albums.title,
  genre: tracks.genre,
  year: tracks.year,
  originalYear: tracks.originalYear,
  bpm: tracks.bpm,
  key: tracks.key,
  dateAdded: tracks.dateAdded,
  similarityStatus: tracks.similarityStatus,
};

type ScoringQueryRow = {
  id: number;
  title: string | null;
  artistId: number | null;
  artistName: string | null;
  albumTitle: string | null;
  genre: string | null;
  year: number | null;
  originalYear: number | null;
  bpm: number | null;
  key: string | null;
  dateAdded: string;
  similarityStatus: string;
};

function toScoringRow(row: ScoringQueryRow): ScoringRow {
  const { similarityStatus, ...rest } = row;
  return { ...rest, similarityReady: similarityStatus === "ready" };
}

/** The genre tokens this library actually uses, most-used first — injected into the Stage A prompt
 *  so the model picks from what exists rather than inventing tags nothing is tagged with. */
export function getGenreVocabulary(): string[] {
  const rows = getDb().select({ genre: tracks.genre }).from(tracks).where(isNull(tracks.deletedAt)).all();
  return buildGenreVocabulary(rows.map((r) => r.genre));
}

/** Rebuilt per request: 241 rows is about a millisecond, which is cheaper than owning a cache
 *  invalidation problem on a table that changes on every import. */
export function loadArtistIndex(): ArtistIndexEntry[] {
  return buildArtistIndex(getDb().select({ id: artists.id, name: artists.name }).from(artists).all());
}

function baseConditions(excludeIds: number[]): SQL[] {
  const conditions: SQL[] = [isNull(tracks.deletedAt)];
  if (excludeIds.length > 0) conditions.push(notInArray(tracks.id, excludeIds));
  return conditions;
}

function activeTrackCount(): number {
  const row = getDb()
    .select({ count: sql<number>`count(*)` })
    .from(tracks)
    .where(isNull(tracks.deletedAt))
    .get();
  return row?.count ?? 0;
}

/** Predicates that could plausibly make a row relevant. Only used on the large-library path — it is
 *  a recall net, not a filter: anything it lets through still has to earn its rank from the scorer. */
function relevanceConditions(filter: ResolvedVibeFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.artistIds.length > 0) conditions.push(inArray(tracks.artistId, filter.artistIds));
  const era = filter.era ?? filter.softEra;
  if (era) conditions.push(sql`coalesce(${tracks.originalYear}, ${tracks.year}) between ${era.min} and ${era.max}`);
  for (const genre of filter.genres) {
    conditions.push(sql`lower(coalesce(${tracks.genre}, '')) like ${`%${genre.toLowerCase()}%`}`);
  }
  for (const keyword of [...filter.keywords, ...filter.artistNames]) {
    const like = `%${keyword.toLowerCase()}%`;
    conditions.push(
      sql`(lower(coalesce(${tracks.title}, '')) like ${like} or lower(coalesce(${artists.name}, '')) like ${like} or lower(coalesce(${albums.title}, '')) like ${like})`
    );
  }
  return conditions;
}

function selectRows(where: SQL | undefined, limit?: number): ScoringRow[] {
  const query = getDb()
    .select(scoringColumns)
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(where);
  const rows = (limit == null ? query.all() : query.orderBy(desc(tracks.dateAdded)).limit(limit).all()) as ScoringQueryRow[];
  return rows.map(toScoringRow);
}

/** The rows to rank for this prompt. */
export function fetchScoringRows(filter: ResolvedVibeFilter, excludeIds: number[]): ScoringRow[] {
  const base = baseConditions(excludeIds);

  if (activeTrackCount() <= FULL_SCAN_MAX_ROWS) return selectRows(and(...base));

  // Large library: narrow to plausibly-relevant rows, then union a recent sample so a prompt with no
  // usable predicate is still answerable. Deduped by id, since the two halves overlap.
  const relevance = relevanceConditions(filter);
  const matched = relevance.length > 0 ? selectRows(and(...base, or(...relevance)!)) : [];
  const filler = selectRows(and(...base), PREFILTER_FILLER_ROWS);
  const byId = new Map<number, ScoringRow>();
  for (const row of [...matched, ...filler]) byId.set(row.id, row);
  return [...byId.values()];
}

/**
 * Ids satisfying the HARD constraints, deliberately ignoring `excludeIds`.
 *
 * These are the seeds for the embedding expansion, and they must be computed from the constraint
 * alone: by the second batch of a "justin bieber" session the one Bieber track is already excluded,
 * so an exclude-aware seed query would return nothing and the expansion would silently fall back to
 * unrelated tracks -- which is exactly how the queue used to drift. `excludeIds` is applied to the
 * expansion's RESULTS instead (see vibeSelector.ts).
 *
 * Only similarity-ready tracks are returned, since a track with no embedding cannot seed a search.
 *
 * The SQL below is a RECALL NET, not the decision: `satisfiesHardConstraints` makes the actual call,
 * in TypeScript, so the seeds are exactly the tracks the scorer would call exact matches. Letting
 * SQL decide was tried and is subtly wrong -- `genre LIKE '%hip hop%'` also matches the four Spice
 * Girls tracks carrying a third-position "Hip Hop" tag, which the scorer's leading-token rule
 * rejects. The expansion then seeded from those and faithfully filled the queue with more music
 * that sounds like Spice Girls: the original bug, wearing the fix as a disguise.
 */
export function fetchHardMatchSeedIds(filter: ResolvedVibeFilter, limit: number): number[] {
  if (!filter.hasHardConstraint) return [];
  const conditions: SQL[] = [isNull(tracks.deletedAt), eq(tracks.similarityStatus, "ready")];
  if (filter.artistIds.length > 0) conditions.push(inArray(tracks.artistId, filter.artistIds));
  if (filter.era) conditions.push(sql`coalesce(${tracks.originalYear}, ${tracks.year}) between ${filter.era.min} and ${filter.era.max}`);
  if (filter.hardGenres.length > 0) {
    const genreMatches = filter.hardGenres.map((genre) => sql`lower(coalesce(${tracks.genre}, '')) like ${`%${genre.toLowerCase()}%`}`);
    conditions.push(or(...genreMatches)!);
  }

  const rows = getDb()
    .select(scoringColumns)
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(and(...conditions))
    .orderBy(desc(tracks.playCount), desc(tracks.dateAdded))
    .all() as ScoringQueryRow[];

  return rows
    .map(toScoringRow)
    .filter((row) => satisfiesHardConstraints(row, filter))
    .slice(0, limit)
    .map((row) => row.id);
}
