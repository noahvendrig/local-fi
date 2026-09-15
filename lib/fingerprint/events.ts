import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { fingerprintJobTracks, fingerprintJobs } from "../db/schema";

// Mirrors lib/analysis/events.ts's pattern — one process-wide emitter, namespaced by job id.
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export interface FingerprintJobSnapshot {
  job: typeof fingerprintJobs.$inferSelect;
  tracks: (typeof fingerprintJobTracks.$inferSelect)[];
}

export function loadFingerprintJobSnapshot(jobId: number): FingerprintJobSnapshot | null {
  const db = getDb();
  const job = db.select().from(fingerprintJobs).where(eq(fingerprintJobs.id, jobId)).get();
  if (!job) return null;
  const tracks = db.select().from(fingerprintJobTracks).where(eq(fingerprintJobTracks.jobId, jobId)).all();
  return { job, tracks };
}

export function publishFingerprintJobUpdate(jobId: number): void {
  const snapshot = loadFingerprintJobSnapshot(jobId);
  if (snapshot) emitter.emit(String(jobId), snapshot);
}

export function subscribeToFingerprintJob(jobId: number, listener: (snapshot: FingerprintJobSnapshot) => void): () => void {
  const eventName = String(jobId);
  emitter.on(eventName, listener);
  return () => emitter.off(eventName, listener);
}
