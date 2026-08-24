import type { TrackSummary } from "@/lib/api-client";
import type { RuleGroup } from "@/lib/crates/rules";
import { authHeaders } from "./http";

export type PlaylistType = "manual" | "smart";

export interface Playlist {
  id: number;
  uuid: string;
  name: string;
  type: PlaylistType;
  description: string | null;
  rulesJson: RuleGroup | null;
  sortField: string | null;
  coverArtUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistSummary extends Playlist {
  trackCount: number;
}

export interface PlaylistTrackItem extends TrackSummary {
  /** playlist_tracks.id — null for a smart crate's live-evaluated (non-persisted) rows. */
  entryId: number | null;
  position: string | null;
}

export interface PlaylistDetail extends Playlist {
  tracks: PlaylistTrackItem[];
}

export interface PlaylistTrackEntry {
  id: number;
  playlistId: number;
  trackId: number;
  position: string;
  addedAt: string;
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

export function fetchPlaylists(params: { type?: PlaylistType; q?: string; limit?: number } = {}): Promise<{ items: PlaylistSummary[] }> {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.q) search.set("q", params.q);
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return request(`/api/v1/playlists${qs ? `?${qs}` : ""}`);
}

export function fetchPlaylist(id: number): Promise<PlaylistDetail> {
  return request(`/api/v1/playlists/${id}`);
}

export function createPlaylist(body: {
  name: string;
  type: PlaylistType;
  description?: string;
  rulesJson?: RuleGroup;
  sortField?: string;
}): Promise<Playlist> {
  return request(`/api/v1/playlists`, { method: "POST", body: JSON.stringify(body) });
}

export function updatePlaylist(
  id: number,
  body: Partial<{ name: string; description: string | null; rulesJson: RuleGroup; sortField: string | null }>
): Promise<Playlist> {
  return request(`/api/v1/playlists/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deletePlaylist(id: number): Promise<void> {
  return request(`/api/v1/playlists/${id}`, { method: "DELETE" });
}

export function addTrackToPlaylist(playlistId: number, trackId: number, afterPosition?: string): Promise<PlaylistTrackEntry> {
  return request(`/api/v1/playlists/${playlistId}/tracks`, { method: "POST", body: JSON.stringify({ trackId, afterPosition }) });
}

export function reorderPlaylistEntry(playlistId: number, entryId: number, position: string): Promise<PlaylistTrackEntry> {
  return request(`/api/v1/playlists/${playlistId}/tracks/${entryId}`, { method: "PATCH", body: JSON.stringify({ position }) });
}

export function removePlaylistEntry(playlistId: number, entryId: number): Promise<void> {
  return request(`/api/v1/playlists/${playlistId}/tracks/${entryId}`, { method: "DELETE" });
}

export function previewRules(
  playlistId: number,
  rulesJson: RuleGroup,
  sortField?: string
): Promise<{ items: TrackSummary[]; count: number }> {
  return request(`/api/v1/playlists/${playlistId}/preview-rules`, { method: "POST", body: JSON.stringify({ rulesJson, sortField }) });
}
