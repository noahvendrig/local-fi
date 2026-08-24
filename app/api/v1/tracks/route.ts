import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { cursorCondition, decodeCursor, encodeCursor } from "@/lib/db/pagination";
import { albums, artists, tracks } from "@/lib/db/schema";
import { mapTrackSummaryRow, trackSummarySelectColumns } from "@/lib/db/trackSummary";

const TRACK_FORMATS = ["mp3", "flac", "wav", "aac", "m4a", "ogg", "alac", "aiff"] as const;

const TRACK_SORTS = {
  date_added_desc: { expr: tracks.dateAdded, dir: "desc" as const },
  date_added_asc: { expr: tracks.dateAdded, dir: "asc" as const },
  title_asc: { expr: sql`coalesce(${tracks.title}, '')`, dir: "asc" as const },
  title_desc: { expr: sql`coalesce(${tracks.title}, '')`, dir: "desc" as const },
  duration_asc: { expr: tracks.durationSeconds, dir: "asc" as const },
  duration_desc: { expr: tracks.durationSeconds, dir: "desc" as const },
};

const QuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  format: z
    .string()
    .optional()
    .transform((v) => v?.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean))
    .refine((v) => !v || v.every((f) => (TRACK_FORMATS as readonly string[]).includes(f)), {
      message: `format must be one of ${TRACK_FORMATS.join(", ")}`,
    }),
  lossless: z.enum(["true", "false"]).optional(),
  artistId: z.coerce.number().int().positive().optional(),
  albumId: z.coerce.number().int().positive().optional(),
  genre: z.string().trim().min(1).optional(),
  yearMin: z.coerce.number().int().optional(),
  yearMax: z.coerce.number().int().optional(),
  sort: z.enum(Object.keys(TRACK_SORTS) as [keyof typeof TRACK_SORTS]).default("date_added_desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** GET /api/v1/tracks — browse/filter/sort/paginate (ARCHITECTURE.md §7). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid query parameters.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }
  const { q, format, lossless, artistId, albumId, genre, yearMin, yearMax, sort, limit, cursor } = parsed.data;

  const sortCfg = TRACK_SORTS[sort];
  const conditions: SQL[] = [isNull(tracks.deletedAt)];

  if (q) conditions.push(sql`lower(coalesce(${tracks.title}, '')) LIKE ${`%${q.toLowerCase()}%`}`);
  if (format && format.length > 0) conditions.push(inArray(tracks.format, format));
  if (lossless) conditions.push(eq(tracks.lossless, lossless === "true" ? 1 : 0));
  if (artistId) conditions.push(eq(tracks.artistId, artistId));
  if (albumId) conditions.push(eq(tracks.albumId, albumId));
  if (genre) conditions.push(eq(tracks.genre, genre));
  if (yearMin != null) conditions.push(gte(tracks.year, yearMin));
  if (yearMax != null) conditions.push(lte(tracks.year, yearMax));

  const decoded = decodeCursor(cursor);
  if (decoded) conditions.push(cursorCondition(sortCfg.expr, tracks.id, decoded.v, decoded.id, sortCfg.dir));

  const orderBy = sortCfg.dir === "desc" ? [desc(sortCfg.expr), desc(tracks.id)] : [asc(sortCfg.expr), asc(tracks.id)];

  const rows = getDb()
    .select({
      ...trackSummarySelectColumns,
      sortKey: sortCfg.expr,
    })
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.sortKey as string | number, last.id) : null;

  const items = page.map(mapTrackSummaryRow);

  return NextResponse.json({ items, nextCursor });
}
