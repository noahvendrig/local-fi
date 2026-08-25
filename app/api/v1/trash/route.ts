import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { cursorCondition, decodeCursor, encodeCursor } from "@/lib/db/pagination";
import { albums, artists, tracks } from "@/lib/db/schema";
import { mapTrackSummaryRow, trackSummarySelectColumns } from "@/lib/db/trackSummary";
import { daysRemainingInTrash, emptyTrash, trashGraceDays } from "@/lib/library/trash";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** GET /api/v1/trash — tracks sitting in trash waiting for restore or the grace-period sweep. */
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
  const graceDays = trashGraceDays();

  const conditions = [isNotNull(tracks.deletedAt)];
  const decoded = decodeCursor(cursor);
  if (decoded) conditions.push(cursorCondition(tracks.deletedAt, tracks.id, decoded.v, decoded.id, "desc"));

  const db = getDb();
  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(tracks)
    .where(isNotNull(tracks.deletedAt))
    .get();

  const rows = db
    .select({ ...trackSummarySelectColumns, deletedAt: tracks.deletedAt, sortKey: tracks.deletedAt })
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(and(...conditions))
    .orderBy(desc(tracks.deletedAt), desc(tracks.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.sortKey as string, last.id) : null;

  const items = page.map((row) => ({
    ...mapTrackSummaryRow(row),
    deletedAt: row.deletedAt as string,
    daysRemaining: daysRemainingInTrash(row.deletedAt as string, graceDays),
  }));

  return NextResponse.json({
    items,
    nextCursor,
    total: totalRow?.count ?? 0,
    graceDays,
  });
}

/** DELETE /api/v1/trash — permanently purge every trashed track. */
export async function DELETE() {
  const purged = emptyTrash();
  return NextResponse.json({ purged });
}
