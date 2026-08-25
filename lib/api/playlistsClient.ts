import type { TrackSummary } from "@/lib/api-client";
import type { RuleGroup } from "@/lib/crates/rules";
import { authHeaders, withAuthQuery } from "./http";

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

/** Present when this crate mirrors a watched library folder (lib/library/syncCrates.ts) — either the whole-root crate or one immediate subfolder's crate. */
export interface LibrarySyncInfo {
  rootId: number;
  rootName: string;
  syncToCrate: boolean;
}

export interface PlaylistDetail extends Playlist {
  tracks: PlaylistTrackItem[];
  librarySync: LibrarySyncInfo | null;
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

/** Matches the server cap in lib/crates/coverArt.ts. */
export const PLAYLIST_COVER_MAX_BYTES = 10 * 1024 * 1024;
export const PLAYLIST_COVER_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";

export async function uploadPlaylistCover(id: number, file: File): Promise<Playlist> {
  if (file.size > PLAYLIST_COVER_MAX_BYTES) {
    throw new Error("Cover image is too large (max 10 MB).");
  }
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/v1/playlists/${id}/cover`, {
    method: "PUT",
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function removePlaylistCover(id: number): Promise<Playlist> {
  return request(`/api/v1/playlists/${id}/cover`, { method: "DELETE" });
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

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;
};

/** Downloads the crate as a zip folder named after the playlist, with the audio files inside. */
export async function downloadPlaylistExport(playlistId: number, suggestedName: string): Promise<void> {
  const picker = window as SaveFilePickerWindow;
  if (typeof picker.showSaveFilePicker === "function") {
    const handle = await picker.showSaveFilePicker({
      suggestedName,
      types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }],
    });
    const res = await fetch(`/api/v1/playlists/${playlistId}/export`, { headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message ?? `Export failed (${res.status})`);
    }
    if (!res.body) throw new Error("Export failed (empty response).");
    await res.body.pipeTo(await handle.createWritable());
    return;
  }

  const link = document.createElement("a");
  link.href = withAuthQuery(`/api/v1/playlists/${playlistId}/export`);
  link.download = suggestedName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
