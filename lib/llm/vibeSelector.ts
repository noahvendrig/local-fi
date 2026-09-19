import { and, desc, eq, gte, isNull, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { chatJson } from "@/lib/ollama/client";
import { OllamaMalformedResponseError } from "@/lib/ollama/errors";
import type { TrackSummary } from "@/lib/api-client";
import { getDb } from "@/lib/db/client";
import { albums, artists, tracks } from "@/lib/db/schema";
import { getTrackSummariesByIds } from "@/lib/db/trackSummary";
import {
  VIBE_FILTER_SCHEMA,
  VIBE_FILTER_SYSTEM_PROMPT,
  VIBE_SELECT_SCHEMA,
  formatVibeCandidate,
  isVibeFilter,
  isVibeSelection,
  vibeSelectSystemPrompt,
  type VibeFilter,
} from "./vibePrompts";

const SQL_POOL_LIMIT = 500;
const STAGE_B_MAX_CANDIDATES = 120;
const MIN_POOL_SIZE = 20;

interface Candidate {
  id: number;
  title: string | null;
  artistName: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  key: string | null;
}

const candidateColumns = {
  id: tracks.id,
  title: tracks.title,
  artistName: artists.name,
  genre: tracks.genre,
  year: tracks.year,
  bpm: tracks.bpm,
  key: tracks.key,
};

function genreCondition(keywords: string[]): SQL | undefined {
  if (keywords.length === 0) return undefined;
  const clauses = keywords.map((kw) => sql`lower(coalesce(${tracks.genre}, '')) LIKE ${`%${kw.toLowerCase()}%`}`);
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

function textCondition(keywords: string[]): SQL | undefined {
  if (keywords.length === 0) return undefined;
  const clauses = keywords.map(
    (kw) =>
      sql`(lower(coalesce(${tracks.title}, '')) LIKE ${`%${kw.toLowerCase()}%`} OR lower(coalesce(${artists.name}, '')) LIKE ${`%${kw.toLowerCase()}%`} OR lower(coalesce(${albums.title}, '')) LIKE ${`%${kw.toLowerCase()}%`})`
  );
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

/** Runs one candidate-pool query stage. `extra` conditions are AND'd onto the always-present
 *  isNull(deletedAt)/excludeIds guard; omitting `extra` entirely is the last-resort broad-sample
 *  stage (most recently added tracks, library-wide). */
function queryCandidates(excludeIds: number[], extra: SQL | undefined): Candidate[] {
  const base: SQL[] = [isNull(tracks.deletedAt)];
  if (excludeIds.length > 0) base.push(notInArray(tracks.id, excludeIds));
  if (extra) base.push(extra);

  return getDb()
    .select(candidateColumns)
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(and(...base))
    .orderBy(desc(tracks.dateAdded))
    .limit(SQL_POOL_LIMIT)
    .all();
}

/** Progressive broadening so Stage B always has real candidates to choose from, even for a very
 *  narrow prompt or a small/sparsely-tagged library: genre+year+text -> drop year -> drop genre,
 *  keep text -> OR genre/text instead of AND -> ignore all filters (broadest recent sample). */
function buildCandidatePool(filter: VibeFilter, excludeIds: number[]): Candidate[] {
  const genreCond = genreCondition(filter.genreKeywords);
  const textCond = textCondition(filter.textKeywords);
  const yearCond =
    filter.yearMin != null && filter.yearMax != null
      ? and(gte(tracks.year, filter.yearMin), lte(tracks.year, filter.yearMax))
      : filter.yearMin != null
        ? gte(tracks.year, filter.yearMin)
        : filter.yearMax != null
          ? lte(tracks.year, filter.yearMax)
          : undefined;

  const stages: (SQL | undefined)[] = [
    and(...[genreCond, yearCond, textCond].filter((c): c is SQL => c != null)),
    and(...[genreCond, textCond].filter((c): c is SQL => c != null)),
    textCond,
    genreCond && textCond ? or(genreCond, textCond) : (genreCond ?? textCond),
    undefined, // last resort: no filter at all
  ];

  let best: Candidate[] = [];
  for (const stage of stages) {
    const rows = queryCandidates(excludeIds, stage);
    if (rows.length >= MIN_POOL_SIZE) return rows;
    if (rows.length > best.length) best = rows;
  }
  return best;
}

export interface SelectVibeTracksResult {
  tracks: TrackSummary[];
  usedFallback: boolean;
}

/**
 * The shared core behind both vibe features (prompt->crate and Vibe Radio): turns a free-text
 * prompt into a real, ordered track list from the user's own library. Two Ollama calls —
 * interpret the prompt into a structured filter, then pick/order ids from a real SQL-fetched
 * candidate pool built from that filter. The LLM is never allowed to invent a track: every
 * returned id is validated against the candidate set before use, and any JSON/shape failure
 * degrades to a non-LLM fallback rather than erroring outright.
 */
export async function selectVibeTracks(
  prompt: string,
  opts: { excludeIds?: number[]; limit?: number; model: string }
): Promise<SelectVibeTracksResult> {
  const excludeIds = opts.excludeIds ?? [];
  const limit = opts.limit ?? 30;
  let usedFallback = false;

  let filter: VibeFilter;
  try {
    filter = await chatJson({
      model: opts.model,
      system: VIBE_FILTER_SYSTEM_PROMPT,
      user: prompt,
      schema: VIBE_FILTER_SCHEMA,
      temperature: 0.2,
      validate: isVibeFilter,
    });
  } catch (err) {
    if (!(err instanceof OllamaMalformedResponseError)) throw err; // unreachable -> propagate
    // Naive keyword split so a malformed Stage A still yields a usable filter (excludes a small
    // stopword set so "songs for a rainy 2am drive" doesn't just search for "for"/"a").
    usedFallback = true;
    const stopwords = new Set(["a", "an", "the", "for", "of", "to", "and", "or", "songs", "music", "some"]);
    const textKeywords = prompt
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !stopwords.has(w));
    filter = { genreKeywords: [], textKeywords, yearMin: null, yearMax: null };
  }

  const pool = buildCandidatePool(filter, excludeIds);
  if (pool.length === 0) return { tracks: [], usedFallback };

  const trimmed = pool.slice(0, STAGE_B_MAX_CANDIDATES);
  const candidateIds = new Set(trimmed.map((c) => c.id));

  let orderedIds: number[];
  try {
    const selection = await chatJson({
      model: opts.model,
      system: vibeSelectSystemPrompt(limit),
      user: `"${prompt}"\n\nCandidates:\n${trimmed.map(formatVibeCandidate).join("\n")}`,
      schema: VIBE_SELECT_SCHEMA,
      temperature: 0.3,
      validate: isVibeSelection,
    });
    // Never trust an LLM id blindly — filter against the real candidate set and dedupe.
    const seen = new Set<number>();
    orderedIds = selection.trackIds.filter((id) => candidateIds.has(id) && !seen.has(id) && seen.add(id)).slice(0, limit);
  } catch (err) {
    if (!(err instanceof OllamaMalformedResponseError)) throw err; // unreachable -> propagate
    usedFallback = true;
    orderedIds = trimmed.slice(0, limit).map((c) => c.id);
  }

  if (orderedIds.length === 0) {
    usedFallback = true;
    orderedIds = trimmed.slice(0, limit).map((c) => c.id);
  }

  return { tracks: getTrackSummariesByIds(getDb(), orderedIds), usedFallback };
}
