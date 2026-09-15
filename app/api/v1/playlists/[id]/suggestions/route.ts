import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { playlistTracks, playlists, tracks } from "@/lib/db/schema";
import { getTrackSummariesByIds } from "@/lib/db/trackSummary";
import { fetchSimilarToTrackSet } from "@/lib/pythonBackend/similarityClient";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Playlist not found." } }, { status: 404 });

/**
 * GET /api/v1/playlists/:id/suggestions — "songs from the library that fit this crate," for the
 * suggestions strip at the bottom of a crate's tracklist. Centroid-based: averages the crate's
 * analyzed members' embeddings into one vector and searches the whole library against it (see
 * SimilarityIndex.similar_to_set on python-backend). Manual crates only -- a smart crate has no
 * persisted membership to add a suggestion into, so this always returns an empty list for one.
 * Never errors on "not enough data yet" -- returns `{ suggestions: [] }` so the UI can just hide
 * the section.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId)) return NOT_FOUND;

  const db = getDb();
  const playlist = db.select().from(playlists).where(eq(playlists.id, playlistId)).get();
  if (!playlist) return NOT_FOUND;
  if (playlist.type !== "manual") {
    return NextResponse.json({ suggestions: [] });
  }

  const members = db
    .select({ id: tracks.id, similarityStatus: tracks.similarityStatus })
    .from(playlistTracks)
    .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
    .where(and(eq(playlistTracks.playlistId, playlistId), isNull(tracks.deletedAt)))
    .all();

  // Dedupe: a manual crate can have the same track added more than once (repeats intentionally
  // allowed for playback), but that must never (a) skew the centroid toward that track via
  // double-counting or (b) let the same suggestion surface twice.
  const memberIds = [...new Set(members.map((t) => t.id))];
  const readyMemberIds = [...new Set(members.filter((t) => t.similarityStatus === "ready").map((t) => t.id))];
  if (readyMemberIds.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  const matches = await fetchSimilarToTrackSet(readyMemberIds, { excludeIds: memberIds, topK: 5 });
  const uniqueTrackIds = [...new Set(matches.map((m) => m.track_id))];
  const suggestions = getTrackSummariesByIds(db, uniqueTrackIds);
  return NextResponse.json({ suggestions });
}
