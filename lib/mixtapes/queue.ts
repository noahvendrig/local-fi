import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { mixtapeJobs, mixtapeSegments, mixtapes } from "../db/schema";
import {
  cancelPythonFingerprintJob,
  postMixtapeMatchJob,
  streamFingerprintJobUntilDone,
  type PythonFingerprintJobResponse,
} from "../pythonBackend/fingerprintClient";
import { publishMixtapeJobUpdate } from "./events";
import { writeMixtapeSegments } from "./segments";

// Same shape as lib/fingerprint/queue.ts: no local concurrency/DSP here, just submit one job to
// python-backend and relay its SSE progress into our own mixtapeJobs row + SSE.

export function requestMixtapeJobCancellation(jobId: number): void {
  const db = getDb();
  const job = db.select().from(mixtapeJobs).where(eq(mixtapeJobs.id, jobId)).get();
  if (job?.pythonJobId) void cancelPythonFingerprintJob(job.pythonJobId);
}

/** Creates a `mixtapeJobs` row and fire-and-forget starts matching against it — shared by the
 *  upload route (auto-starts analysis) and the analyze route (manual re-run). Callers that allow
 *  re-analysis are responsible for confirming it's OK to discard any existing manual segments
 *  *before* calling this (app/api/v1/mixtapes/[id]/analyze/route.ts owns that check). */
export function createAndEnqueueMixtapeJob(mixtapeId: number, absPath: string): typeof mixtapeJobs.$inferSelect {
  const db = getDb();
  const now = new Date().toISOString();
  const job = db
    .insert(mixtapeJobs)
    .values({ uuid: randomUUID(), mixtapeId, createdAt: now })
    .returning()
    .get();
  db.update(mixtapes).set({ analysisStatus: "queued", latestJobId: job.id, updatedAt: now }).where(eq(mixtapes.id, mixtapeId)).run();
  void runJob(mixtapeId, job.id, absPath);
  return job;
}

async function runJob(mixtapeId: number, jobId: number, absPath: string): Promise<void> {
  const db = getDb();
  const now = () => new Date().toISOString();

  db.update(mixtapeJobs).set({ status: "running", startedAt: now() }).where(eq(mixtapeJobs.id, jobId)).run();
  db.update(mixtapes).set({ analysisStatus: "analyzing", latestJobId: jobId, updatedAt: now() }).where(eq(mixtapes.id, mixtapeId)).run();
  publishMixtapeJobUpdate(jobId);

  const applyUpdate = (payload: PythonFingerprintJobResponse) => {
    db.update(mixtapeJobs)
      .set({ stage: payload.stage, progressPct: payload.progress_pct })
      .where(eq(mixtapeJobs.id, jobId))
      .run();
    publishMixtapeJobUpdate(jobId);
  };

  try {
    const initial = await postMixtapeMatchJob(mixtapeId, absPath);
    db.update(mixtapeJobs).set({ pythonJobId: initial.id }).where(eq(mixtapeJobs.id, jobId)).run();

    const final = await streamFingerprintJobUntilDone(initial.id, applyUpdate);

    if (final.status === "failed" || final.status === "cancelled") {
      db.update(mixtapeJobs)
        .set({ status: final.status, errorMessage: final.error, finishedAt: now() })
        .where(eq(mixtapeJobs.id, jobId))
        .run();
      db.update(mixtapes).set({ analysisStatus: "failed", updatedAt: now() }).where(eq(mixtapes.id, mixtapeId)).run();
    } else {
      const mixtape = db.select().from(mixtapes).where(eq(mixtapes.id, mixtapeId)).get();
      if (mixtape) writeMixtapeSegments(mixtapeId, mixtape.durationSeconds, final.segments);

      const savedSegments = db.select().from(mixtapeSegments).where(eq(mixtapeSegments.mixtapeId, mixtapeId)).all();
      const matchedSegments = savedSegments.filter((s) => s.matchStatus === "auto_matched").length;
      const unrecognizedSegments = savedSegments.filter((s) => s.matchStatus === "unrecognized").length;

      db.update(mixtapeJobs)
        .set({
          status: "completed",
          stage: "done",
          progressPct: 100,
          matchedSegments,
          unrecognizedSegments,
          finishedAt: now(),
        })
        .where(eq(mixtapeJobs.id, jobId))
        .run();
      db.update(mixtapes).set({ analysisStatus: "ready", updatedAt: now() }).where(eq(mixtapes.id, mixtapeId)).run();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mixtape matching failed — is python-backend running?";
    db.update(mixtapeJobs).set({ status: "failed", errorMessage: message, finishedAt: now() }).where(eq(mixtapeJobs.id, jobId)).run();
    db.update(mixtapes).set({ analysisStatus: "failed", updatedAt: now() }).where(eq(mixtapes.id, mixtapeId)).run();
  }

  publishMixtapeJobUpdate(jobId);
}
