/**
 * Relevance scoring for vibe matching — the replacement for the old pass/fail broadening ladder.
 *
 * The ladder's fatal flaw was that it treated candidate-finding as a filter that had to yield at
 * least MIN_POOL_SIZE rows: a prompt matching exactly one track had that track DISCARDED and was
 * re-run with looser predicates until 20 unrelated ones came back. Scoring has no such failure mode.
 * Every track gets a number, the list is sorted, and a single perfect match simply sits at the top
 * with weaker tracks trailing behind it as filler instead of replacing it.
 *
 * The weights are banded, not tuned:
 *
 *   HARD bands (artist, era) are LEXICOGRAPHIC. Each one's gap is larger than the maximum total of
 *   every band beneath it, so no accumulation of genre/keyword/taste signal can outvote a checkable
 *   fact. This is what stops "90s hiphop" returning a 2014 track and "justin bieber" returning Spice
 *   Girls, and the arithmetic is asserted in scripts/vibe-eval.mts so a later tweak can't quietly
 *   break the ordering.
 *
 *   SOFT bands (genre, keywords, taste, recency) are ADDITIVE and blend freely.
 *
 * Score alone is not the final order, though — see compareCandidates. Banding decides which track
 * wins among those that qualify; TIER decides who qualifies at all. A genre the prompt NAMES is
 * checked in satisfiesHardConstraints rather than merely scored, because scoring it softly meant it
 * was discarded the moment the era constraint alone could fill the batch.
 *
 * Pure: taste and neighbour scores arrive as plain Maps. See the note in lib/text/fuzzy.ts.
 */
import { canonicalizeGenreCell, genreMatchCounts } from "./vibeVocabulary";
import { normalizeLoose } from "../text/fuzzy";
import type { ResolvedVibeFilter } from "./vibeResolve";

// --- Hard bands -------------------------------------------------------------------------------
/** The track is BY a resolved artist. */
export const W_ARTIST_PRIMARY = 1000;
/** The artist is credited in the title or album but isn't the primary artist ("(feat. X)"). */
export const W_ARTIST_CREDIT = 550;
/** Release year falls inside an era the prompt explicitly named. */
export const W_ERA_IN = 200;
/** An era was requested and this track's year is unknown — penalized, but never excluded: an
 *  untagged track is unverified, not disproven, so it ranks below confirmed hits and above misses. */
export const W_ERA_UNKNOWN = -40;
/** An era was requested and this track is verifiably outside it. */
export const W_ERA_OUT = -400;

// --- Expansion band ---------------------------------------------------------------------------
/** Audio-embedding neighbour of the hard-matching tracks, scaled by normalized rank. Sits below
 *  every hard band and above every soft one: "sounds like the Bieber track" beats "is also pop". */
export const W_NEIGHBOUR_MAX = 120;

// --- Soft bands -------------------------------------------------------------------------------
export const W_GENRE_FIRST = 18;
export const W_GENRE_EXTRA = 8;
export const W_GENRE_MAX_EXTRAS = 2;
export const W_GENRE_RELATED = 6;
/** Scaled by the share of the track's own tags that matched. CNN14 emits up to 5 labels per track,
 *  so "Hip Hop" alone is a far more confident claim than "R&B, Pop, Hip Hop" -- without this, both
 *  score identically and the tie falls to taste/recency. */
export const W_GENRE_PRECISION = 8;
export const W_KEYWORD_TITLE = 10;
export const W_KEYWORD_ARTIST = 6;
export const W_KEYWORD_ALBUM = 4;
export const W_KEYWORD_CAP = 25;
/** An era the MODEL inferred rather than one the prompt named — soft by construction. */
export const W_SOFT_ERA_IN = 20;
export const W_TASTE_MAX = 10;
export const W_RECENCY_MAX = 3;
/** Stable within a session, so repeated batches of the same prompt don't return an identical order
 *  while a single session's queue never reshuffles under the listener. */
export const W_JITTER_MAX = 2;

/** Genre can contribute at most this much, however many tokens overlap. W_GENRE_RELATED is excluded
 *  because it only ever applies when nothing matched directly. */
export const W_GENRE_CAP = W_GENRE_FIRST + W_GENRE_MAX_EXTRAS * W_GENRE_EXTRA + W_GENRE_PRECISION;

export type VibeTier = "exact" | "similar" | "broader";

export interface ScoringRow {
  id: number;
  title: string | null;
  artistId: number | null;
  artistName: string | null;
  albumTitle: string | null;
  /** Raw comma-joined `tracks.genre` cell. */
  genre: string | null;
  year: number | null;
  /** Original release year where known (MusicBrainz), which beats a reissue's tag year. Optional so
   *  this module works before that column exists. */
  originalYear?: number | null;
  bpm: number | null;
  key: string | null;
  dateAdded: string;
  similarityReady: boolean;
}

export interface ScoreContext {
  /** id -> 0..1, rank-normalized by the caller (see rankNormalize). */
  tasteScores?: Map<number, number>;
  /** id -> 0..1, rank-normalized by the caller. */
  neighbourScores?: Map<number, number>;
  sessionId?: string;
  now?: number;
}

