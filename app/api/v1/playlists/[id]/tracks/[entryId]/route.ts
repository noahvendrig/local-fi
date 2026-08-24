import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { playlistTracks } from "@/lib/db/schema";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Playlist entry not found." } }, { status: 404 });

const ReorderSchema = z.object({ position: z.string().min(1) });

// The route segment is named :entryId (the playlist_tracks row id), not :trackId as
// ARCHITECTURE.md's endpoint table literally names it — §3.4 explicitly allows the same
// track twice in one playlist, so targeting by trackId alone would be ambiguous.

/** PATCH /api/v1/playlists/:id/tracks/:entryId — reorder one entry to a new fractional position. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const playlistId = Number(id);
  const entryIdNum = Number(entryId);
  if (!Number.isInteger(playlistId) || !Number.isInteger(entryIdNum)) return NOT_FOUND;

  const db = getDb();
  const entry = db
    .select({ id: playlistTracks.id })
    .from(playlistTracks)
    .where(and(eq(playlistTracks.id, entryIdNum), eq(playlistTracks.playlistId, playlistId)))
    .get();
  if (!entry) return NOT_FOUND;

  const body = await request.json().catch(() => null);
  const parsed = ReorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid reorder.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const updated = db
    .update(playlistTracks)
    .set({ position: parsed.data.position })
    .where(eq(playlistTracks.id, entryIdNum))
    .returning()
    .get();

  return NextResponse.json({
    id: updated.id,
    playlistId: updated.playlistId,
    trackId: updated.trackId,
    position: updated.position,
    addedAt: updated.addedAt,
  });
}

/** DELETE /api/v1/playlists/:id/tracks/:entryId — remove one entry from the playlist. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const playlistId = Number(id);
  const entryIdNum = Number(entryId);
  if (!Number.isInteger(playlistId) || !Number.isInteger(entryIdNum)) return NOT_FOUND;

  const db = getDb();
  const entry = db
    .select({ id: playlistTracks.id })
    .from(playlistTracks)
    .where(and(eq(playlistTracks.id, entryIdNum), eq(playlistTracks.playlistId, playlistId)))
    .get();
  if (!entry) return NOT_FOUND;

  db.delete(playlistTracks).where(eq(playlistTracks.id, entryIdNum)).run();
  return new NextResponse(null, { status: 204 });
}
