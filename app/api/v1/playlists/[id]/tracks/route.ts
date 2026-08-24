import { asc, eq } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { playlistTracks, playlists, tracks } from "@/lib/db/schema";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Playlist not found." } }, { status: 404 });

const AddTrackSchema = z.object({
  trackId: z.number().int().positive(),
  /** Position string of the entry to insert directly after; omitted = append at the end. */
  afterPosition: z.string().optional(),
});

/** POST /api/v1/playlists/:id/tracks — add a track to a manual playlist (ARCHITECTURE.md §7). */
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
  const parsed = AddTrackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid track add.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const track = db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, parsed.data.trackId)).get();
  if (!track) {
    return NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });
  }

  const positions = db
    .select({ position: playlistTracks.position })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position))
    .all()
    .map((r) => r.position);

  let newPosition: string;
  if (parsed.data.afterPosition) {
    const idx = positions.indexOf(parsed.data.afterPosition);
    const next = idx >= 0 ? (positions[idx + 1] ?? null) : null;
    newPosition = generateKeyBetween(parsed.data.afterPosition, next);
  } else {
    newPosition = generateKeyBetween(positions[positions.length - 1] ?? null, null);
  }

  const now = new Date().toISOString();
  const entry = db
    .insert(playlistTracks)
    .values({ playlistId, trackId: track.id, position: newPosition, addedAt: now })
    .returning()
    .get();

  return NextResponse.json(
    { id: entry.id, playlistId: entry.playlistId, trackId: entry.trackId, position: entry.position, addedAt: entry.addedAt },
    { status: 201 }
  );
}
