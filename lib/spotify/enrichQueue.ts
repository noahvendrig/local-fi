import { eq, sql } from "drizzle-orm";
import PQueue from "p-queue";
import { getDb } from "../db/client";
import { spotifyEnrichJobTracks, spotifyEnrichJobs } from "../db/schema";
import { SpotifyQuotaExceededError } from "./client";
import { enrichTrackFromSpotify } from "./enrichMatch";
import { publishSpotifyEnrichJobUpdate } from "./enrichEvents";

// Network-bound (Spotify Web API calls) against a strict, undocumented per-app rate limit shared
// across every Spotify call this process makes (lib/spotify/client.ts's spotifyGet already
// serializes around a 429 cooldown) — running more than one of these at a time just means more
// callers racing to discover the same limit, so this stays sequential rather than using
// lib/analysis/queue.ts's CPU-core-based concurrency.
const queue = new PQueue({ concurrency: 1 });

const cancelledJobs = new Set<number>();
// Populated only when cancellation was triggered internally (quota exhaustion) rather than by the
// user hitting Cancel — lets every remaining queued track record *why* it never got a chance to
// run, instead of a bare "Cancelled" that reads like a user action.
const cancelReasons = new Map<number, string>();
const pendingCounts = new Map<number, number>();

const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

export function requestSpotifyEnrichJobCancellation(jobId: number, reason?: string): void {
  cancelledJobs.add(jobId);
  if (reason) cancelReasons.set(jobId, reason);
}

function finishJobIfDone(jobId: number): void {
  const remaining = pendingCounts.get(jobId) ?? 0;
  if (remaining > 0) return;

  const db = getDb();
  const job = db.select().from(spotifyEnrichJobs).where(eq(spotifyEnrichJobs.id, jobId)).get();
  if (!job || TERMINAL_STATUSES.has(job.status)) return;

  const status = job.failedTracks === 0 ? "completed" : job.failedTracks >= job.totalTracks ? "failed" : "completed_with_errors";

  db.update(spotifyEnrichJobs)
    .set({ status, finishedAt: new Date().toISOString() })
    .where(eq(spotifyEnrichJobs.id, jobId))
    .run();

  cancelledJobs.delete(jobId);
  cancelReasons.delete(jobId);
  pendingCounts.delete(jobId);
  publishSpotifyEnrichJobUpdate(jobId);
}

/** Enqueues every `queued` track belonging to a freshly-created enrichment job — mirrors
 *  lib/analysis/queue.ts's enqueueAnalysisJob. */
export function enqueueSpotifyEnrichJob(jobId: number): void {
  const db = getDb();
  const job = db.select().from(spotifyEnrichJobs).where(eq(spotifyEnrichJobs.id, jobId)).get();
  if (!job) return;

  const items = db
    .select()
    .from(spotifyEnrichJobTracks)
    .where(eq(spotifyEnrichJobTracks.jobId, jobId))
    .all()
    .filter((t) => t.status === "queued");

  if (items.length === 0) return;

  pendingCounts.set(jobId, items.length);
  db.update(spotifyEnrichJobs).set({ status: "running", startedAt: new Date().toISOString() }).where(eq(spotifyEnrichJobs.id, jobId)).run();
  publishSpotifyEnrichJobUpdate(jobId);

  for (const item of items) {
    void queue.add(async () => {
      if (cancelledJobs.has(jobId)) {
        const now = new Date().toISOString();
        getDb()
          .update(spotifyEnrichJobTracks)
          .set({ status: "failed", errorMessage: cancelReasons.get(jobId) ?? "Cancelled", updatedAt: now })
          .where(eq(spotifyEnrichJobTracks.id, item.id))
          .run();
        getDb()
          .update(spotifyEnrichJobs)
          .set({ failedTracks: sql`${spotifyEnrichJobs.failedTracks} + 1`, processedTracks: sql`${spotifyEnrichJobs.processedTracks} + 1` })
          .where(eq(spotifyEnrichJobs.id, jobId))
          .run();
        publishSpotifyEnrichJobUpdate(jobId);
      } else {
        try {
          await enrichTrackFromSpotify(item.trackId, item.id, jobId);
        } catch (err) {
          // enrichTrackFromSpotify already recorded this one track as failed before rethrowing —
          // this catch only decides whether the rest of the job should stop too.
          if (err instanceof SpotifyQuotaExceededError) {
            requestSpotifyEnrichJobCancellation(jobId, err.message);
          }
        }
      }

      pendingCounts.set(jobId, (pendingCounts.get(jobId) ?? 1) - 1);
      finishJobIfDone(jobId);
    });
  }
}
