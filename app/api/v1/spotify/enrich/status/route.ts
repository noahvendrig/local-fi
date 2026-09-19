import { and, isNull, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";

/** GET /api/v1/spotify/enrich/status — library-wide tally of tracks missing genre and/or release
 *  year, for the Settings backfill card. Independent of whether a backfill job is currently
 *  running, same shape as /api/v1/fingerprint/status. */
export async function GET() {
  const db = getDb();

  const total = db.select({ cnt: sql<number>`count(*)`.as("cnt") }).from(tracks).where(isNull(tracks.deletedAt)).get()?.cnt ?? 0;
  const missing =
    db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(tracks)
      .where(and(isNull(tracks.deletedAt), or(isNull(tracks.genre), isNull(tracks.year))))
      .get()?.cnt ?? 0;

  return NextResponse.json({ missing, total });
}