export interface ScoredCandidate extends ScoringRow {
  score: number;
  tier: VibeTier;
  satisfiesHard: boolean;
  /** Per-band contributions, for the eval script and debugging. Never sent to the client. */
  breakdown: Record<string, number>;
}

/**
 * A reissue's tag year describes the reissue, not the song: this library stores Notorious B.I.G.'s
 * "Big Poppa - 2007 Remaster" as 2007 and The Police's "Roxanne" as 2007. Both are decades older,
 * and both are invisible to an era query that trusts `year`. Where an original release year is
 * known it therefore wins outright.
 */
export function effectiveYear(row: ScoringRow): number | null {
  return row.originalYear ?? row.year ?? null;
}

/**
 * Whether a track satisfies every HARD constraint. Note that an unknown year does NOT satisfy an
 * era request — it is unverified, so it can't be called a match — which is what keeps such tracks
 * out of the "exact" tier while W_ERA_UNKNOWN still ranks them above confirmed misses.
 *
 * With no hard constraints at all, everything satisfies.
 */
export function satisfiesHardConstraints(row: ScoringRow, filter: ResolvedVibeFilter): boolean {
  if (filter.artistIds.length > 0 && !matchesArtist(row, filter)) return false;
  if (filter.era) {
    const year = effectiveYear(row);
    if (year == null || year < filter.era.min || year > filter.era.max) return false;
  }
  if (filter.hardGenres.length > 0 && !matchesHardGenre(row, filter)) return false;
  return true;
}

/**
 * How far down a track's own genre list a named genre may appear and still count as a HARD match.
 *
 * Both sources that populate `tracks.genre` are confidence-ordered: CNN14 sorts by classifier score
 * before truncating (python-backend/services/similarity/genre.py), and MusicBrainz tags are ranked
 * by vote count (lib/musicbrainz/enrichMatch.ts). A leading tag is therefore a claim about what the
 * track IS, while a trailing one is closer to a trace element — and the trailing ones are where the
 * noise lives. Four of this library's Spice Girls tracks carry a genuine, multiply-voted "Hip Hop"
 * MusicBrainz tag in third position behind Pop and Rock; without this they requalify as exact
 * matches for "90s hiphop" and reintroduce the very bug this was written to fix.
 *
 * It only gates the HARD check. A trailing match still earns its soft genre points, so it can still
 * outrank a track that matched nothing.
 */
const HARD_GENRE_LEAD_TOKENS = 2;

/** Any ONE named genre is enough: "drum and bass jungle" asks for either, not both. An untagged
 *  track doesn't match, for the same reason an untagged year doesn't — unverified is not verified. */
function matchesHardGenre(row: ScoringRow, filter: ResolvedVibeFilter): boolean {
  const leading = canonicalizeGenreCell(row.genre).slice(0, HARD_GENRE_LEAD_TOKENS);
  return genreMatchCounts(leading, filter.hardGenres).direct > 0;
}

function matchesArtist(row: ScoringRow, filter: ResolvedVibeFilter): boolean {
  if (row.artistId != null && filter.artistIds.includes(row.artistId)) return true;
  return creditedArtist(row, filter);
}

/** A resolved artist named in the title or album but not the primary artist — remixes, features,
 *  and compilation tracks, which a listener asking for that artist plainly still wants. */
function creditedArtist(row: ScoringRow, filter: ResolvedVibeFilter): boolean {
  if (filter.artistNames.length === 0) return false;
  const haystack = `${normalizeLoose(row.title ?? "")} ${normalizeLoose(row.albumTitle ?? "")}`;
  return filter.artistNames.some((name) => name.length > 0 && haystack.includes(name));
}

/** FNV-1a, so the jitter is deterministic for a given (session, track) rather than re-randomizing
 *  the queue on every replenishment batch. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0xffffffff;
}

/**
 * Turns raw scores into 0..1 by RANK, not by value.
 *
 * The Python side's taste score is a weighted mean cosine with weights summing to 1, so its absolute
 * range is narrow and depends on the library; multiplying it straight into a weight would make the
 * band's real influence unpredictable. Rank spreads it across the full band every time.
 */
export function rankNormalize(entries: [number, number][]): Map<number, number> {
  const out = new Map<number, number>();
  if (entries.length === 0) return out;
  if (entries.length === 1) {
    out.set(entries[0][0], 1);
    return out;
  }
  const sorted = [...entries].sort((a, b) => a[1] - b[1]);
  sorted.forEach(([id], rank) => out.set(id, rank / (sorted.length - 1)));
  return out;
}

function keywordScore(row: ScoringRow, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const title = (row.title ?? "").toLowerCase();
  const artist = (row.artistName ?? "").toLowerCase();
  const album = (row.albumTitle ?? "").toLowerCase();
  let total = 0;
  for (const keyword of keywords) {
    if (title.includes(keyword)) total += W_KEYWORD_TITLE;
    else if (artist.includes(keyword)) total += W_KEYWORD_ARTIST;
    else if (album.includes(keyword)) total += W_KEYWORD_ALBUM;
  }
  return Math.min(total, W_KEYWORD_CAP);
}

