import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { fingerprintJobTracks, fingerprintJobs, tracks } from "../db/schema";
import {
  cancelPythonFingerprintJob,
  postTrackFingerprintJob,
  streamFingerprintJobUntilDone,
  type PythonFingerprintJobResponse,
} from "../pythonBackend/fingerprintClient";
import { resolveTrackAbsPath } from "../storage/resolveTrackPath";
import { publishFingerprintJobUpdate } from "./events";

// No local p-queue/concurrency here (contrast lib/analysis/queue.ts) — the actual DSP work runs
// on python-backend, which owns its own concurrency (FINGERPRINT_MAX_CONCURRENT_JOBS). This
// module's job is just to submit one batch job to that service and relay its SSE progress into
// our own fingerprintJobs/fingerprintJobTracks rows + tracks.landmarkStatus, the same "DB is the
// source of truth, SSE just nudges listeners to re-read it" shape as lib/analysis/events.ts.

export function requestFingerprintJobCancellation(jobId: number): void {
  const db = getDb();
  const job = db.select().from(fingerprintJobs).where(eq(fingerprintJobs.id, jobId)).get();
  if (job?.pythonJobId) void cancelPythonFingerprintJob(job.pythonJobId);
}

/** Fire-and-forget entry point for auto-fingerprinting a single freshly-imported track — creates
 *  its own one-track fingerprintJobs row so status flows through the same job/SSE machinery as a
 *  bulk backfill, without the caller having to explicitly request one (unlike BPM/key analysis,
 *  which stays purely on-demand — see the comment on analysisJobs in lib/db/schema.ts). */
export function enqueueTrackFingerprint(trackId: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  const job = db.insert(fingerprintJobs).values({ uuid: randomUUID(), totalTracks: 1, createdAt: now }).returning().get();
  const jobTrack = db
    .insert(fingerprintJobTracks)
    .values({ jobId: job.id, trackId, createdAt: now, updatedAt: now })
    .returning()
    .get();
  db.update(tracks).set({ landmarkStatus: "queued" }).where(eq(tracks.id, trackId)).run();

  void runJob(job.id, new Map([[trackId, jobTrack.id]]));
}

/** Enqueues every `queued` track belonging to a freshly-created fingerprint job (bulk backfill,
 *  mirrors lib/analysis/queue.ts's enqueueAnalysisJob — rows already exist, created by the caller). */
export function enqueueFingerprintJob(jobId: number): void {
  const db = getDb();
  const items = db
    .select()
    .from(fingerprintJobTracks)
    .where(eq(fingerprintJobTracks.jobId, jobId))
    .all()
    .filter((t) => t.status === "queued");
  if (items.length === 0) return;

  void runJob(
    jobId,
    new Map(items.map((t) => [t.trackId, t.id]))
  );
}

async function runJob(jobId: number, jobTrackIdByTrackId: Map<number, number>): Promise<void> {
  const db = getDb();
  const now = () => new Date().toISOString();

  const pythonTracks: { trackId: number; path: string }[] = [];
  for (const trackId of jobTrackIdByTrackId.keys()) {
    const track = db.select().from(tracks).where(eq(tracks.id, trackId)).get();
    if (!track) continue; // deleted between enqueue and run -- just skip it
    pythonTracks.push({ trackId, path: resolveTrackAbsPath(track) });
  }

  if (pythonTracks.length === 0) {
    db.update(fingerprintJobs).set({ status: "failed", finishedAt: now() }).where(eq(fingerprintJobs.id, jobId)).run();
    publishFingerprintJobUpdate(jobId);
    return;
  }

  db.update(fingerprintJobs).set({ status: "running", startedAt: now() }).where(eq(fingerprintJobs.id, jobId)).run();
  for (const trackId of jobTrackIdByTrackId.keys()) {
    db.update(tracks).set({ landmarkStatus: "processing" }).where(eq(tracks.id, trackId)).run();
  }
  publishFingerprintJobUpdate(jobId);

  let appliedCount = 0;
  const applyUpdate = (payload: PythonFingerprintJobResponse) => {
    const newResults = payload.track_results.slice(appliedCount);
    appliedCount = payload.track_results.length;

    for (const r of newResults) {
      const jobTrackId = jobTrackIdByTrackId.get(r.track_id);
      if (jobTrackId == null) continue;

      if (r.status === "done") {
        db.update(fingerprintJobTracks).set({ status: "done", updatedAt: now() }).where(eq(fingerprintJobTracks.id, jobTrackId)).run();
        db.update(tracks)
          .set({ landmarkStatus: "ready", landmarkCount: r.landmark_count, landmarkedAt: now() })
          .where(eq(tracks.id, r.track_id))
          .run();
        db.update(fingerprintJobs)
          .set({ processedTracks: sql`${fingerprintJobs.processedTracks} + 1` })
          .where(eq(fingerprintJobs.id, jobId))
          .run();
      } else {
        db.update(fingerprintJobTracks)
          .set({ status: "failed", errorMessage: r.error, updatedAt: now() })
          .where(eq(fingerprintJobTracks.id, jobTrackId))
          .run();
        db.update(tracks).set({ landmarkStatus: "failed" }).where(eq(tracks.id, r.track_id)).run();
        db.update(fingerprintJobs)
          .set({ processedTracks: sql`${fingerprintJobs.processedTracks} + 1`, failedTracks: sql`${fingerprintJobs.failedTracks} + 1` })
          .where(eq(fingerprintJobs.id, jobId))
          .run();
      }
    }
    publishFingerprintJobUpdate(jobId);
  };

  try {
    const initial = await postTrackFingerprintJob(pythonTracks);
    db.update(fingerprintJobs).set({ pythonJobId: initial.id }).where(eq(fingerprintJobs.id, jobId)).run();

    await streamFingerprintJobUntilDone(initial.id, applyUpdate);

    const finalRow = db.select().from(fingerprintJobs).where(eq(fingerprintJobs.id, jobId)).get();
    const status =
      !finalRow || finalRow.failedTracks === 0
        ? "completed"
        : finalRow.failedTracks >= finalRow.totalTracks
          ? "failed"
          : "completed_with_errors";
    db.update(fingerprintJobs).set({ status, finishedAt: now() }).where(eq(fingerprintJobs.id, jobId)).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fingerprinting failed — is python-backend running?";
    db.update(fingerprintJobs).set({ status: "failed", finishedAt: now() }).where(eq(fingerprintJobs.id, jobId)).run();
    // Anything we never heard back about from Python (backend unreachable, crashed mid-batch)
    // shouldn't stay stuck at "processing" forever.
    for (const [trackId, jobTrackId] of jobTrackIdByTrackId) {
      const row = db.select().from(fingerprintJobTracks).where(eq(fingerprintJobTracks.id, jobTrackId)).get();
      if (row?.status === "queued" || row?.status === "processing") {
        db.update(fingerprintJobTracks)
          .set({ status: "failed", errorMessage: message, updatedAt: now() })
          .where(eq(fingerprintJobTracks.id, jobTrackId))
          .run();
        db.update(tracks).set({ landmarkStatus: "failed" }).where(eq(tracks.id, trackId)).run();
      }
    }
  }

  publishFingerprintJobUpdate(jobId);
}
