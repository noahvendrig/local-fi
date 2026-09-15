import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { similarityJobTracks, similarityJobs, tracks } from "@/lib/db/schema";
import { loadSimilarityJobSnapshot } from "@/lib/similarity/events";
import { enqueueSimilarityJob } from "@/lib/similarity/queue";

const BodySchema = z.object({
  trackIds: z.array(z.number().int()).min(1).max(2000).optional(),
});

/**
 * POST /api/v1/similarity/jobs — starts an audio-similarity embedding pass for Smart Shuffle.
 * `trackIds` covers "analyze this one track again" / a caller-filtered subset; omitted means
 * "every track not already analyzed" (similarityStatus none/failed) — the common backfill case
 * for an existing library. Mirrors app/api/v1/fingerprint/jobs/route.ts.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid similarity request.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const db = getDb();
  const validIds = parsed.data.trackIds
    ? db
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(inArray(tracks.id, parsed.data.trackIds), isNull(tracks.deletedAt)))
        .all()
        .map((t) => t.id)
    : db
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(isNull(tracks.deletedAt), or(eq(tracks.similarityStatus, "none"), eq(tracks.similarityStatus, "failed"))))
        .all()
        .map((t) => t.id);

  if (validIds.length === 0) {
    return NextResponse.json({ error: { code: "invalid_request", message: "No tracks need similarity analysis." } }, { status: 400 });
  }

  const now = new Date().toISOString();
  const job = db
    .insert(similarityJobs)
    .values({ uuid: randomUUID(), totalTracks: validIds.length, createdAt: now })
    .returning()
    .get();

  db.insert(similarityJobTracks)
    .values(validIds.map((trackId) => ({ jobId: job.id, trackId, createdAt: now, updatedAt: now })))
    .run();

  db.update(tracks).set({ similarityStatus: "queued" }).where(inArray(tracks.id, validIds)).run();

  enqueueSimilarityJob(job.id);

  const snapshot = loadSimilarityJobSnapshot(job.id)!;
  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks }, { status: 201 });
}
