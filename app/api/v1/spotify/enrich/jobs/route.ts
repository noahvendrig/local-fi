import { randomUUID } from "node:crypto";
import { and, inArray, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { spotifyEnrichJobTracks, spotifyEnrichJobs, tracks } from "@/lib/db/schema";
import { isSpotifyConnected } from "@/lib/spotify/client";
import { loadSpotifyEnrichJobSnapshot } from "@/lib/spotify/enrichEvents";
import { enqueueSpotifyEnrichJob } from "@/lib/spotify/enrichQueue";

const BodySchema = z.object({
  trackIds: z.array(z.number().int()).min(1).max(5000).optional(),
});

/**
 * POST /api/v1/spotify/enrich/jobs — backfills genre/release-year for tracks missing either,
 * by matching them against the Spotify catalog on title+artist (lib/spotify/enrichMatch.ts).
 * Never overwrites a value that's already set — only fills gaps. `trackIds` covers a
 * caller-filtered subset; omitted means "every track missing genre or year", the Settings
 * backfill-the-library case. Mirrors app/api/v1/fingerprint/jobs/route.ts.
 */
export async function POST(request: Request) {
  if (!isSpotifyConnected()) {
    return NextResponse.json(
      { error: { code: "spotify_not_connected", message: "Connect your Spotify account first (Settings → Spotify)." } },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid request.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const db = getDb();
  const missing = or(isNull(tracks.genre), isNull(tracks.year));
  const validIds = parsed.data.trackIds
    ? db
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(inArray(tracks.id, parsed.data.trackIds), isNull(tracks.deletedAt), missing))
        .all()
        .map((t) => t.id)
    : db
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(isNull(tracks.deletedAt), missing))
        .all()
        .map((t) => t.id);

  if (validIds.length === 0) {
    return NextResponse.json({ error: { code: "invalid_request", message: "No tracks are missing genre or release year." } }, { status: 400 });
  }

  const now = new Date().toISOString();
  const job = db
    .insert(spotifyEnrichJobs)
    .values({ uuid: randomUUID(), totalTracks: validIds.length, createdAt: now })
    .returning()
    .get();

  db.insert(spotifyEnrichJobTracks)
    .values(validIds.map((trackId) => ({ jobId: job.id, trackId, createdAt: now, updatedAt: now })))
    .run();

  enqueueSpotifyEnrichJob(job.id);

  const snapshot = loadSpotifyEnrichJobSnapshot(job.id)!;
  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks }, { status: 201 });
}
