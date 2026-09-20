import { apiUrl, authHeaders, withAuthQuery } from "./http";

export type MusicbrainzEnrichJobStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";

export interface MusicbrainzEnrichJob {
  id: number;
  uuid: string;
  status: MusicbrainzEnrichJobStatus;
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

/** POST /api/v1/musicbrainz/enrich/jobs — fills in original release year and a curated genre.
 *  Omitted `trackIds` means the whole library, the Settings backfill case. */
export function createMusicbrainzEnrichJob(trackIds?: number[]): Promise<MusicbrainzEnrichJob> {
  return request("/api/v1/musicbrainz/enrich/jobs", { method: "POST", body: JSON.stringify(trackIds ? { trackIds } : {}) });
}

export function cancelMusicbrainzEnrichJob(jobId: number): Promise<MusicbrainzEnrichJob> {
  return request(`/api/v1/musicbrainz/enrich/jobs/${jobId}/cancel`, { method: "POST" });
}

export function musicbrainzEnrichJobEventsUrl(jobId: number): string {
  return withAuthQuery(`/api/v1/musicbrainz/enrich/jobs/${jobId}/events`);
}

export interface MusicbrainzEnrichStatus {
  /** Tracks a run could still improve — see the route's doc comment for why this isn't "field is empty". */
  eligible: number;
  total: number;
  missingOriginalYear: number;
  /** Tracks whose genre is still CNN14's audio guess rather than a catalog or file tag. */
  detectedGenre: number;
}

/** GET /api/v1/musicbrainz/enrich/status — library-wide tally, not tied to any one job. */
export function fetchMusicbrainzEnrichStatus(): Promise<MusicbrainzEnrichStatus> {
  return request("/api/v1/musicbrainz/enrich/status");
}
