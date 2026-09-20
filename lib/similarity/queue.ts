import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { similarityJobTracks, similarityJobs, tracks } from "../db/schema";
import {
  cancelPythonSimilarityJob,
  postTrackSimilarityJob,
  streamSimilarityJobUntilDone,
  type PythonSimilarityJobResponse,
} from "../pythonBackend/similarityClient";
import { resolveTrackAbsPath } from "../storage/resolveTrackPath";
import { publishSimilarityJobUpdate } from "./events";

// Mirrors lib/fingerprint/queue.ts's shape exactly: no local p-queue/concurrency here (the DSP
// work runs on python-backend, which owns its own concurrency via SIMILARITY_MAX_CONCURRENT_JOBS).
// This module's job is just to submit one batch job to that service and relay its SSE progress
// into our own similarityJobs/similarityJobTracks rows + tracks.similarityStatus (and, as a side
// effect of the same job, tracks.genre — see the isNull-guarded update in applyUpdate below).

export function requestSimilarityJobCancellation(jobId: number): void {
  const db = getDb();
  const job = db.select().from(similarityJobs).where(eq(similarityJobs.id, jobId)).get();
  if (job?.pythonJobId) void cancelPythonSimilarityJob(job.pythonJobId);
}

/** Fire-and-forget entry point for auto-analyzing a single freshly-imported track for Smart
 *  Shuffle -- creates its own one-track similarityJobs row so status flows through the same
 *  job/SSE machinery as a bulk backfill, without the caller having to explicitly request one
 *  (mirrors lib/fingerprint/queue.ts's enqueueTrackFingerprint). */
export function enqueueTrackSimilarity(trackId: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  const job = db.insert(similarityJobs).values({ uuid: randomUUID(), totalTracks: 1, createdAt: now }).returning().get();
  const jobTrack = db
    .insert(similarityJobTracks)
    .values({ jobId: job.id, trackId, createdAt: now, updatedAt: now })
    .returning()
    .get();
  db.update(tracks).set({ similarityStatus: "queued" }).where(eq(tracks.id, trackId)).run();

  void runJob(job.id, new Map([[trackId, jobTrack.id]]));
}

/** Enqueues every `queued` track belonging to a freshly-created similarity job (bulk backfill,
 *  mirrors lib/fingerprint/queue.ts's enqueueFingerprintJob -- rows already exist, created by the
 *  caller). */
export function enqueueSimilarityJob(jobId: number): void {
  const db = getDb();
  const items = db
    .select()
    .from(similarityJobTracks)
    .where(eq(similarityJobTracks.jobId, jobId))
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
    db.update(similarityJobs).set({ status: "failed", finishedAt: now() }).where(eq(similarityJobs.id, jobId)).run();
    publishSimilarityJobUpdate(jobId);
    return;
  }

  db.update(similarityJobs).set({ status: "running", startedAt: now() }).where(eq(similarityJobs.id, jobId)).run();
  for (const trackId of jobTrackIdByTrackId.keys()) {
    db.update(tracks).set({ similarityStatus: "processing" }).where(eq(tracks.id, trackId)).run();
  }
  publishSimilarityJobUpdate(jobId);

  let appliedCount = 0;
  const applyUpdate = (payload: PythonSimilarityJobResponse) => {
    const newResults = payload.track_results.slice(appliedCount);
    appliedCount = payload.track_results.length;

    for (const r of newResults) {
      const jobTrackId = jobTrackIdByTrackId.get(r.track_id);
      if (jobTrackId == null) continue;

      if (r.status === "done") {
        db.update(similarityJobTracks).set({ status: "done", updatedAt: now() }).where(eq(similarityJobTracks.id, jobTrackId)).run();
        db.update(tracks)
          .set({ similarityStatus: "ready", similarityAnalyzedAt: now() })
          .where(eq(tracks.id, r.track_id))
          .run();
        // Audio-based genre detection rides along on the same model pass as the similarity
        // embedding (python-backend's extract_embedding_and_genre) — fill it in here, same "never
        // overwrite, only fill gaps" contract as every other metadata source (Spotify enrich,
        // tag extraction). The isNull guard makes this an atomic conditional update rather than a
        // read-then-write, so a concurrent manual edit can't be raced.
        if (r.genre != null) {
          db.update(tracks)
            .set({ genre: r.genre })
            .where(and(eq(tracks.id, r.track_id), isNull(tracks.genre)))
            .run();
        }
        db.update(similarityJobs)
          .set({ processedTracks: sql`${similarityJobs.processedTracks} + 1` })
          .where(eq(similarityJobs.id, jobId))
          .run();
      } else {
        db.update(similarityJobTracks)
          .set({ status: "failed", errorMessage: r.error, updatedAt: now() })
          .where(eq(similarityJobTracks.id, jobTrackId))
          .run();
        db.update(tracks).set({ similarityStatus: "failed" }).where(eq(tracks.id, r.track_id)).run();
        db.update(similarityJobs)
          .set({ processedTracks: sql`${similarityJobs.processedTracks} + 1`, failedTracks: sql`${similarityJobs.failedTracks} + 1` })
          .where(eq(similarityJobs.id, jobId))
          .run();
      }
    }
    publishSimilarityJobUpdate(jobId);
  };

  try {
    const initial = await postTrackSimilarityJob(pythonTracks);
    db.update(similarityJobs).set({ pythonJobId: initial.id }).where(eq(similarityJobs.id, jobId)).run();

    await streamSimilarityJobUntilDone(initial.id, applyUpdate);

    const finalRow = db.select().from(similarityJobs).where(eq(similarityJobs.id, jobId)).get();
    const status =
      !finalRow || finalRow.failedTracks === 0
        ? "completed"
        : finalRow.failedTracks >= finalRow.totalTracks
          ? "failed"
          : "completed_with_errors";
    db.update(similarityJobs).set({ status, finishedAt: now() }).where(eq(similarityJobs.id, jobId)).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Similarity analysis failed — is python-backend running?";
    db.update(similarityJobs).set({ status: "failed", finishedAt: now() }).where(eq(similarityJobs.id, jobId)).run();
    // Anything we never heard back about from Python (backend unreachable, crashed mid-batch)
    // shouldn't stay stuck at "processing" forever.
    for (const [trackId, jobTrackId] of jobTrackIdByTrackId) {
      const row = db.select().from(similarityJobTracks).where(eq(similarityJobTracks.id, jobTrackId)).get();
      if (row?.status === "queued" || row?.status === "processing") {
        db.update(similarityJobTracks)
          .set({ status: "failed", errorMessage: message, updatedAt: now() })
          .where(eq(similarityJobTracks.id, jobTrackId))
          .run();
        db.update(tracks).set({ similarityStatus: "failed" }).where(eq(tracks.id, trackId)).run();
      }
    }
  }

  publishSimilarityJobUpdate(jobId);
}
