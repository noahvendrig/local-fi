import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { musicbrainzEnrichJobTracks, musicbrainzEnrichJobs } from "../db/schema";

// Mirrors lib/fingerprint/events.ts's pattern — one process-wide emitter, namespaced by job id.
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export interface MusicbrainzEnrichJobSnapshot {
  job: typeof musicbrainzEnrichJobs.$inferSelect;
  tracks: (typeof musicbrainzEnrichJobTracks.$inferSelect)[];
}

export function loadMusicbrainzEnrichJobSnapshot(jobId: number): MusicbrainzEnrichJobSnapshot | null {
  const db = getDb();
  const job = db.select().from(musicbrainzEnrichJobs).where(eq(musicbrainzEnrichJobs.id, jobId)).get();
  if (!job) return null;
  const tracks = db.select().from(musicbrainzEnrichJobTracks).where(eq(musicbrainzEnrichJobTracks.jobId, jobId)).all();
  return { job, tracks };
}

export function publishMusicbrainzEnrichJobUpdate(jobId: number): void {
  const snapshot = loadMusicbrainzEnrichJobSnapshot(jobId);
  if (snapshot) emitter.emit(String(jobId), snapshot);
}

export function subscribeToMusicbrainzEnrichJob(jobId: number, listener: (snapshot: MusicbrainzEnrichJobSnapshot) => void): () => void {
  const eventName = String(jobId);
  emitter.on(eventName, listener);
  return () => emitter.off(eventName, listener);
}
