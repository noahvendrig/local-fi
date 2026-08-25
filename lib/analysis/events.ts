import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { analysisJobTracks, analysisJobs } from "../db/schema";

// Mirrors lib/import/events.ts's pattern — one process-wide emitter, namespaced by job id.
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export interface AnalysisJobSnapshot {
  job: typeof analysisJobs.$inferSelect;
  tracks: (typeof analysisJobTracks.$inferSelect)[];
}

export function loadAnalysisJobSnapshot(jobId: number): AnalysisJobSnapshot | null {
  const db = getDb();
  const job = db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get();
  if (!job) return null;
  const tracks = db.select().from(analysisJobTracks).where(eq(analysisJobTracks.jobId, jobId)).all();
  return { job, tracks };
}

export function publishAnalysisJobUpdate(jobId: number): void {
  const snapshot = loadAnalysisJobSnapshot(jobId);
  if (snapshot) emitter.emit(String(jobId), snapshot);
}

export function subscribeToAnalysisJob(jobId: number, listener: (snapshot: AnalysisJobSnapshot) => void): () => void {
  const eventName = String(jobId);
  emitter.on(eventName, listener);
  return () => emitter.off(eventName, listener);
}
