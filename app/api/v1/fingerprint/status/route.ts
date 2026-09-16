import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";

/** GET /api/v1/fingerprint/status — library-wide landmarkStatus tally for the Mixtape matching
 *  progress bar in Settings, independent of whether a backfill job is currently running (an
 *  import elsewhere advances this too). Mirrors app/api/v1/similarity/status/route.ts. */
export async function GET() {
  const db = getDb();

  const total = db.select({ cnt: sql<number>`count(*)`.as("cnt") }).from(tracks).where(isNull(tracks.deletedAt)).get()?.cnt ?? 0;
  const ready =
    db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(tracks)
      .where(and(isNull(tracks.deletedAt), eq(tracks.landmarkStatus, "ready")))
      .get()?.cnt ?? 0;

  return NextResponse.json({ ready, total });
}
