import os from "node:os";
import { eq, sql } from "drizzle-orm";
import PQueue from "p-queue";
import { getDb } from "../db/client";
import { importJobFiles, importJobs } from "../db/schema";
import { publishJobUpdate } from "./events";
import { createFolderPlaylistsForJob } from "./folderPlaylists";
import { processFolderScanFile } from "./folderScanPipeline";
import { processImportFile } from "./pipeline";

// In-process worker pool, no external job-queue system — single process, single
// user (ARCHITECTURE.md §3.7). ffmpeg decode is CPU-heavy, so concurrency is capped.
const concurrency = Number(process.env.LOCALFI_IMPORT_CONCURRENCY) || Math.min(4, os.cpus().length);
const queue = new PQueue({ concurrency });

const cancelledJobs = new Set<number>();
const pendingCounts = new Map<number, number>();
// Counts files actually *skipped* by a cancellation, as opposed to jobs that merely
// had cancel requested but finished naturally before any file was skipped.
const skippedByCancelCounts = new Map<number, number>();

export function requestJobCancellation(jobId: number): void {
  cancelledJobs.add(jobId);
}

function finishJobIfDone(jobId: number): void {
  const remaining = pendingCounts.get(jobId) ?? 0;
  if (remaining > 0) return;

  const db = getDb();
  const job = db.select().from(importJobs).where(eq(importJobs.id, jobId)).get();
  if (!job || job.status === "completed" || job.status === "completed_with_errors" || job.status === "failed" || job.status === "cancelled") {
    return;
  }

  const actuallySkipped = (skippedByCancelCounts.get(jobId) ?? 0) > 0;
  const status = actuallySkipped
    ? "cancelled"
    : job.failedFiles === 0
      ? "completed"
      : job.failedFiles >= job.totalFiles
        ? "failed"
        : "completed_with_errors";

  db.update(importJobs)
    .set({ status, finishedAt: new Date().toISOString() })
    .where(eq(importJobs.id, jobId))
    .run();

  if ((status === "completed" || status === "completed_with_errors") && job.createFolderPlaylists) {
    createFolderPlaylistsForJob(jobId);
  }

  cancelledJobs.delete(jobId);
  pendingCounts.delete(jobId);
  skippedByCancelCounts.delete(jobId);
  publishJobUpdate(jobId);
}

/** Enqueues every `queued` file belonging to a freshly-created import job. */
export function enqueueImportJob(jobId: number): void {
  const db = getDb();
  const job = db.select().from(importJobs).where(eq(importJobs.id, jobId)).get();
  if (!job) return;

  const files = db
    .select()
    .from(importJobFiles)
    .where(eq(importJobFiles.jobId, jobId))
    .all()
    .filter((f) => f.status === "queued");

  if (files.length === 0) return;

  pendingCounts.set(jobId, files.length);

  db.update(importJobs)
    .set({ status: "running", startedAt: new Date().toISOString() })
    .where(eq(importJobs.id, jobId))
    .run();
  publishJobUpdate(jobId);

  for (const file of files) {
    void queue.add(async () => {
      if (cancelledJobs.has(jobId)) {
        skippedByCancelCounts.set(jobId, (skippedByCancelCounts.get(jobId) ?? 0) + 1);
        getDb()
          .update(importJobFiles)
          .set({ status: "failed", errorMessage: "Cancelled", updatedAt: new Date().toISOString() })
          .where(eq(importJobFiles.id, file.id))
          .run();
        getDb()
          .update(importJobs)
          .set({ failedFiles: sql`${importJobs.failedFiles} + 1`, processedFiles: sql`${importJobs.processedFiles} + 1` })
          .where(eq(importJobs.id, jobId))
          .run();
      } else if (job.type === "folder_scan" && file.stagedPath && file.libraryRootId != null) {
        await processFolderScanFile(jobId, file.id, file.stagedPath, file.originalFilename, file.libraryRootId);
      } else if (file.stagedPath) {
        await processImportFile(jobId, file.id, file.stagedPath, file.originalFilename);
      }

      pendingCounts.set(jobId, (pendingCounts.get(jobId) ?? 1) - 1);
      finishJobIfDone(jobId);
    });
  }
}
