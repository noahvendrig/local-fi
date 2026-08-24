import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import type { TrackSummary } from "@/lib/api-client";
import { albums, artists, tracks } from "@/lib/db/schema";
import { mapTrackSummaryRow, trackSummarySelectColumns } from "@/lib/db/trackSummary";

export interface DuplicateGroup {
  key: string;
  tracks: TrackSummary[];
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
    .map(([key, list]) => ({ key, tracks: list }));
}
