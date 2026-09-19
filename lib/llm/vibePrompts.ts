/** Stage A ("interpret") — the free-text prompt turned into a small structured filter. Kept loose
 *  (keywords, not an enum) since tracks.genre is free text and there's no mood/energy column to
 *  target more precisely (see lib/db/schema.ts's tracks table). */
export interface VibeFilter {
  genreKeywords: string[];
  textKeywords: string[];
  yearMin: number | null;
  yearMax: number | null;
}

export const VIBE_FILTER_SYSTEM_PROMPT = `You are a music library query interpreter for a local-first music app. Given a free-text vibe/mood/activity description, output ONLY a JSON object with this shape:
{
  "genreKeywords": string[],  // 0-4 short, generic genre words that might appear in a genre tag (e.g. "lo-fi", "house", "jazz") — never artist/song names
  "textKeywords": string[],   // 0-6 lowercase words/phrases that might appear in a track, artist, or album name (mood words, named artists, activity, era)
  "yearMin": number or null,  // only set if the prompt clearly implies a decade/era
  "yearMax": number or null
}
Never include prose, explanation, or markdown — JSON only.`;

export const VIBE_FILTER_SCHEMA = {
  name: "vibe_filter",
  schema: {
    type: "object",
    properties: {
      genreKeywords: { type: "array", items: { type: "string" } },
      textKeywords: { type: "array", items: { type: "string" } },
      yearMin: { type: ["number", "null"] },
      yearMax: { type: ["number", "null"] },
    },
    required: ["genreKeywords", "textKeywords", "yearMin", "yearMax"],
  },
};

export function isVibeFilter(value: unknown): value is VibeFilter {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.genreKeywords) &&
    v.genreKeywords.every((k) => typeof k === "string") &&
    Array.isArray(v.textKeywords) &&
    v.textKeywords.every((k) => typeof k === "string") &&
    (v.yearMin === null || typeof v.yearMin === "number") &&
    (v.yearMax === null || typeof v.yearMax === "number")
  );
}

/** Stage B ("select") — the LLM picks/orders ids from a real, SQL-fetched candidate list. It must
 *  never invent an id; the caller validates every returned id against the candidate set regardless. */
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
