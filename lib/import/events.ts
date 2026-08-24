import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { importJobFiles, importJobs } from "../db/schema";

// One process-wide emitter; events are namespaced by job id string. SSE route
// handlers subscribe per-job — cheap for a single-user local server (ARCHITECTURE.md §7).
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export interface JobSnapshot {
  job: typeof importJobs.$inferSelect;
  files: (typeof importJobFiles.$inferSelect)[];
}

export function loadJobSnapshot(jobId: number): JobSnapshot | null {
  const db = getDb();
  const job = db.select().from(importJobs).where(eq(importJobs.id, jobId)).get();
  if (!job) return null;
  const files = db.select().from(importJobFiles).where(eq(importJobFiles.jobId, jobId)).all();
  return { job, files };
}

/** Re-reads the job from DB and notifies any subscribed SSE streams. */
export function publishJobUpdate(jobId: number): void {
  const snapshot = loadJobSnapshot(jobId);
  if (snapshot) emitter.emit(String(jobId), snapshot);
}

export function subscribeToJob(jobId: number, listener: (snapshot: JobSnapshot) => void): () => void {
  const eventName = String(jobId);
  emitter.on(eventName, listener);
  return () => emitter.off(eventName, listener);
}
