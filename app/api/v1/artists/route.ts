import { and, asc, desc, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { cursorCondition, decodeCursor, encodeCursor } from "@/lib/db/pagination";
import { albums, artists, tracks } from "@/lib/db/schema";

const ARTIST_SORTS = {
  name_asc: { expr: sql`coalesce(${artists.sortName}, ${artists.name})`, dir: "asc" as const },
  name_desc: { expr: sql`coalesce(${artists.sortName}, ${artists.name})`, dir: "desc" as const },
};

const QuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  sort: z.enum(Object.keys(ARTIST_SORTS) as [keyof typeof ARTIST_SORTS]).default("name_asc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** GET /api/v1/artists — browse/filter/sort/paginate (ARCHITECTURE.md §7). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid query parameters.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }
  const { q, sort, limit, cursor } = parsed.data;

  const sortCfg = ARTIST_SORTS[sort];
  const conditions: SQL[] = [];
  if (q) conditions.push(sql`lower(${artists.name}) LIKE ${`%${q.toLowerCase()}%`}`);

  const decoded = decodeCursor(cursor);
  if (decoded) conditions.push(cursorCondition(sortCfg.expr, artists.id, decoded.v, decoded.id, sortCfg.dir));

  const orderBy = sortCfg.dir === "desc" ? [desc(sortCfg.expr), desc(artists.id)] : [asc(sortCfg.expr), asc(artists.id)];

  const db = getDb();
  const rows = db
    .select({
      id: artists.id,
      uuid: artists.uuid,
      name: artists.name,
      sortName: artists.sortName,
      sortKey: sortCfg.expr,
    })
    .from(artists)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.sortKey as string | number, last.id) : null;

  const artistIds = page.map((r) => r.id);
  const albumCounts =
    artistIds.length > 0
      ? db
          .select({ artistId: albums.albumArtistId, cnt: sql<number>`count(*)`.as("cnt") })
          .from(albums)
          .where(inArray(albums.albumArtistId, artistIds))
          .groupBy(albums.albumArtistId)
          .all()
      : [];
  const trackCounts =
    artistIds.length > 0
      ? db
          .select({ artistId: tracks.artistId, cnt: sql<number>`count(*)`.as("cnt") })
          .from(tracks)
          .where(and(inArray(tracks.artistId, artistIds), isNull(tracks.deletedAt)))
          .groupBy(tracks.artistId)
          .all()
      : [];

  const albumCountById = new Map(albumCounts.filter((r) => r.artistId != null).map((r) => [r.artistId as number, r.cnt]));
  const trackCountById = new Map(trackCounts.filter((r) => r.artistId != null).map((r) => [r.artistId as number, r.cnt]));

  const items = page.map((row) => ({
    id: row.id,
    uuid: row.uuid,
    name: row.name,
    sortName: row.sortName,
    albumCount: albumCountById.get(row.id) ?? 0,
    trackCount: trackCountById.get(row.id) ?? 0,
  }));

  return NextResponse.json({ items, nextCursor });
}
