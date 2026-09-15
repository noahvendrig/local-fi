import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { similarityJobTracks, similarityJobs } from "../db/schema";

// Mirrors lib/fingerprint/events.ts's pattern — one process-wide emitter, namespaced by job id.
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export interface SimilarityJobSnapshot {
  job: typeof similarityJobs.$inferSelect;
  tracks: (typeof similarityJobTracks.$inferSelect)[];
}

export function loadSimilarityJobSnapshot(jobId: number): SimilarityJobSnapshot | null {
  const db = getDb();
  const job = db.select().from(similarityJobs).where(eq(similarityJobs.id, jobId)).get();
  if (!job) return null;
  const tracks = db.select().from(similarityJobTracks).where(eq(similarityJobTracks.jobId, jobId)).all();
  return { job, tracks };
}

export function publishSimilarityJobUpdate(jobId: number): void {
  const snapshot = loadSimilarityJobSnapshot(jobId);
  if (snapshot) emitter.emit(String(jobId), snapshot);
}

export function subscribeToSimilarityJob(jobId: number, listener: (snapshot: SimilarityJobSnapshot) => void): () => void {
  const eventName = String(jobId);
  emitter.on(eventName, listener);
  return () => emitter.off(eventName, listener);
}
