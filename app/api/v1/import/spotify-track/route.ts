import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { importJobFiles, importJobs } from "@/lib/db/schema";
import { loadJobSnapshot } from "@/lib/import/events";
import { enqueueImportJob } from "@/lib/import/queue";
import type { SpotifyTrackMetadata } from "@/lib/spotify/client";

/**
 * Single-track counterpart to /api/v1/import/spotify — used by the top search bar's
 * "not in your library" fallback, where the track metadata already came from a prior
 * /api/v1/spotify/search call (no re-fetch from Spotify needed here). Creates a 1-file
 * `spotify_import` job with no target crate, then hands off to the same worker queue
 * (lib/import/queue.ts) and pipeline (lib/import/spotifyPipeline.ts) a playlist import uses.
 */
export async function POST(request: Request) {
  let body: { track?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Expected a JSON body with a track field." } },
      { status: 400 }
    );
  }

  const track = body.track as Partial<SpotifyTrackMetadata> | undefined;
  if (
    !track ||
    typeof track.title !== "string" ||
    typeof track.spotifyUrl !== "string" ||
    !Array.isArray(track.artists)
  ) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "track must include title, spotifyUrl, and artists." } },
      { status: 400 }
    );
  }

  const db = getDb();
  const now = new Date().toISOString();

  const job = db
    .insert(importJobs)
    .values({
      uuid: randomUUID(),
      type: "spotify_import",
      status: "pending",
      totalFiles: 1,
      targetPlaylistId: null,
      createdAt: now,
    })
    .returning()
    .get();

  db.insert(importJobFiles)
    .values({
      jobId: job.id,
      originalFilename: `${track.artists.join(", ")} - ${track.title}`,
      metadataJson: JSON.stringify(track),
      status: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  enqueueImportJob(job.id);

  const snapshot = loadJobSnapshot(job.id);
  return NextResponse.json({ ...snapshot!.job, files: snapshot!.files }, { status: 201 });
}
