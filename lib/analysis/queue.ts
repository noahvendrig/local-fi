import os from "node:os";
import { eq, sql } from "drizzle-orm";
import PQueue from "p-queue";
import { getDb } from "../db/client";
import { analysisJobTracks, analysisJobs } from "../db/schema";
import { analyzeTrack } from "./detect";
import { publishAnalysisJobUpdate } from "./events";

// Separate queue/concurrency from lib/import/queue.ts — CPU-bound FFT/beat-tracking work
// shouldn't starve import throughput or vice versa. Capped low; analysis is heavier per-track
// than waveform generation (full-resolution PCM decode + FFT frames over the whole file).
const concurrency = Number(process.env.LOCALFI_ANALYSIS_CONCURRENCY) || Math.min(2, os.cpus().length);
const queue = new PQueue({ concurrency });

const cancelledJobs = new Set<number>();
const pendingCounts = new Map<number, number>();

const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

export function requestAnalysisJobCancellation(jobId: number): void {
  cancelledJobs.add(jobId);
}

function finishJobIfDone(jobId: number): void {
  const remaining = pendingCounts.get(jobId) ?? 0;
  if (remaining > 0) return;

  const db = getDb();
  const job = db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get();
  if (!job || TERMINAL_STATUSES.has(job.status)) return;

  const status = job.failedTracks === 0 ? "completed" : job.failedTracks >= job.totalTracks ? "failed" : "completed_with_errors";

  db.update(analysisJobs)
    .set({ status, finishedAt: new Date().toISOString() })
    .where(eq(analysisJobs.id, jobId))
    .run();

  cancelledJobs.delete(jobId);
  pendingCounts.delete(jobId);
  publishAnalysisJobUpdate(jobId);
}

/** Enqueues every `queued` track belonging to a freshly-created analysis job. */
export function enqueueAnalysisJob(jobId: number): void {
  const db = getDb();
  const job = db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get();
  if (!job) return;

  const items = db
    .select()
    .from(analysisJobTracks)
    .where(eq(analysisJobTracks.jobId, jobId))
    .all()
    .filter((t) => t.status === "queued");

  if (items.length === 0) return;

  pendingCounts.set(jobId, items.length);
  db.update(analysisJobs).set({ status: "running", startedAt: new Date().toISOString() }).where(eq(analysisJobs.id, jobId)).run();
  publishAnalysisJobUpdate(jobId);

  for (const item of items) {
    void queue.add(async () => {
      if (cancelledJobs.has(jobId)) {
        const now = new Date().toISOString();
        getDb()
          .update(analysisJobTracks)
          .set({ status: "failed", errorMessage: "Cancelled", updatedAt: now })
          .where(eq(analysisJobTracks.id, item.id))
          .run();
        getDb()
          .update(analysisJobs)
          .set({ failedTracks: sql`${analysisJobs.failedTracks} + 1`, processedTracks: sql`${analysisJobs.processedTracks} + 1` })
          .where(eq(analysisJobs.id, jobId))
          .run();
        publishAnalysisJobUpdate(jobId);
      } else {
        await analyzeTrack(item.trackId, item.id, jobId);
      }

      pendingCounts.set(jobId, (pendingCounts.get(jobId) ?? 1) - 1);
      finishJobIfDone(jobId);
    });
  }
}
