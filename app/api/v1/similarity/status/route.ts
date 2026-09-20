import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";

/** GET /api/v1/similarity/status — library-wide similarityStatus tally for the Smart Shuffle
 *  progress bar in Settings, independent of whether a backfill job is currently running (an
 *  import elsewhere advances this too). Mirrors app/api/v1/fingerprint/status/route.ts.
 *  `missingGenre` is a separate tally (not folded into `ready`/`total`) for the audio-based genre
 *  detection that rides along on the same analysis pass (lib/similarity/queue.ts) — most of a
 *  library is typically already `ready` from before genre detection existed, so it needs its own
 *  visible progress rather than being silently invisible inside the similarity-readiness bar. */
export async function GET() {
  const db = getDb();

  const total = db.select({ cnt: sql<number>`count(*)`.as("cnt") }).from(tracks).where(isNull(tracks.deletedAt)).get()?.cnt ?? 0;
  const ready =
    db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(tracks)
      .where(and(isNull(tracks.deletedAt), eq(tracks.similarityStatus, "ready")))
      .get()?.cnt ?? 0;
  const missingGenre =
    db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(tracks)
      .where(and(isNull(tracks.deletedAt), isNull(tracks.genre)))
      .get()?.cnt ?? 0;

  return NextResponse.json({ ready, total, missingGenre });
}