function genreScore(row: ScoringRow, genres: string[]): number {
  if (genres.length === 0) return 0;
  const { direct, related, trackTokenCount } = genreMatchCounts(canonicalizeGenreCell(row.genre), genres);
  if (direct === 0) return related > 0 ? W_GENRE_RELATED : 0;
  const breadth = W_GENRE_FIRST + Math.min(direct - 1, W_GENRE_MAX_EXTRAS) * W_GENRE_EXTRA;
  const precision = trackTokenCount > 0 ? W_GENRE_PRECISION * (direct / trackTokenCount) : 0;
  return Math.min(breadth + precision, W_GENRE_CAP);
}

function recencyScore(row: ScoringRow, now: number): number {
  const added = Date.parse(row.dateAdded);
  if (!Number.isFinite(added)) return 0;
  const days = Math.max(0, (now - added) / 86_400_000);
  return W_RECENCY_MAX * Math.exp(-days / 365);
}

/** Scores every row and returns them sorted best-first. */
export function scoreCandidates(rows: ScoringRow[], filter: ResolvedVibeFilter, ctx: ScoreContext = {}): ScoredCandidate[] {
  const now = ctx.now ?? Date.now();
  const sessionId = ctx.sessionId ?? "";

  const scored = rows.map((row): ScoredCandidate => {
    const breakdown: Record<string, number> = {};
    const add = (band: string, value: number) => {
      if (value !== 0) breakdown[band] = (breakdown[band] ?? 0) + value;
    };

    if (filter.artistIds.length > 0) {
      if (row.artistId != null && filter.artistIds.includes(row.artistId)) add("artist", W_ARTIST_PRIMARY);
      else if (creditedArtist(row, filter)) add("artistCredit", W_ARTIST_CREDIT);
    }

    if (filter.era) {
      const year = effectiveYear(row);
      if (year == null) add("eraUnknown", W_ERA_UNKNOWN);
      else if (year >= filter.era.min && year <= filter.era.max) add("era", W_ERA_IN);
      else add("eraOut", W_ERA_OUT);
    } else if (filter.softEra) {
      const year = effectiveYear(row);
      if (year != null && year >= filter.softEra.min && year <= filter.softEra.max) add("softEra", W_SOFT_ERA_IN);
    }

    const neighbour = ctx.neighbourScores?.get(row.id);
    if (neighbour != null) add("neighbour", W_NEIGHBOUR_MAX * neighbour);

    add("genre", genreScore(row, filter.genres));
    add("keyword", keywordScore(row, filter.keywords));

    const taste = ctx.tasteScores?.get(row.id);
    if (taste != null) add("taste", W_TASTE_MAX * taste);
    add("recency", recencyScore(row, now));
    add("jitter", W_JITTER_MAX * hash(`${sessionId}:${row.id}`));

    const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    const satisfiesHard = satisfiesHardConstraints(row, filter);
    const hasSoftRelevance = (breakdown.genre ?? 0) > 0 || (breakdown.keyword ?? 0) > 0 || (breakdown.softEra ?? 0) > 0;

    // "exact" means the track qualified on its own merits: it meets the hard constraints, or --
    // when the prompt set none -- it actually matched something the prompt asked for. Anything
    // reached only through the embedding expansion is "similar"; the rest is score-tail filler.
    let tier: VibeTier;
    if (satisfiesHard && (filter.hasHardConstraint || hasSoftRelevance)) tier = "exact";
    else if (neighbour != null) tier = "similar";
    else tier = "broader";

    return { ...row, score, tier, satisfiesHard, breakdown };
  });

  return scored.sort(compareCandidates);
}

const TIER_RANK: Record<VibeTier, number> = { exact: 0, similar: 1, broader: 2 };

/**
 * Tier first, then score.
 *
 * Tier used to be a label attached to a purely score-ordered list, which made it a description of
 * the result rather than a constraint on it — and the two disagreed exactly when it mattered. Under
 * "90s hiphop" every 1990s track scores W_ERA_IN whether or not it is hip hop, so once the three
 * real matches were used up, the queue filled with 90s pop that outscored every hip hop track from
 * another decade (which pays W_ERA_OUT). Sorting by tier first means the expansion's audio
 * neighbours are reached as soon as the exact pool runs dry, instead of after the entire era.
 *
 * Score still decides everything within a tier, so this changes only what happens at the boundary.
 */
export function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  return TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.score - a.score || a.id - b.id;
}

/**
 * Puts items satisfying `predicate` first, and only falls back to the rest once there aren't
 * `needed` of them.
 *
 * This is the general "never violate a hard constraint while compliant alternatives remain" rule,
 * used to gate Stage B's picks. Playing something slightly off-prompt beats playing silence -- but
 * only after everything on-prompt has been used, and never ahead of it.
 */
export function gateIfSatisfiable<T>(items: T[], predicate: (item: T) => boolean, needed: number): T[] {
  const kept = items.filter(predicate);
  if (kept.length >= needed) return kept;
  return [...kept, ...items.filter((item) => !predicate(item))];
}
