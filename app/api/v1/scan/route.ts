import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { importJobs, tracks } from "@/lib/db/schema";
import { trackFingerprint } from "@/lib/import/fingerprint";
import { getDataDir } from "@/lib/storage/dataDir";

/**
 * POST /api/v1/scan — rescans the library for missing files or on-disk changes
 * (ARCHITECTURE.md §3.7/M10): a vanished file is marked `missing_since` rather than deleted,
 * and a file that reappears at its recorded path is un-flagged automatically. Reuses the
 * import_jobs machinery (`type='scan'`) but runs synchronously — a stat-only pass is fast
 * enough not to need the SSE/worker-queue machinery M2's ffmpeg-heavy import requires.
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

  let processed = 0;
  let missing = 0;

  for (const track of activeTracks) {
    const absPath = path.join(getDataDir(), track.path);

    if (!existsSync(absPath)) {
      if (!track.missingSince) {
        db.update(tracks).set({ missingSince: now }).where(eq(tracks.id, track.id)).run();
      }
      missing++;
    } else {
      const stat = statSync(absPath);
      const fingerprint = trackFingerprint(track.path, stat.size, stat.mtimeMs);
      const changed = fingerprint !== track.fingerprint;
      db.update(tracks)
        .set({
          missingSince: null,
          ...(changed
            ? { fingerprint, fileMtime: new Date(stat.mtimeMs).toISOString(), fileSizeBytes: stat.size, dateModified: now }
            : {}),
        })
        .where(eq(tracks.id, track.id))
        .run();
    }
    processed++;
  }

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

  return NextResponse.json(finishedJob, { status: 201 });
}
