import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import type { TrackSummary } from "@/lib/api-client";
import { albums, artists, playlistTracks, tracks } from "@/lib/db/schema";
import { mapTrackSummaryRow, trackSummarySelectColumns } from "@/lib/db/trackSummary";

export interface DuplicateGroup {
  key: string;
  /** Track we'd keep if the user hits "Remove extras" / "Remove all duplicates". */
  keeperId: number;
  tracks: TrackSummary[];
}

/** Prefer lossless, then higher bitrate, then the copy that was imported first. */
export function pickDuplicateKeeper(groupTracks: TrackSummary[]): TrackSummary {
  const keeper = groupTracks.slice().sort((a, b) => {
    if (a.lossless !== b.lossless) return a.lossless ? -1 : 1;
    const bitrateDelta = (b.bitrate ?? 0) - (a.bitrate ?? 0);
    if (bitrateDelta !== 0) return bitrateDelta;
    return a.dateAdded.localeCompare(b.dateAdded);
  })[0];
  if (!keeper) throw new Error("Cannot pick a keeper from an empty group.");
  return keeper;
}

/**
 * A duplicate's extras are the same song as the keeper, so before soft-deleting one, repoint
 * any playlist entries that reference it onto the keeper instead of letting them dangle — a
 * dangling entry points at a soon-to-be-trashed track and silently drops out of the playlist
 * (playlist reads filter out deleted tracks). If the playlist already has the keeper, drop the
 * now-redundant entry rather than creating a second copy of the same track in one playlist.
 */
export function repointPlaylistEntries(db: ReturnType<typeof getDb>, extraTrackId: number, keeperTrackId: number): void {
  const entries = db.select().from(playlistTracks).where(eq(playlistTracks.trackId, extraTrackId)).all();
  for (const entry of entries) {
    const alreadyHasKeeper = db
      .select({ id: playlistTracks.id })
      .from(playlistTracks)
      .where(and(eq(playlistTracks.playlistId, entry.playlistId), eq(playlistTracks.trackId, keeperTrackId)))
      .get();
    if (alreadyHasKeeper) {
      db.delete(playlistTracks).where(eq(playlistTracks.id, entry.id)).run();
    } else {
      db.update(playlistTracks).set({ trackId: keeperTrackId }).where(eq(playlistTracks.id, entry.id)).run();
    }
  }
}

function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Probable-duplicate heuristic (ARCHITECTURE.md §3.6): groups active, present tracks by
 * (normalized title, normalized primary artist, duration rounded to the nearest second) —
 * a separate, heavier concern from the per-scan fingerprint, surfaced for user review.
 */
export function findDuplicateGroups(db: ReturnType<typeof getDb>): DuplicateGroup[] {
  const rows = db
    .select(trackSummarySelectColumns)
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(and(isNull(tracks.deletedAt), isNull(tracks.missingSince)))
    .all();

  const groups = new Map<string, TrackSummary[]>();
  for (const row of rows) {
    const summary = mapTrackSummaryRow(row);
    const normalizedTitle = normalize(summary.title ?? "");
    if (!normalizedTitle) continue;
    const key = `${normalizedTitle}|${normalize(summary.artistName ?? "")}|${Math.round(summary.durationSeconds)}`;
    const list = groups.get(key) ?? [];
    list.push(summary);
    groups.set(key, list);
  }

  return Array.from(groups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, keeperId: pickDuplicateKeeper(list).id, tracks: list }));
}
