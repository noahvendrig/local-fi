import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getAlbumAggregates } from "@/lib/db/albumAggregates";
import { albumArtists, albums, artists } from "@/lib/db/schema";
import { formatArtistCredit } from "@/lib/format/artistCredit";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Artist not found." } }, { status: 404 });

/** GET /api/v1/artists/:id — artist fields + albums (ARCHITECTURE.md §7). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artistId = Number(id);
  if (!Number.isInteger(artistId)) return NOT_FOUND;

  const db = getDb();
  const artist = db.select().from(artists).where(eq(artists.id, artistId)).get();
  if (!artist) return NOT_FOUND;

  // Walk album_artists rather than filtering albums.albumArtistId — that denormalized
  // column only names the primary credit, so a compilation this artist appears on but
  // doesn't "own" would otherwise be missed (ARCHITECTURE.md §3.3).
  const albumRows = db
    .select({
      id: albums.id,
      uuid: albums.uuid,
      title: albums.title,
      albumArtistId: albums.albumArtistId,
      year: albums.year,
      coverArtPath: albums.coverArtPath,
      dateAdded: albums.dateAdded,
    })
    .from(albumArtists)
    .innerJoin(albums, eq(albumArtists.albumId, albums.id))
    .where(eq(albumArtists.artistId, artistId))
    .orderBy(desc(sql`coalesce(${albums.year}, 0)`), asc(albums.title))
    .all();

  const albumIds = albumRows.map((row) => row.id);

  const creditRows =
    albumIds.length > 0
      ? db
          .select({ albumId: albumArtists.albumId, name: artists.name })
          .from(albumArtists)
          .innerJoin(artists, eq(albumArtists.artistId, artists.id))
          .where(inArray(albumArtists.albumId, albumIds))
          .orderBy(asc(albumArtists.position))
          .all()
      : [];

  const namesByAlbum = new Map<number, string[]>();
  for (const row of creditRows) {
    const list = namesByAlbum.get(row.albumId) ?? [];
    list.push(row.name);
    namesByAlbum.set(row.albumId, list);
  }

  const aggregates = getAlbumAggregates(db, albumIds);

  const albumList = albumRows.map((row) => {
    const aggregate = aggregates.get(row.id);
    const names = namesByAlbum.get(row.id) ?? [];
    return {
      id: row.id,
      uuid: row.uuid,
      title: row.title,
      albumArtistId: row.albumArtistId,
      // Computed from the full album_artists credit list, not the single denormalized
      // name — this is what actually renders a compilation's multiple artists correctly.
      albumArtistName: formatArtistCredit(names),
      year: row.year,
      coverArtUrl: row.coverArtPath ? `/api/v1/albums/${row.id}/cover` : null,
      trackCount: aggregate?.trackCount ?? 0,
      format: aggregate?.format ?? null,
      lossless: aggregate?.lossless ?? false,
      dateAdded: row.dateAdded,
    };
  });

  return NextResponse.json({
    id: artist.id,
    uuid: artist.uuid,
    name: artist.name,
    sortName: artist.sortName,
    albums: albumList,
  });
}
