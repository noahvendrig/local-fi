import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { cursorCondition, decodeCursor, encodeCursor } from "@/lib/db/pagination";
import { getAlbumAggregates } from "@/lib/db/albumAggregates";
import { albums, artists } from "@/lib/db/schema";

const ALBUM_SORTS = {
  date_added_desc: { expr: albums.dateAdded, dir: "desc" as const },
  date_added_asc: { expr: albums.dateAdded, dir: "asc" as const },
  title_asc: { expr: albums.title, dir: "asc" as const },
  title_desc: { expr: albums.title, dir: "desc" as const },
  year_desc: { expr: sql`coalesce(${albums.year}, 0)`, dir: "desc" as const },
  year_asc: { expr: sql`coalesce(${albums.year}, 0)`, dir: "asc" as const },
};

const QuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  artistId: z.coerce.number().int().positive().optional(),
  year: z.coerce.number().int().optional(),
  sort: z.enum(Object.keys(ALBUM_SORTS) as [keyof typeof ALBUM_SORTS]).default("date_added_desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** GET /api/v1/albums — browse/filter/sort/paginate (ARCHITECTURE.md §7). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid query parameters.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }
  const { q, artistId, year, sort, limit, cursor } = parsed.data;

  const sortCfg = ALBUM_SORTS[sort];
  const conditions: SQL[] = [];

  if (q) {
    conditions.push(
      sql`(lower(${albums.title}) LIKE ${`%${q.toLowerCase()}%`} OR lower(coalesce(${artists.name}, '')) LIKE ${`%${q.toLowerCase()}%`})`
    );
  }
  if (artistId) conditions.push(eq(albums.albumArtistId, artistId));
  if (year != null) conditions.push(eq(albums.year, year));

  const decoded = decodeCursor(cursor);
  if (decoded) conditions.push(cursorCondition(sortCfg.expr, albums.id, decoded.v, decoded.id, sortCfg.dir));

  const orderBy = sortCfg.dir === "desc" ? [desc(sortCfg.expr), desc(albums.id)] : [asc(sortCfg.expr), asc(albums.id)];

  const db = getDb();
  const rows = db
    .select({
      id: albums.id,
      uuid: albums.uuid,
      title: albums.title,
      albumArtistId: albums.albumArtistId,
      albumArtistName: artists.name,
      year: albums.year,
      coverArtPath: albums.coverArtPath,
      dateAdded: albums.dateAdded,
      sortKey: sortCfg.expr,
    })
    .from(albums)
    .leftJoin(artists, eq(albums.albumArtistId, artists.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.sortKey as string | number, last.id) : null;

  const albumIds = page.map((r) => r.id);
  const aggregates = getAlbumAggregates(db, albumIds);

  const items = page.map((row) => {
    const aggregate = aggregates.get(row.id);
    return {
      id: row.id,
      uuid: row.uuid,
      title: row.title,
      albumArtistId: row.albumArtistId,
      albumArtistName: row.albumArtistName ?? "Various Artists",
      year: row.year,
      coverArtUrl: row.coverArtPath ? `/api/v1/albums/${row.id}/cover` : null,
      trackCount: aggregate?.trackCount ?? 0,
      format: aggregate?.format ?? null,
      lossless: aggregate?.lossless ?? false,
      dateAdded: row.dateAdded,
    };
  });

  return NextResponse.json({ items, nextCursor });
}
