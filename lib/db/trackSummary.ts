import { eq, inArray } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import { albums, artists, tracks } from "@/lib/db/schema";
import type { TrackSummary } from "@/lib/api-client";

/** Shared select shape for the tracks->artists->albums join, reused anywhere a row needs to
 *  become a wire TrackSummary (queue resolution, album detail's tracklist, ...). */
export const trackSummarySelectColumns = {
  id: tracks.id,
  uuid: tracks.uuid,
  title: tracks.title,
  artistId: tracks.artistId,
  artistName: artists.name,
  albumId: tracks.albumId,
  albumTitle: albums.title,
  coverArtPath: tracks.coverArtPath,
  albumCoverArtPath: albums.coverArtPath,
  trackNumber: tracks.trackNumber,
  discNumber: tracks.discNumber,
  durationSeconds: tracks.durationSeconds,
  format: tracks.format,
  lossless: tracks.lossless,
  bitrate: tracks.bitrate,
  sampleRate: tracks.sampleRate,
  bitDepth: tracks.bitDepth,
  dateAdded: tracks.dateAdded,
  missingSince: tracks.missingSince,
  waveformAvgLevel: tracks.waveformAvgLevel,
};

type TrackSummaryRow = {
  id: number;
  uuid: string;
  title: string | null;
  artistId: number | null;
  artistName: string | null;
  albumId: number | null;
  albumTitle: string | null;
  coverArtPath: string | null;
  albumCoverArtPath: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  durationSeconds: number;
  format: string;
  lossless: number;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  dateAdded: string;
  missingSince: string | null;
  waveformAvgLevel: number | null;
};

export function mapTrackSummaryRow(row: TrackSummaryRow): TrackSummary {
  return {
    id: row.id,
    uuid: row.uuid,
    title: row.title,
    artistId: row.artistId,
    artistName: row.artistName,
    albumId: row.albumId,
    albumTitle: row.albumTitle,
    trackNumber: row.trackNumber,
    discNumber: row.discNumber,
    durationSeconds: row.durationSeconds,
    format: row.format,
    lossless: row.lossless === 1,
    bitrate: row.bitrate,
    sampleRate: row.sampleRate,
    bitDepth: row.bitDepth,
    coverArtUrl: row.coverArtPath || row.albumCoverArtPath ? `/api/v1/tracks/${row.id}/cover` : null,
    dateAdded: row.dateAdded,
    missing: row.missingSince != null,
    waveformAvgLevel: row.waveformAvgLevel,
  };
}

/**
 * Resolves a set of track ids into wire-shaped TrackSummary objects, in the order
 * the ids were given (needed for the playback queue, which is order-significant).
 * Ids with no matching row (e.g. a track deleted since the queue was saved) are dropped.
 */
export function getTrackSummariesByIds(db: ReturnType<typeof getDb>, ids: number[]): TrackSummary[] {
  if (ids.length === 0) return [];

  const rows = db
    .select(trackSummarySelectColumns)
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(inArray(tracks.id, ids))
    .all();

  const byId = new Map(rows.map((row) => [row.id, mapTrackSummaryRow(row)]));
  return ids.map((id) => byId.get(id)).filter((t): t is TrackSummary => t != null);
}
