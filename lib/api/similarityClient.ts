import { apiUrl, authHeaders, withAuthQuery } from "./http";

export type SimilarityJobStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";

export interface SimilarityJob {
  id: number;
  uuid: string;
  status: SimilarityJobStatus;
  totalTracks: number;
  processedTracks: number;
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

/** POST /api/v1/similarity/jobs — starts the Smart Shuffle audio-similarity pass. Omitted
 *  `trackIds` means "every track not yet analyzed" — the library backfill case. */
export function createSimilarityJob(trackIds?: number[]): Promise<SimilarityJob> {
  return request("/api/v1/similarity/jobs", { method: "POST", body: JSON.stringify(trackIds ? { trackIds } : {}) });
}

export function fetchSimilarityJob(jobId: number): Promise<SimilarityJob> {
  return request(`/api/v1/similarity/jobs/${jobId}`);
}

export function similarityJobEventsUrl(jobId: number): string {
  return withAuthQuery(`/api/v1/similarity/jobs/${jobId}/events`);
}

export interface SimilarityStatus {
  ready: number;
  total: number;
}

/** GET /api/v1/similarity/status — library-wide tally, not tied to any one job. */
export function fetchSimilarityStatus(): Promise<SimilarityStatus> {
  return request("/api/v1/similarity/status");
}
