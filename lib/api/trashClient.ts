import type { Page, TrackSummary } from "@/lib/api-client";
import { authHeaders } from "./http";

export interface TrashedTrack extends TrackSummary {
  deletedAt: string;
  daysRemaining: number;
}

export interface TrashPage extends Page<TrashedTrack> {
  total: number;
  graceDays: number;
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

/** GET /api/v1/trash — soft-deleted tracks waiting for restore or the grace-period sweep. */
export function fetchTrash(params: { limit?: number; cursor?: string } = {}): Promise<TrashPage> {
  const search = new URLSearchParams();
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return request(`/api/v1/trash${qs ? `?${qs}` : ""}`);
}

/** DELETE /api/v1/trash — permanently purge every trashed track. */
export function emptyTrash(): Promise<{ purged: number }> {
  return request("/api/v1/trash", { method: "DELETE" });
}
