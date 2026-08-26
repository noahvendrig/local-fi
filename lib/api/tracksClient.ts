import type { TrackSummary } from "@/lib/api-client";
import { apiUrl, authHeaders } from "./http";

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
  bpmSource: "tag" | "detected" | "manual" | null;
  keySource: "tag" | "detected" | "manual" | null;
  analysisError: string | null;
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
  bpm?: number | null;
  /** Camelot notation, e.g. "8A". */
  key?: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(url), {
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

export interface CoverUploadResult {
  coverArtUrl: string | null;
  coverEmbedded?: boolean;
  embeddedCount?: number;
  skippedCount?: number;
}

async function uploadCover(url: string, file: File): Promise<CoverUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(apiUrl(url), { method: "PUT", headers: authHeaders(), body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/** PUT /api/v1/tracks/:id/cover — embeds the image in the file when the format allows it. */
export function uploadTrackCover(id: number, file: File): Promise<CoverUploadResult> {
  return uploadCover(`/api/v1/tracks/${id}/cover`, file);
}

/** PUT /api/v1/albums/:id/cover — applies the image to every track in the album. */
export function uploadAlbumCover(id: number, file: File): Promise<CoverUploadResult> {
  return uploadCover(`/api/v1/albums/${id}/cover`, file);
}

/** DELETE /api/v1/tracks/:id — soft-remove by default; `hard` permanently purges the row. */
export function deleteTrack(id: number, hard = false): Promise<void> {
  return request(`/api/v1/tracks/${id}${hard ? "?hard=true" : ""}`, { method: "DELETE" });
}

/** POST /api/v1/tracks/:id/restore — move a trashed track back into the library. */
export function restoreTrack(id: number): Promise<TrackDetail> {
  return request(`/api/v1/tracks/${id}/restore`, { method: "POST" });
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
