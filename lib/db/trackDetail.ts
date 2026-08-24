import { alias } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import { albums, artists, tracks } from "@/lib/db/schema";
import type { TrackDetail } from "@/lib/api/tracksClient";

// Separate alias so the album's own credited artist can be joined alongside the
// track's (denormalized) performing artist without colliding (mirrors evaluateRules.ts's pattern).
const albumArtistAlias = alias(artists, "track_detail_album_artist");

export const trackDetailSelectColumns = {
  id: tracks.id,
  uuid: tracks.uuid,
  title: tracks.title,
  artistId: tracks.artistId,
  artistName: artists.name,
  albumId: tracks.albumId,
  albumTitle: albums.title,
  albumCoverArtPath: albums.coverArtPath,
  albumArtistId: albums.albumArtistId,
  albumArtistName: albumArtistAlias.name,
  trackNumber: tracks.trackNumber,
  trackTotal: tracks.trackTotal,
  discNumber: tracks.discNumber,
  discTotal: tracks.discTotal,
  year: tracks.year,
  genre: tracks.genre,
  durationSeconds: tracks.durationSeconds,
  format: tracks.format,
  codec: tracks.codec,
  bitrate: tracks.bitrate,
  sampleRate: tracks.sampleRate,
  bitDepth: tracks.bitDepth,
  channels: tracks.channels,
  lossless: tracks.lossless,
  dateAdded: tracks.dateAdded,
  dateModified: tracks.dateModified,
  missingSince: tracks.missingSince,
};

type TrackDetailRow = {
  id: number;
  uuid: string;
  title: string | null;
  artistId: number | null;
  artistName: string | null;
  albumId: number | null;
  albumTitle: string | null;
  albumCoverArtPath: string | null;
  albumArtistId: number | null;
  albumArtistName: string | null;
  trackNumber: number | null;
  trackTotal: number | null;
  discNumber: number | null;
  discTotal: number | null;
  year: number | null;
  genre: string | null;
  durationSeconds: number;
  format: string;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  lossless: number;
  dateAdded: string;
  dateModified: string | null;
  missingSince: string | null;
};

export function mapTrackDetailRow(row: TrackDetailRow): TrackDetail {
  return {
    id: row.id,
    uuid: row.uuid,
    title: row.title,
    artistId: row.artistId,
    artistName: row.artistName,
    albumId: row.albumId,
    albumTitle: row.albumTitle,
    albumArtistId: row.albumArtistId,
    albumArtistName: row.albumArtistName,
    trackNumber: row.trackNumber,
    trackTotal: row.trackTotal,
    discNumber: row.discNumber,
    discTotal: row.discTotal,
    year: row.year,
    genre: row.genre,
    durationSeconds: row.durationSeconds,
    format: row.format,
    codec: row.codec,
    bitrate: row.bitrate,
    sampleRate: row.sampleRate,
    bitDepth: row.bitDepth,
    channels: row.channels,
    lossless: row.lossless === 1,
    coverArtUrl: row.albumCoverArtPath ? `/api/v1/albums/${row.albumId}/cover` : null,
    waveformUrl: `/api/v1/tracks/${row.id}/waveform`,
    dateAdded: row.dateAdded,
    dateModified: row.dateModified,
    missing: row.missingSince != null,
  };
}

export function getTrackDetailRow(db: ReturnType<typeof getDb>, trackId: number): TrackDetailRow | undefined {
  return db
    .select(trackDetailSelectColumns)
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(albumArtistAlias, eq(albums.albumArtistId, albumArtistAlias.id))
    .where(eq(tracks.id, trackId))
    .get();
}
