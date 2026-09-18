import { apiUrl, authHeaders } from "./http";

export interface LyricLine {
  timeSeconds: number;
  text: string;
}

export type LyricsResponse = { found: true; synced: LyricLine[] | null; plain: string | null } | { found: false };

/** GET /api/v1/tracks/:id/lyrics — never throws on "not found"; a non-OK response (network hiccup,
 *  track deleted mid-request, ...) also just resolves to "not found" so the caller can treat every
 *  outcome as a plain found/not-found check. */
export async function fetchLyrics(trackId: number): Promise<LyricsResponse> {
  const res = await fetch(apiUrl(`/api/v1/tracks/${trackId}/lyrics`), { headers: authHeaders() });
  if (!res.ok) return { found: false };
  return (await res.json()) as LyricsResponse;
}
