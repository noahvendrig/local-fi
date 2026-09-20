import { eq, sql } from "drizzle-orm";
import PQueue from "p-queue";
import { getDb } from "../db/client";
import { musicbrainzEnrichJobTracks, musicbrainzEnrichJobs } from "../db/schema";
import { MusicBrainzRateLimitedError } from "./client";
import { enrichTrackFromMusicBrainz } from "./enrichMatch";
import { publishMusicbrainzEnrichJobUpdate } from "./enrichEvents";

// Sequential, like lib/spotify/enrichQueue.ts, but for a stricter reason: MusicBrainz allows one
// request per second per client, and lib/musicbrainz/client.ts enforces that by serializing every
// call behind a shared delay chain. Raising concurrency here would not speed anything up -- the
// tasks would simply queue behind the same rate limiter -- while making a 503 more likely.
//
// The practical consequence: a run takes roughly one second per track (about 8 minutes for this
// library's 447), which is why this is an explicit user-triggered job rather than something that
// happens during import.
const queue = new PQueue({ concurrency: 1 });

const cancelledJobs = new Set<number>();
// Populated only when cancellation was triggered internally (the catalog rate-limiting us) rather
// than by the user hitting Cancel — lets every remaining track record *why* it never ran, instead
// of a bare "Cancelled" that reads like a user action.
const cancelReasons = new Map<number, string>();
const pendingCounts = new Map<number, number>();

const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

export function requestMusicbrainzEnrichJobCancellation(jobId: number, reason?: string): void {
  cancelledJobs.add(jobId);
  if (reason) cancelReasons.set(jobId, reason);
}

function finishJobIfDone(jobId: number): void {
  const remaining = pendingCounts.get(jobId) ?? 0;
  if (remaining > 0) return;

  const db = getDb();
  const job = db.select().from(musicbrainzEnrichJobs).where(eq(musicbrainzEnrichJobs.id, jobId)).get();
  if (!job || TERMINAL_STATUSES.has(job.status)) return;

  const status = job.failedTracks === 0 ? "completed" : job.failedTracks >= job.totalTracks ? "failed" : "completed_with_errors";

  db.update(musicbrainzEnrichJobs).set({ status, finishedAt: new Date().toISOString() }).where(eq(musicbrainzEnrichJobs.id, jobId)).run();

  cancelledJobs.delete(jobId);
  cancelReasons.delete(jobId);
  pendingCounts.delete(jobId);
  publishMusicbrainzEnrichJobUpdate(jobId);
}

/** Enqueues every `queued` track belonging to a freshly-created enrichment job — mirrors
 *  lib/spotify/enrichQueue.ts's enqueueSpotifyEnrichJob. */
export function enqueueMusicbrainzEnrichJob(jobId: number): void {
  const db = getDb();
  const job = db.select().from(musicbrainzEnrichJobs).where(eq(musicbrainzEnrichJobs.id, jobId)).get();
  if (!job) return;

  const items = db
    .select()
    .from(musicbrainzEnrichJobTracks)
    .where(eq(musicbrainzEnrichJobTracks.jobId, jobId))
    .all()
    .filter((t) => t.status === "queued");

  if (items.length === 0) return;

  pendingCounts.set(jobId, items.length);
  db.update(musicbrainzEnrichJobs).set({ status: "running", startedAt: new Date().toISOString() }).where(eq(musicbrainzEnrichJobs.id, jobId)).run();
  publishMusicbrainzEnrichJobUpdate(jobId);

  for (const item of items) {
    void queue.add(async () => {
      if (cancelledJobs.has(jobId)) {
        const now = new Date().toISOString();
        getDb()
          .update(musicbrainzEnrichJobTracks)
          .set({ status: "failed", errorMessage: cancelReasons.get(jobId) ?? "Cancelled", updatedAt: now })
          .where(eq(musicbrainzEnrichJobTracks.id, item.id))
          .run();
        getDb()
          .update(musicbrainzEnrichJobs)
          .set({ failedTracks: sql`${musicbrainzEnrichJobs.failedTracks} + 1`, processedTracks: sql`${musicbrainzEnrichJobs.processedTracks} + 1` })
          .where(eq(musicbrainzEnrichJobs.id, jobId))
          .run();
        publishMusicbrainzEnrichJobUpdate(jobId);
      } else {
        try {
          await enrichTrackFromMusicBrainz(item.trackId, item.id, jobId);
        } catch (err) {
          // Being rate-limited means every remaining track would get the same answer, so stop the
          // run rather than burning through them. Any other error is this one track's problem.
          if (err instanceof MusicBrainzRateLimitedError) {
            requestMusicbrainzEnrichJobCancellation(jobId, err.message);
          }
          const now = new Date().toISOString();
          getDb()
            .update(musicbrainzEnrichJobTracks)
            .set({ status: "failed", errorMessage: err instanceof Error ? err.message : "Enrichment failed.", updatedAt: now })
            .where(eq(musicbrainzEnrichJobTracks.id, item.id))
            .run();
          getDb()
            .update(musicbrainzEnrichJobs)
            .set({ failedTracks: sql`${musicbrainzEnrichJobs.failedTracks} + 1`, processedTracks: sql`${musicbrainzEnrichJobs.processedTracks} + 1` })
            .where(eq(musicbrainzEnrichJobs.id, jobId))
            .run();
          publishMusicbrainzEnrichJobUpdate(jobId);
        }
      }

      pendingCounts.set(jobId, (pendingCounts.get(jobId) ?? 1) - 1);
      finishJobIfDone(jobId);
    });
  }
}
