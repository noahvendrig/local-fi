import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { getDb } from "../db/client";
import { importJobFiles, playlistTracks, playlists } from "../db/schema";

/**
 * Groups a finished job's successfully-imported files by the immediate subfolder
 * they were staged from and creates one manual playlist per group (the "import a
 * folder with subfolders" flow — see AGENTS.md). Files that sat directly in the
 * imported folder (no `sourceFolder`) are left out — they've already landed in the
 * library and don't belong to any group.
 */
export function createFolderPlaylistsForJob(jobId: number): void {
  const db = getDb();
  const files = db
    .select({ sourceFolder: importJobFiles.sourceFolder, trackId: importJobFiles.trackId, id: importJobFiles.id })
    .from(importJobFiles)
    .where(eq(importJobFiles.jobId, jobId))
    .orderBy(asc(importJobFiles.id))
    .all()
    .filter((f) => f.trackId != null && f.sourceFolder != null) as { sourceFolder: string; trackId: number; id: number }[];

  if (files.length === 0) return;

  const groups = new Map<string, number[]>();
  for (const file of files) {
    const trackIds = groups.get(file.sourceFolder) ?? [];
    trackIds.push(file.trackId);
    groups.set(file.sourceFolder, trackIds);
  }

  const now = new Date().toISOString();

  db.transaction((tx) => {
    for (const [folderName, trackIds] of groups) {
      const playlist = tx
        .insert(playlists)
        .values({ uuid: randomUUID(), name: folderName, type: "manual", createdAt: now, updatedAt: now })
        .returning()
        .get();

      let position: string | null = null;
      for (const trackId of trackIds) {
        position = generateKeyBetween(position, null);
        tx.insert(playlistTracks).values({ playlistId: playlist.id, trackId, position, addedAt: now }).run();
      }
    }
  });
}
