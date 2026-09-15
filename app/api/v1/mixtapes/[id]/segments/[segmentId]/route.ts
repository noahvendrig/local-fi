import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { mixtapeSegments, tracks } from "@/lib/db/schema";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Segment not found." } }, { status: 404 });

const PatchSchema = z.object({
  matchedTrackId: z.number().int().positive().nullable(),
});

/**
 * PATCH /api/v1/mixtapes/:id/segments/:segmentId — the core reassignment mutation: assign a local
 * track to a segment (matchStatus becomes "manual") or clear it back to "unrecognized". Manual
 * assignments have no algorithmic confidence/tempo/source-offset, so those are cleared too.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; segmentId: string }> }) {
  const { id, segmentId } = await params;
  const mixtapeId = Number(id);
  const segId = Number(segmentId);
  if (!Number.isInteger(mixtapeId) || !Number.isInteger(segId)) return NOT_FOUND;

  const db = getDb();
  const existing = db
    .select()
    .from(mixtapeSegments)
    .where(and(eq(mixtapeSegments.id, segId), eq(mixtapeSegments.mixtapeId, mixtapeId)))
    .get();
  if (!existing) return NOT_FOUND;

  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid segment update.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const { matchedTrackId } = parsed.data;
  if (matchedTrackId != null) {
    const track = db.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, matchedTrackId), isNull(tracks.deletedAt))).get();
    if (!track) {
      return NextResponse.json({ error: { code: "invalid_request", message: "Track not found." } }, { status: 400 });
    }
  }

  db.update(mixtapeSegments)
    .set({
      matchedTrackId,
      matchStatus: matchedTrackId != null ? "manual" : "unrecognized",
      confidenceScore: null,
      matchedTempoRatio: null,
      sourceStartSeconds: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(mixtapeSegments.id, segId))
    .run();

  const updated = db.select().from(mixtapeSegments).where(eq(mixtapeSegments.id, segId)).get();
  return NextResponse.json(updated);
}
