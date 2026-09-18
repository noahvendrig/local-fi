import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { playlistTracks, playlists, tracks } from "@/lib/db/schema";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });

/** GET /api/v1/tracks/:id/crates — ids of the manual crates this track already belongs to, for the library row's "Add to crate" picker. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const db = getDb();
  const track = db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, trackId)).get();
  if (!track) return NOT_FOUND;

  const rows = db
    .select({ playlistId: playlistTracks.playlistId })
    .from(playlistTracks)
    .innerJoin(playlists, eq(playlists.id, playlistTracks.playlistId))
    .where(and(eq(playlistTracks.trackId, trackId), eq(playlists.type, "manual")))
    .all();

  return NextResponse.json({ playlistIds: rows.map((r) => r.playlistId) });
}
