import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { playEvents, tracks } from "@/lib/db/schema";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });

/**
 * POST /api/v1/tracks/:id/play — records a completed listen: one `play_events` row plus the
 * denormalized `tracks.playCount`/`lastPlayedAt` counters the crate-rule engine already reads
 * (lib/crates/rules.ts). Called once per natural track completion (TransportBar's `onEnded`).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const db = getDb();
  const existing = db.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt))).get();
  if (!existing) return NOT_FOUND;

  const playedAt = new Date().toISOString();
  db.transaction((tx) => {
    tx.insert(playEvents).values({ trackId, playedAt }).run();
    tx.update(tracks)
      .set({ playCount: sql`${tracks.playCount} + 1`, lastPlayedAt: playedAt })
      .where(eq(tracks.id, trackId))
      .run();
  });

  return new NextResponse(null, { status: 204 });
}
