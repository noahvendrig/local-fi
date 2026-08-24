import { and, inArray, isNull, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";

export interface AlbumAggregate {
  trackCount: number;
  format: string | null;
  lossless: boolean;
}

/**
 * Track count + "dominant" format/lossless (the format most of an album's tracks are in,
 * ties broken alphabetically for determinism) for a set of albums — shared by the albums
 * browse list and the artist-detail album list (ARCHITECTURE.md §7).
 */
export function getAlbumAggregates(db: ReturnType<typeof getDb>, albumIds: number[]): Map<number, AlbumAggregate> {
  const result = new Map<number, AlbumAggregate>();
  if (albumIds.length === 0) return result;

  const rows = db
    .select({
      albumId: tracks.albumId,
      format: tracks.format,
      lossless: tracks.lossless,
      cnt: sql<number>`count(*)`.as("cnt"),
    })
    .from(tracks)
    .where(and(inArray(tracks.albumId, albumIds), isNull(tracks.deletedAt)))
    .groupBy(tracks.albumId, tracks.format, tracks.lossless)
    .all();

  const trackCountByAlbum = new Map<number, number>();
  const dominantByAlbum = new Map<number, { format: string; lossless: boolean; cnt: number }>();
  for (const row of rows) {
    if (row.albumId == null) continue;
    trackCountByAlbum.set(row.albumId, (trackCountByAlbum.get(row.albumId) ?? 0) + row.cnt);
    const current = dominantByAlbum.get(row.albumId);
    if (!current || row.cnt > current.cnt || (row.cnt === current.cnt && row.format < current.format)) {
      dominantByAlbum.set(row.albumId, { format: row.format, lossless: row.lossless === 1, cnt: row.cnt });
    }
  }

  for (const albumId of albumIds) {
    const dominant = dominantByAlbum.get(albumId);
    result.set(albumId, {
      trackCount: trackCountByAlbum.get(albumId) ?? 0,
      format: dominant?.format ?? null,
      lossless: dominant?.lossless ?? false,
    });
  }
  return result;
}
