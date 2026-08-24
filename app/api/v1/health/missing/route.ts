import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { cursorCondition, decodeCursor, encodeCursor } from "@/lib/db/pagination";
import { albums, artists, tracks } from "@/lib/db/schema";
import { mapTrackSummaryRow, trackSummarySelectColumns } from "@/lib/db/trackSummary";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** GET /api/v1/health/missing — tracks flagged missing by the last rescan (ARCHITECTURE.md §7/M10). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid query parameters.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }
  const { limit, cursor } = parsed.data;

  const conditions = [isNull(tracks.deletedAt), isNotNull(tracks.missingSince)];
  const decoded = decodeCursor(cursor);
  if (decoded) conditions.push(cursorCondition(tracks.missingSince, tracks.id, decoded.v, decoded.id, "desc"));

  const db = getDb();
  const rows = db
    .select({ ...trackSummarySelectColumns, sortKey: tracks.missingSince })
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(and(...conditions))
    .orderBy(desc(tracks.missingSince), desc(tracks.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.sortKey as string, last.id) : null;

  return NextResponse.json({ items: page.map(mapTrackSummaryRow), nextCursor });
}
