import { apiUrl, authHeaders, withAuthQuery } from "./http";

export type SpotifyEnrichJobStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";

export interface SpotifyEnrichJob {
  id: number;
  uuid: string;
  status: SpotifyEnrichJobStatus;
  totalTracks: number;
  processedTracks: number;
  matchedTracks: number;
  failedTracks: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...authHeaders(), ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/** POST /api/v1/spotify/enrich/jobs — backfills genre/release-year for tracks missing either,
 *  never overwriting a value that's already set. Omitted `trackIds` means "every track missing
 *  genre or year", the Settings library-backfill case. */
export function createSpotifyEnrichJob(trackIds?: number[]): Promise<SpotifyEnrichJob> {
  return request("/api/v1/spotify/enrich/jobs", { method: "POST", body: JSON.stringify(trackIds ? { trackIds } : {}) });
}

export function spotifyEnrichJobEventsUrl(jobId: number): string {
  return withAuthQuery(`/api/v1/spotify/enrich/jobs/${jobId}/events`);
}

export interface SpotifyEnrichStatus {
  missing: number;
  total: number;
}

/** GET /api/v1/spotify/enrich/status — library-wide tally, not tied to any one job. */
export function fetchSpotifyEnrichStatus(): Promise<SpotifyEnrichStatus> {
  return request("/api/v1/spotify/enrich/status");
}
