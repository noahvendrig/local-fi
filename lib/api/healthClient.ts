import type { TrackSummary } from "@/lib/api-client";
import type { ImportJob } from "./types";
import { authHeaders } from "./http";

export interface HealthReport {
  missingCount: number;
  duplicateGroupCount: number;
  pendingWaveformCount: number;
}

export interface DuplicateGroup {
  key: string;
  keeperId: number;
  tracks: TrackSummary[];
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
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function fetchHealthReport(): Promise<HealthReport> {
  return request(`/api/v1/health/report`);
}

export function fetchMissingTracks(cursor?: string): Promise<{ items: TrackSummary[]; nextCursor: string | null }> {
  return request(`/api/v1/health/missing${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
}

export function fetchDuplicateGroups(params: { cursor?: string; limit?: number } = {}): Promise<{ items: DuplicateGroup[]; nextCursor: string | null }> {
  const search = new URLSearchParams();
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return request(`/api/v1/health/duplicates${qs ? `?${qs}` : ""}`);
}

/** POST /api/v1/health/duplicates/remove — keep the best copy, move extras to trash. */
export function removeDuplicateExtras(groupKey?: string): Promise<{ removed: number; removedIds: number[] }> {
  return request("/api/v1/health/duplicates/remove", {
    method: "POST",
    body: JSON.stringify(groupKey ? { groupKey } : {}),
  });
}

/** POST /api/v1/scan — triggers a library rescan; runs synchronously and returns the completed job. */
export function triggerScan(): Promise<ImportJob> {
  return request(`/api/v1/scan`, { method: "POST" });
}
