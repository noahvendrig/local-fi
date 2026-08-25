import { randomUUID } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { importJobs, tracks } from "@/lib/db/schema";
import { listLibraryRoots } from "@/lib/library/libraryRoots";
import { checkTracksForChanges, enqueueFolderScanJob, walkRootForNewFiles } from "@/lib/library/scan";

/**
 * POST /api/v1/scan — rescans the whole library: managed tracks and every watched library
 * root (ARCHITECTURE.md §3.7/M10, extended for watch-in-place). A vanished file is marked
 * `missing_since` rather than deleted; one that reappears at its recorded path is
 * un-flagged automatically. Reuses the import_jobs machinery (`type='scan'`) but runs that
 * stat pass synchronously — it's fast enough not to need the SSE/worker-queue machinery.
 * New files discovered under a watched root are handed off separately as `folder_scan`
 * jobs, which do run through the queue with real progress in the Import tray.
 */
export async function POST() {
  const db = getDb();
  const now = new Date().toISOString();

  const activeTracks = db.select().from(tracks).where(isNull(tracks.deletedAt)).all();

  const job = db
    .insert(importJobs)
    .values({
      uuid: randomUUID(),
      type: "scan",
      status: "running",
      totalFiles: activeTracks.length,
      startedAt: now,
      createdAt: now,
    })
    .returning()
    .get();

  const { processed, missing } = checkTracksForChanges(activeTracks);

  const finishedJob = db
    .update(importJobs)
    .set({
      status: missing > 0 ? "completed_with_errors" : "completed",
      processedFiles: processed,
      failedFiles: missing,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(importJobs.id, job.id))
    .returning()
    .get();

  const folderScanJobs = [];
  for (const root of listLibraryRoots()) {
    try {
      const newFiles = await walkRootForNewFiles(root);
      if (newFiles.length > 0) folderScanJobs.push(enqueueFolderScanJob(root, newFiles));
    } catch (err) {
      console.warn(`[local-fi] Failed to walk library root "${root.path}" during scan:`, err);
    }
  }

  return NextResponse.json({ ...finishedJob, folderScanJobs }, { status: 201 });
}
