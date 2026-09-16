import { apiUrl, authHeaders, withAuthQuery } from "./http";

export type FingerprintJobStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";

export interface FingerprintJob {
  id: number;
  uuid: string;
  status: FingerprintJobStatus;
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

/** POST /api/v1/fingerprint/jobs — starts fingerprinting for mixtape matching. Omitted `trackIds`
 *  means "every track not yet fingerprinted" — the library backfill case. */
export function createFingerprintJob(trackIds?: number[]): Promise<FingerprintJob> {
  return request("/api/v1/fingerprint/jobs", { method: "POST", body: JSON.stringify(trackIds ? { trackIds } : {}) });
}

export function fetchFingerprintJob(jobId: number): Promise<FingerprintJob> {
  return request(`/api/v1/fingerprint/jobs/${jobId}`);
}

export function fingerprintJobEventsUrl(jobId: number): string {
  return withAuthQuery(`/api/v1/fingerprint/jobs/${jobId}/events`);
}

export interface FingerprintStatus {
  ready: number;
  total: number;
}

/** GET /api/v1/fingerprint/status — library-wide tally, not tied to any one job. */
export function fetchFingerprintStatus(): Promise<FingerprintStatus> {
  return request("/api/v1/fingerprint/status");
}
