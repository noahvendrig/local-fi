import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { importJobFiles, importJobs, libraryRoots, tracks } from "../db/schema";
import { trackFingerprint } from "../import/fingerprint";
import { enqueueImportJob } from "../import/queue";
import { resolveTrackAbsPath, toRootRelative } from "../storage/resolveTrackPath";
import type { LibraryRootRow } from "./libraryRoots";
import { getLibraryRootById, updateRootFileCount } from "./libraryRoots";
import { walkAudioFiles } from "./walkAudioFiles";

type TrackRow = typeof tracks.$inferSelect;

/**
 * The stat/fingerprint pass shared by the global rescan and a single-root rescan
 * (ARCHITECTURE.md §3.7/M10, extended to watched tracks via resolveTrackAbsPath):
 * a vanished file is marked missing_since rather than deleted; one that reappears
 * at its recorded path is un-flagged automatically.
 */
export function checkTracksForChanges(trackRows: TrackRow[]): { processed: number; missing: number } {
  const db = getDb();
  const now = new Date().toISOString();
  let missing = 0;

  for (const track of trackRows) {
    let absPath: string;
    try {
      absPath = resolveTrackAbsPath(track);
    } catch {
      // Its library root vanished from under it — treat like a missing file rather than crash the scan.
      if (!track.missingSince) db.update(tracks).set({ missingSince: now }).where(eq(tracks.id, track.id)).run();
      missing++;
      continue;
    }

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
  }

  return { processed: trackRows.length, missing };
}

export interface NewRootFile {
  absPath: string;
  relativePath: string;
}

/**
 * Walks a library root and returns audio files not yet indexed for it — idempotent rescan
 * (AGENTS.md). Also refreshes `library_roots.totalFileCount` from this walk, so the UI can
 * show "how many music files are actually in this folder" instead of just how many are
 * indexed — those two numbers legitimately diverge (soft-deleted duplicates, unsupported
 * formats) and the gap is exactly what tells a user a rescan is worth investigating.
 */
export async function walkRootForNewFiles(root: LibraryRootRow): Promise<NewRootFile[]> {
  const db = getDb();
  const files = await walkAudioFiles(root.path);
  updateRootFileCount(root.id, files.length);

  const known = new Set(
    db.select({ path: tracks.path }).from(tracks).where(eq(tracks.libraryRootId, root.id)).all().map((r) => r.path)
  );

  return files
    .map((absPath) => ({ absPath, relativePath: toRootRelative(root.path, absPath) }))
    .filter((f) => !known.has(f.relativePath));
}

/** Creates a `folder_scan` import job for `newFiles` and hands it to the worker queue. An empty batch completes immediately. */
export function enqueueFolderScanJob(root: LibraryRootRow, newFiles: NewRootFile[]): typeof importJobs.$inferSelect {
  const db = getDb();
  const now = new Date().toISOString();

  if (newFiles.length === 0) {
    return db
      .insert(importJobs)
      .values({ uuid: randomUUID(), type: "folder_scan", status: "completed", totalFiles: 0, startedAt: now, finishedAt: now, createdAt: now })
      .returning()
      .get();
  }

  const job = db
    .insert(importJobs)
    .values({ uuid: randomUUID(), type: "folder_scan", status: "pending", totalFiles: newFiles.length, createdAt: now })
    .returning()
    .get();

  for (const file of newFiles) {
    db.insert(importJobFiles)
      .values({
        jobId: job.id,
        originalFilename: path.basename(file.absPath),
        stagedPath: file.absPath,
        libraryRootId: root.id,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  enqueueImportJob(job.id);
  return db.select().from(importJobs).where(eq(importJobs.id, job.id)).get()!;
}

/**
 * Enqueues a one-file folder-scan job for a single newly-added file — the live watcher's
 * "add" handler. Bumps totalFileCount by one instead of re-walking the whole tree (cheap,
 * and correct for the common case; a full rescan reconciles any drift from edge cases).
 */
export function enqueueSingleFileFolderScan(rootId: number, absPath: string): void {
  const root = getLibraryRootById(rootId);
  if (!root) return;
  getDb()
    .update(libraryRoots)
    .set({ totalFileCount: sql`${libraryRoots.totalFileCount} + 1` })
    .where(eq(libraryRoots.id, rootId))
    .run();
  enqueueFolderScanJob(root, [{ absPath, relativePath: toRootRelative(root.path, absPath) }]);
}
