/** Stage A ("interpret") — the free-text prompt turned into a small structured intent.
 *
 *  The model's job here is narrow on purpose: EXTRACT what the prompt says, don't decide what
 *  matches. Names it reports are resolved against the real `artists` table, genres against the
 *  library's real vocabulary, and the era is re-derived by regex (lib/llm/vibeEra.ts) -- all in
 *  TypeScript, in lib/llm/vibeResolve.ts. A small local model is good at spotting "justin bieber"
 *  in a sentence and bad at judging whether a given track is 90s hip hop, so it is only asked the
 *  first kind of question.
 *
 *  Kept dependency-free so scripts/vibe-eval.mts can load it; the genre vocabulary is passed in
 *  rather than read from the DB here. */
export interface VibeIntent {
  /** Artist/band names written explicitly in the prompt, as written. Resolved in vibeResolve.ts. */
  artists: string[];
  /** Canonical genre tokens, chosen from the injected vocabulary. */
  genres: string[];
  /** Mood/activity/theme words — soft hints only, never a hard filter. */
  keywords: string[];
  yearMin: number | null;
  yearMax: number | null;
}

/** What a tolerated Stage A response looks like before normalization — every field optional, since
 *  a small model that omits an empty array is not worth a second 90s round trip (see isVibeIntent). */
export type RawVibeIntent = Record<string, unknown>;

/**
 * Builds the Stage A system prompt, grounding the model in the genres this library actually has.
 *
 * The vocabulary is injected (~200 tokens) because an ungrounded model invents tags the library has
 * never heard of -- it would answer "lo-fi" for a chill prompt when the only thing `tracks.genre`
 * can say is "Ambient". The 241 ARTIST names are deliberately NOT injected: a list that long invites
 * a small model to copy a plausible-looking name it wasn't asked about, and the deterministic scan
 * in vibeArtistIndex.ts already covers names that are actually present.
 */
export function vibeIntentSystemPrompt(genreVocabulary: string[]): string {
  return `You are a music library query interpreter for a local-first music app. Given a free-text vibe/mood/activity description, output ONLY a JSON object with this shape:
{
  "artists": string[],   // 0-3 artist or band names EXPLICITLY written in the request, copied as written. [] if the request names none. Never guess an artist from a mood or genre.
  "genres": string[],    // 0-4 genres, chosen ONLY from the Allowed genres listed below. [] if none apply.
  "keywords": string[],  // 0-6 lowercase mood, activity, or theme words that might appear in a song title. Never put an artist name or a genre name here.
  "yearMin": number or null,  // only if the request names a decade, era, or year range
  "yearMax": number or null
}

Allowed genres: ${genreVocabulary.join(", ")}

Never include prose, explanation, or markdown — JSON only.`;
}

export const VIBE_INTENT_SCHEMA = {
  name: "vibe_intent",
  schema: {
    type: "object",
    properties: {
      artists: { type: "array", items: { type: "string" } },
      genres: { type: "array", items: { type: "string" } },
      keywords: { type: "array", items: { type: "string" } },
      yearMin: { type: ["number", "null"] },
      yearMax: { type: ["number", "null"] },
    },
    required: ["artists", "genres", "keywords", "yearMin", "yearMax"],
  },
};

/**
 * Deliberately tolerant: accepts any object, because every field is optional and coerced by
 * normalizeVibeIntent below.
 *
 * chatJson treats a `false` here as malformed and burns a second 90s round trip before throwing, so
 * rejecting a response that merely omitted an empty array would cost far more than it saves. A
 * genuinely useless response (`{}`) normalizes to an empty intent, and the deterministic extractors
 * in vibeResolve.ts still run over the raw prompt regardless.
 */
export function isVibeIntent(value: unknown): value is RawVibeIntent {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

/** Years outside this range are a model hallucination, not an era. */
function year(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 1000 && rounded <= 2999 ? rounded : null;
}

export function normalizeVibeIntent(raw: RawVibeIntent): VibeIntent {
  return {
    artists: stringArray(raw.artists, 3),
    genres: stringArray(raw.genres, 4),
    keywords: stringArray(raw.keywords, 6),
    yearMin: year(raw.yearMin),
    yearMax: year(raw.yearMax),
  };
}

/** Stage B ("select") — the LLM picks/orders ids from a real, SQL-fetched candidate list. It must
 *  never invent an id; the caller validates every returned id against the candidate set regardless.
 *
 *  Only runs for genuinely open-ended prompts now. A prompt naming an artist or a decade is resolved
 *  and ranked deterministically (see vibeSelector.ts), because once "justin bieber" is a real artist
 *  id there is nothing left for a model to judge — and every chance for it to wander off. */
export function vibeSelectSystemPrompt(limit: number): string {
  return `You are selecting tracks from a user's own local music library to match a requested vibe. You will be given the request and a list of candidate tracks — each with an id and compact metadata. You may choose ONLY from the ids listed. You must never invent an id or reference any track not in the list — you have no other knowledge of this library.
Order ids in the sequence they should play. Return ONLY JSON: { "trackIds": number[] }.
Pick up to ${limit} tracks that best fit the request. If fewer than ${limit} candidates truly fit, return fewer rather than padding with weak matches.`;
}

export interface VibeSelection {
  trackIds: number[];
}

export const VIBE_SELECT_SCHEMA = {
  name: "vibe_selection",
  schema: {
    type: "object",
    properties: {
      trackIds: { type: "array", items: { type: "number" } },
    },
    required: ["trackIds"],
  },
};

export function isVibeSelection(value: unknown): value is VibeSelection {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.trackIds) && v.trackIds.every((id) => typeof id === "number");
}

/** Compact one-line-per-track serialization to save tokens on small local models — blank fields
 *  when null rather than "genre: null" noise; bpm/key appended only when both present since
 *  analysis is opt-in and frequently missing (see lib/db/trackSummary.ts). */
export function formatVibeCandidate(c: {
  id: number;
  title: string | null;
  artistName: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  key: string | null;
}): string {
  const base = `${c.id}|${c.title ?? ""}|${c.artistName ?? ""}|${c.genre ?? ""}|${c.year ?? ""}`;
  return c.bpm != null && c.key != null ? `${base}|${Math.round(c.bpm)}bpm|${c.key}` : base;
}
