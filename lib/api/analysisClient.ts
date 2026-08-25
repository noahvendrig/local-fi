import { authHeaders, withAuthQuery } from "./http";

export type AnalysisJobStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
export type AnalysisJobTrackStatus = "queued" | "analyzing" | "done" | "failed";

export interface AnalysisJob {
  id: number;
  uuid: string;
  status: AnalysisJobStatus;
  totalTracks: number;
  processedTracks: number;
  failedTracks: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AnalysisJobTrack {
  id: number;
  jobId: number;
  trackId: number;
  status: AnalysisJobTrackStatus;
  errorMessage: string | null;
}

export interface AnalysisJobWithTracks extends AnalysisJob {
  tracks: AnalysisJobTrack[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/** POST /api/v1/analysis/jobs — starts on-demand BPM/key detection for the given tracks. */
export function createAnalysisJob(trackIds: number[]): Promise<AnalysisJobWithTracks> {
  return request("/api/v1/analysis/jobs", { method: "POST", body: JSON.stringify({ trackIds }) });
}

export function fetchAnalysisJob(jobId: number): Promise<AnalysisJobWithTracks> {
  return request(`/api/v1/analysis/jobs/${jobId}`);
}

export function cancelAnalysisJob(jobId: number): Promise<AnalysisJobWithTracks> {
  return request(`/api/v1/analysis/jobs/${jobId}/cancel`, { method: "POST" });
}

export function analysisJobEventsUrl(jobId: number): string {
  return withAuthQuery(`/api/v1/analysis/jobs/${jobId}/events`);
}
