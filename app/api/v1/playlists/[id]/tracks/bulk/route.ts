import { asc, eq, inArray } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { playlistTracks, playlists, tracks } from "@/lib/db/schema";
import type { PlaylistTrackEntry } from "@/lib/api/playlistsClient";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Playlist not found." } }, { status: 404 });

const BodySchema = z.object({
  trackIds: z.array(z.number().int().positive()).min(1).max(200),
});

/** POST /api/v1/playlists/:id/tracks/bulk — append many tracks to a manual crate in one pass
 *  (e.g. a vibe-prompt crate's ~30 picks), computing every fractional position up front and
 *  inserting in one transaction instead of looping the single-track POST /tracks route. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId)) return NOT_FOUND;

  const db = getDb();
  const playlist = db.select().from(playlists).where(eq(playlists.id, playlistId)).get();
  if (!playlist) return NOT_FOUND;
  if (playlist.type !== "manual") {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Tracks can only be added directly to a manual playlist." } },
      { status: 422 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid bulk track add.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const validIds = new Set(
    db.select({ id: tracks.id }).from(tracks).where(inArray(tracks.id, parsed.data.trackIds)).all().map((t) => t.id)
  );
  // Preserve the caller's order (the LLM's ranking) while dropping any id that doesn't exist.
  const trackIds = parsed.data.trackIds.filter((tid) => validIds.has(tid));
  if (trackIds.length === 0) {
    return NextResponse.json({ error: { code: "not_found", message: "None of the given tracks exist." } }, { status: 404 });
  }

  const lastPosition = db
    .select({ position: playlistTracks.position })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position))
    .all()
    .map((r) => r.position)
    .at(-1);

  const now = new Date().toISOString();
  const values: (typeof playlistTracks.$inferInsert)[] = [];
  let cursor: string | null = lastPosition ?? null;
  for (const trackId of trackIds) {
    const position = generateKeyBetween(cursor, null);
    cursor = position;
    values.push({ playlistId, trackId, position, addedAt: now });
  }

  const inserted = db.insert(playlistTracks).values(values).returning().all() as PlaylistTrackEntry[];
  return NextResponse.json({ items: inserted }, { status: 201 });
}
