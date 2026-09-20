import { and, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";

/** GET /api/v1/spotify/enrich/status — library-wide tally of tracks missing release year, for the
 *  Settings backfill card. Genre isn't included: Spotify deprecated the artist genres field, so
 *  it can never be filled from here (see lib/spotify/enrichMatch.ts's docstring) — genre comes
 *  from on-device audio analysis instead (lib/similarity/queue.ts). Independent of whether a
 *  backfill job is currently running, same shape as /api/v1/fingerprint/status. */
export async function GET() {
  const db = getDb();

  const total = db.select({ cnt: sql<number>`count(*)`.as("cnt") }).from(tracks).where(isNull(tracks.deletedAt)).get()?.cnt ?? 0;
  const missing =
    db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(tracks)
      .where(and(isNull(tracks.deletedAt), isNull(tracks.year)))
      .get()?.cnt ?? 0;

  return NextResponse.json({ missing, total });
}
