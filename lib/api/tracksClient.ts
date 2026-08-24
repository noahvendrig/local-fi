import type { TrackSummary } from "@/lib/api-client";
import { authHeaders } from "./http";

export interface TrackDetail extends TrackSummary {
  trackTotal: number | null;
  discTotal: number | null;
  year: number | null;
  genre: string | null;
  codec: string | null;
  channels: number | null;
  albumArtistId: number | null;
  albumArtistName: string | null;
  waveformUrl: string | null;
  dateModified: string | null;
}

export interface TrackTagPatch {
  title?: string;
  artist?: string;
  album?: string | null;
  albumArtist?: string | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  year?: number | null;
  genre?: string | null;
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

/** GET /api/v1/tracks/:id — full detail incl. resolved album artist (ARCHITECTURE.md §7). */
export function fetchTrack(id: number): Promise<TrackDetail> {
  return request(`/api/v1/tracks/${id}`);
}

/** PATCH /api/v1/tracks/:id — writes tags to the file, then the DB (ARCHITECTURE.md §5/M9). */
export function updateTrack(id: number, patch: TrackTagPatch): Promise<TrackDetail> {
  return request(`/api/v1/tracks/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** DELETE /api/v1/tracks/:id — soft-remove by default; `hard` permanently purges the row (M10). */
export function deleteTrack(id: number, hard = false): Promise<void> {
  return request(`/api/v1/tracks/${id}${hard ? "?hard=true" : ""}`, { method: "DELETE" });
}

/** POST /api/v1/tracks/:id/relink — re-verifies (or re-points) a missing track (M10). */
export function relinkTrack(id: number, path?: string): Promise<TrackDetail> {
  return request(`/api/v1/tracks/${id}/relink`, { method: "POST", body: JSON.stringify({ path }) });
}

/** POST /api/v1/tracks/:id/reveal — opens the OS file explorer at the track's file (M8, desktop-only). */
export function revealTrackInFolder(id: number): Promise<void> {
  return request(`/api/v1/tracks/${id}/reveal`, { method: "POST" });
}

/** POST /api/v1/tracks/:id/play — records a completed listen, powering the Home dashboard. */
export function recordPlay(id: number): Promise<void> {
  return request(`/api/v1/tracks/${id}/play`, { method: "POST" });
}
