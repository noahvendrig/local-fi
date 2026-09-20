import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";

/**
 * GET /api/v1/musicbrainz/enrich/status — library-wide tally of what a MusicBrainz run could still
 * improve, for the Settings backfill card. Independent of whether a job is currently running, same
 * shape as /api/v1/spotify/enrich/status.
 *
 * "Eligible" is deliberately not "field is empty". A track can have a year and still need this: a
 * reissue tag dates the reissue, not the recording, which is why "Big Poppa - 2007 Remaster" reads
 * as 2007 in this library. And a genre of `detected` is CNN14's AudioSet guess, which a curated
 * catalog tag should replace. Only a track that already has an original year AND a trusted genre
 * (tag/manual/musicbrainz/lastfm) has nothing left to gain.
 */
export async function GET() {
  const db = getDb();
  const active = isNull(tracks.deletedAt);
  const count = (where: SQL | undefined) => db.select({ cnt: sql<number>`count(*)`.as("cnt") }).from(tracks).where(where).get()?.cnt ?? 0;

  const total = count(active);
  const eligible = count(
    and(active, or(isNull(tracks.originalYearSource), isNull(tracks.genreSource), eq(tracks.genreSource, "detected")))
  );
  const missingOriginalYear = count(and(active, isNull(tracks.originalYearSource)));
  const detectedGenre = count(and(active, eq(tracks.genreSource, "detected")));

  return NextResponse.json({ eligible, total, missingOriginalYear, detectedGenre });
}
