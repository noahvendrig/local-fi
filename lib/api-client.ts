import { authHeaders, withAuthQuery } from "@/lib/api/http";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TrackSummary {
  id: number;
  uuid: string;
  title: string | null;
  artistId: number | null;
  artistName: string | null;
  albumId: number | null;
  albumTitle: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  durationSeconds: number;
  format: string;
  lossless: boolean;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  coverArtUrl: string | null;
  dateAdded: string;
  missing: boolean;
  /** Mean-abs amplitude from the waveform pass, 0–1. Null if the sidecar wasn't generated. */
  waveformAvgLevel: number | null;
  bpm: number | null;
  /** Camelot notation, e.g. "8A". */
  key: string | null;
  analysisStatus: "none" | "queued" | "analyzing" | "ready" | "failed";
}

export interface AlbumSummary {
  id: number;
  uuid: string;
  title: string;
  albumArtistId: number | null;
  albumArtistName: string;
  year: number | null;
  coverArtUrl: string | null;
  trackCount: number;
  format: string | null;
  lossless: boolean;
  dateAdded: string;
}

export interface ArtistSummary {
  id: number;
  uuid: string;
  name: string;
  sortName: string | null;
  albumCount: number;
  trackCount: number;
}

export interface AlbumDetailTrack extends TrackSummary {
  /** Joined track_artists credit (falls back to the denormalized artistName). */
  artistCredit: string;
}

export interface AlbumDetail {
  id: number;
  uuid: string;
  title: string;
  year: number | null;
  isCompilation: boolean;
  coverArtUrl: string | null;
  dateAdded: string;
  /** Credited album artists from album_artists, ordered by position — the many-to-many
   *  source of truth, not just the single denormalized albumArtistId. */
  artists: { id: number; name: string }[];
  tracks: AlbumDetailTrack[];
}

export interface ArtistDetail {
  id: number;
  uuid: string;
  name: string;
  sortName: string | null;
  /** 1-based all-time listening rank among all artists, capped to the top 10; null outside it. */
  topRank: number | null;
  albums: AlbumSummary[];
}

export type TrackSort = "date_added_desc" | "date_added_asc" | "title_asc" | "title_desc" | "duration_asc" | "duration_desc";
export type AlbumSort = "date_added_desc" | "date_added_asc" | "title_asc" | "title_desc" | "year_desc" | "year_asc";
export type ArtistSort = "name_asc" | "name_desc";

export interface FetchTracksParams {
  q?: string;
  format?: string[];
  lossless?: boolean;
  artistId?: number;
  albumId?: number;
  genre?: string;
  yearMin?: number;
  yearMax?: number;
  sort?: TrackSort;
  limit?: number;
  cursor?: string;
}

export interface FetchAlbumsParams {
  q?: string;
  artistId?: number;
  year?: number;
  sort?: AlbumSort;
  limit?: number;
  cursor?: string;
}

export interface FetchArtistsParams {
  q?: string;
  sort?: ArtistSort;
  limit?: number;
  cursor?: string;
}

function buildQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, string | number | boolean | string[] | undefined][]) {
    if (value === undefined) continue;
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function fetchTracks(params: FetchTracksParams = {}): Promise<Page<TrackSummary>> {
  return getJson(`/api/v1/tracks${buildQuery(params)}`);
}

export function fetchAlbums(params: FetchAlbumsParams = {}): Promise<Page<AlbumSummary>> {
  return getJson(`/api/v1/albums${buildQuery(params)}`);
}

export function fetchArtists(params: FetchArtistsParams = {}): Promise<Page<ArtistSummary>> {
  return getJson(`/api/v1/artists${buildQuery(params)}`);
}

export function fetchAlbum(id: number): Promise<AlbumDetail> {
  return getJson(`/api/v1/albums/${id}`);
}

export function fetchArtist(id: number): Promise<ArtistDetail> {
  return getJson(`/api/v1/artists/${id}`);
}

/** Audio bytes, Range-seekable (ARCHITECTURE.md §7) — token-in-query since <audio> can't attach headers. */
export function streamUrl(trackId: number): string {
  return withAuthQuery(`/api/v1/tracks/${trackId}/stream`);
}

/** Raw .lfpk peak sidecar bytes, parsed by lib/waveform/parse.ts. */
export function waveformUrl(trackId: number): string {
  return withAuthQuery(`/api/v1/tracks/${trackId}/waveform`);
}
