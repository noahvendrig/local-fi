import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { musicbrainzEnrichJobTracks, musicbrainzEnrichJobs, tracks } from "@/lib/db/schema";
import { loadMusicbrainzEnrichJobSnapshot } from "@/lib/musicbrainz/enrichEvents";
import { enqueueMusicbrainzEnrichJob } from "@/lib/musicbrainz/enrichQueue";

const BodySchema = z.object({
  trackIds: z.array(z.number().int()).min(1).max(5000).optional(),
});

/**
 * POST /api/v1/musicbrainz/enrich/jobs — looks tracks up in MusicBrainz to fill in their original
 * release year and a human-curated genre (lib/musicbrainz/enrichMatch.ts).
 *
 * Unlike the Spotify equivalent this needs no account: MusicBrainz is open, at the cost of a
 * one-request-per-second rate limit, so a whole-library run takes roughly a second per track.
 *
 * Eligibility is "could this track gain something", not "is this field empty": a track whose year
 * is present but came from a reissue tag is exactly the case this exists to fix, and a track whose
 * genre is CNN14's `detected` guess is exactly the genre this exists to replace. Tracks already
 * enriched, or carrying a real ID3/manual genre, are skipped. `trackIds` narrows to a caller-chosen
 * subset; omitted means the whole library.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid request.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const db = getDb();
  // Nothing to gain once original_year is set AND the genre is already from a trusted source.
  const eligible = or(
    isNull(tracks.originalYearSource),
    isNull(tracks.genreSource),
    eq(tracks.genreSource, "detected")
  );
  const scope = parsed.data.trackIds
    ? and(inArray(tracks.id, parsed.data.trackIds), isNull(tracks.deletedAt), eligible)
    : and(isNull(tracks.deletedAt), eligible);

  const validIds = db.select({ id: tracks.id }).from(tracks).where(scope).all().map((t) => t.id);

  if (validIds.length === 0) {
    return NextResponse.json({ error: { code: "invalid_request", message: "No tracks need MusicBrainz enrichment." } }, { status: 400 });
  }

  const now = new Date().toISOString();
  const job = db
    .insert(musicbrainzEnrichJobs)
    .values({ uuid: randomUUID(), totalTracks: validIds.length, createdAt: now })
    .returning()
    .get();

  db.insert(musicbrainzEnrichJobTracks)
    .values(validIds.map((trackId) => ({ jobId: job.id, trackId, createdAt: now, updatedAt: now })))
    .run();

  enqueueMusicbrainzEnrichJob(job.id);

  const snapshot = loadMusicbrainzEnrichJobSnapshot(job.id)!;
  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks }, { status: 201 });
}
