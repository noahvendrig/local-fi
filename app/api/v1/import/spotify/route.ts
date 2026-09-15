import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { importJobFiles, importJobs, playlists } from "@/lib/db/schema";
import { loadJobSnapshot } from "@/lib/import/events";
import { enqueueImportJob } from "@/lib/import/queue";
import {
  fetchPlaylistName,
  fetchPlaylistTracks,
  InvalidPlaylistUrlError,
  parsePlaylistId,
  SpotifyConfigError,
  SpotifyNotConnectedError,
} from "@/lib/spotify/client";

/**
 * Accepts a link to a Spotify playlist the connected user owns (Spotify no longer
 * returns contents for anyone else's), resolves its tracks via the Spotify Web
 * API (see lib/spotify/client.ts), and creates a `spotify_import`
 * import_jobs row with one import_job_files row per track (metadataJson populated,
 * no stagedPath yet — that's filled in once lib/import/spotifyPipeline.ts finds and
 * downloads a YouTube match for it). Hands off to the existing worker queue exactly
 * like a file upload.
 *
 * `createCrate` (default true) controls whether a new crate named after the playlist
 * is created and populated as tracks land — the "new crate from Spotify" flow. When
 * false (the plain Import page flow), tracks are just downloaded into the library
 * with no crate membership.
 */
export async function POST(request: Request) {
  let body: { playlistUrl?: unknown; createCrate?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Expected a JSON body with a playlistUrl field." } },
      { status: 400 }
    );
  }

  const playlistUrl = typeof body.playlistUrl === "string" ? body.playlistUrl.trim() : "";
  const createCrate = body.createCrate !== false;
  if (!playlistUrl) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "playlistUrl is required." } },
      { status: 400 }
    );
  }

  let tracks;
  let playlistName: string;
  try {
    const playlistId = parsePlaylistId(playlistUrl);
    [playlistName, tracks] = await Promise.all([fetchPlaylistName(playlistId), fetchPlaylistTracks(playlistId)]);
  } catch (err) {
    if (err instanceof InvalidPlaylistUrlError) {
      return NextResponse.json({ error: { code: "invalid_request", message: err.message } }, { status: 400 });
    }
    if (err instanceof SpotifyConfigError) {
      return NextResponse.json({ error: { code: "spotify_not_configured", message: err.message } }, { status: 503 });
    }
    if (err instanceof SpotifyNotConnectedError) {
      return NextResponse.json({ error: { code: "spotify_not_connected", message: err.message } }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: {
          code: "spotify_error",
          message: err instanceof Error ? err.message : "Could not fetch the playlist from Spotify.",
        },
      },
      { status: 502 }
    );
  }

  if (tracks.length === 0) {
    return NextResponse.json(
      { error: { code: "empty_playlist", message: "That playlist has no importable tracks." } },
      { status: 400 }
    );
  }

  const db = getDb();
  const now = new Date().toISOString();

  // Created up front (not deferred to job completion, unlike folder-playlist grouping)
  // so tracks can be appended to it progressively as each one finishes downloading.
  const crate = createCrate
    ? db
        .insert(playlists)
        .values({ uuid: randomUUID(), name: playlistName, type: "manual", createdAt: now, updatedAt: now })
        .returning()
        .get()
    : null;

  const job = db
    .insert(importJobs)
    .values({
      uuid: randomUUID(),
      type: "spotify_import",
      status: "pending",
      totalFiles: tracks.length,
      targetPlaylistId: crate?.id ?? null,
      createdAt: now,
    })
    .returning()
    .get();

  for (const track of tracks) {
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
  }

  enqueueImportJob(job.id);

  const snapshot = loadJobSnapshot(job.id);
  return NextResponse.json({ ...snapshot!.job, files: snapshot!.files }, { status: 201 });
}
