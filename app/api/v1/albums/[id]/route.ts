import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { albumArtists, albums, artists, trackArtists, tracks } from "@/lib/db/schema";
import { mapTrackSummaryRow, trackSummarySelectColumns } from "@/lib/db/trackSummary";
import { formatArtistCredit } from "@/lib/format/artistCredit";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Album not found." } }, { status: 404 });

/** GET /api/v1/albums/:id — hero fields + credited artists + ordered tracklist (ARCHITECTURE.md §7). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const albumId = Number(id);
  if (!Number.isInteger(albumId)) return NOT_FOUND;

  const db = getDb();
  const album = db.select().from(albums).where(eq(albums.id, albumId)).get();
  if (!album) return NOT_FOUND;

  // album_artists is the source of truth for the credited-artist list (§3.3) — the
  // denormalized albums.albumArtistId is just the display-fast pointer to the first row.
  const creditedArtists = db
    .select({ id: artists.id, name: artists.name })
    .from(albumArtists)
    .innerJoin(artists, eq(albumArtists.artistId, artists.id))
    .where(eq(albumArtists.albumId, albumId))
    .orderBy(asc(albumArtists.position))
    .all();

  const trackRows = db
    .select(trackSummarySelectColumns)
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(and(eq(tracks.albumId, albumId), isNull(tracks.deletedAt)))
    .orderBy(asc(tracks.discNumber), asc(tracks.trackNumber), asc(tracks.id))
    .all();

  const trackIds = trackRows.map((row) => row.id);
  const trackArtistRows =
    trackIds.length > 0
      ? db
          .select({ trackId: trackArtists.trackId, name: artists.name })
          .from(trackArtists)
          .innerJoin(artists, eq(trackArtists.artistId, artists.id))
          .where(inArray(trackArtists.trackId, trackIds))
          .orderBy(asc(trackArtists.position))
          .all()
      : [];

  const namesByTrack = new Map<number, string[]>();
  for (const row of trackArtistRows) {
    const list = namesByTrack.get(row.trackId) ?? [];
    list.push(row.name);
    namesByTrack.set(row.trackId, list);
  }

  const trackList = trackRows.map((row) => {
    const summary = mapTrackSummaryRow(row);
    const names = namesByTrack.get(row.id);
    return {
      ...summary,
      artistCredit: names && names.length > 0 ? formatArtistCredit(names) : (summary.artistName ?? "Unknown artist"),
    };
  });

  return NextResponse.json({
    id: album.id,
    uuid: album.uuid,
    title: album.title,
    year: album.year,
    isCompilation: album.isCompilation === 1,
    coverArtUrl: album.coverArtPath ? `/api/v1/albums/${album.id}/cover` : null,
    dateAdded: album.dateAdded,
    artists: creditedArtists,
    tracks: trackList,
  });
}
