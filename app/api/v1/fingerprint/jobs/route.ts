import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { fingerprintJobTracks, fingerprintJobs, tracks } from "@/lib/db/schema";
import { loadFingerprintJobSnapshot } from "@/lib/fingerprint/events";
import { enqueueFingerprintJob } from "@/lib/fingerprint/queue";

const BodySchema = z.object({
  trackIds: z.array(z.number().int()).min(1).max(2000).optional(),
});

/**
 * POST /api/v1/fingerprint/jobs — starts an audio-fingerprinting pass for mixtape matching.
 * `trackIds` covers "fingerprint this one track again" / a caller-filtered subset; omitted means
 * "every track not already fingerprinted" (landmarkStatus none/failed) — the common backfill case
 * for an existing library, without the client having to first fetch and pass every track id.
 * Mirrors app/api/v1/analysis/jobs/route.ts.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid fingerprint request.", details: parsed.error.flatten() } },
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
        .where(and(isNull(tracks.deletedAt), or(eq(tracks.landmarkStatus, "none"), eq(tracks.landmarkStatus, "failed"))))
        .all()
        .map((t) => t.id);

  if (validIds.length === 0) {
    return NextResponse.json({ error: { code: "invalid_request", message: "No tracks need fingerprinting." } }, { status: 400 });
  }

  const now = new Date().toISOString();
  const job = db
    .insert(fingerprintJobs)
    .values({ uuid: randomUUID(), totalTracks: validIds.length, createdAt: now })
    .returning()
    .get();

  db.insert(fingerprintJobTracks)
    .values(validIds.map((trackId) => ({ jobId: job.id, trackId, createdAt: now, updatedAt: now })))
    .run();

  db.update(tracks).set({ landmarkStatus: "queued" }).where(inArray(tracks.id, validIds)).run();

  enqueueFingerprintJob(job.id);

  const snapshot = loadFingerprintJobSnapshot(job.id)!;
  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks }, { status: 201 });
}
