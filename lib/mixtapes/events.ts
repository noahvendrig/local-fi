import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { mixtapeJobs } from "../db/schema";

// Mirrors lib/fingerprint/events.ts's pattern — one process-wide emitter, namespaced by job id.
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export type MixtapeJobSnapshot = typeof mixtapeJobs.$inferSelect;

export function loadMixtapeJobSnapshot(jobId: number): MixtapeJobSnapshot | null {
  const db = getDb();
  return db.select().from(mixtapeJobs).where(eq(mixtapeJobs.id, jobId)).get() ?? null;
}

export function publishMixtapeJobUpdate(jobId: number): void {
  const snapshot = loadMixtapeJobSnapshot(jobId);
  if (snapshot) emitter.emit(String(jobId), snapshot);
}

export function subscribeToMixtapeJob(jobId: number, listener: (snapshot: MixtapeJobSnapshot) => void): () => void {
  const eventName = String(jobId);
  emitter.on(eventName, listener);
  return () => emitter.off(eventName, listener);
}
