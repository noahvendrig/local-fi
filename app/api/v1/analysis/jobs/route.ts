import { randomUUID } from "node:crypto";
import { and, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { analysisJobTracks, analysisJobs, tracks } from "@/lib/db/schema";
import { enqueueAnalysisJob } from "@/lib/analysis/queue";
import { loadAnalysisJobSnapshot } from "@/lib/analysis/events";

const BodySchema = z.object({
  trackIds: z.array(z.number().int()).min(1).max(2000),
});

/**
 * POST /api/v1/analysis/jobs — starts an on-demand BPM/key analysis pass over the given tracks
 * (DJ view §Phase 3). Covers both "analyze this track" (one id) and "analyze this crate" (many
 * ids, filtered by the caller to tracks not already analyzed) through the same endpoint.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid analysis request.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const db = getDb();
  const validIds = db
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(inArray(tracks.id, parsed.data.trackIds), isNull(tracks.deletedAt)))
    .all()
    .map((t) => t.id);

  if (validIds.length === 0) {
    return NextResponse.json({ error: { code: "invalid_request", message: "No valid tracks to analyze." } }, { status: 400 });
  }

  const now = new Date().toISOString();
  const job = db
    .insert(analysisJobs)
    .values({ uuid: randomUUID(), totalTracks: validIds.length, createdAt: now })
    .returning()
    .get();

  db.insert(analysisJobTracks)
    .values(validIds.map((trackId) => ({ jobId: job.id, trackId, createdAt: now, updatedAt: now })))
    .run();

  db.update(tracks)
    .set({ analysisStatus: "queued" })
    .where(inArray(tracks.id, validIds))
    .run();

  enqueueAnalysisJob(job.id);

  const snapshot = loadAnalysisJobSnapshot(job.id)!;
  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks }, { status: 201 });
}
