import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { spotifyEnrichJobTracks, spotifyEnrichJobs } from "../db/schema";

// Mirrors lib/fingerprint/events.ts's pattern — one process-wide emitter, namespaced by job id.
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export interface SpotifyEnrichJobSnapshot {
  job: typeof spotifyEnrichJobs.$inferSelect;
  tracks: (typeof spotifyEnrichJobTracks.$inferSelect)[];
}

export function loadSpotifyEnrichJobSnapshot(jobId: number): SpotifyEnrichJobSnapshot | null {
  const db = getDb();
  const job = db.select().from(spotifyEnrichJobs).where(eq(spotifyEnrichJobs.id, jobId)).get();
  if (!job) return null;
  const tracks = db.select().from(spotifyEnrichJobTracks).where(eq(spotifyEnrichJobTracks.jobId, jobId)).all();
  return { job, tracks };
}

export function publishSpotifyEnrichJobUpdate(jobId: number): void {
  const snapshot = loadSpotifyEnrichJobSnapshot(jobId);
  if (snapshot) emitter.emit(String(jobId), snapshot);
}

export function subscribeToSpotifyEnrichJob(jobId: number, listener: (snapshot: SpotifyEnrichJobSnapshot) => void): () => void {
  const eventName = String(jobId);
  emitter.on(eventName, listener);
  return () => emitter.off(eventName, listener);
}
