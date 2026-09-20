import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { getDb } from "../db/client";
import { importJobs, playlistTracks, tracks } from "../db/schema";
import { cancelPythonJob, postMatchJob, streamJobUntilDone } from "../pythonBackend/client";
import { parseReleaseYear, type SpotifyTrackMetadata } from "../spotify/client";
import { publishJobUpdate } from "./events";
import { insertTrackRow, markJobFileFailed, readTagsAndWaveform, setJobFileStatus, writeSidecars } from "./indexCommon";
import { originalsDirFor, sanitizeFilename, stagingDirFor, toDataDirRelative } from "./paths";
import { CorruptFileError, UnsupportedFormatError } from "./tags";

/**
 * Runs one Spotify playlist track through: YouTube match + download (delegated to
 * the Python backend, see lib/pythonBackend/client.ts) -> tag extraction -> waveform
 * generation -> atomic move into originals/ -> track insert, tagged with Spotify's
 * clean metadata rather than yt-dlp's raw YouTube title. Mirrors the tail end of
 * lib/import/pipeline.ts's processImportFile — never throws, failures are recorded
 * on the import_job_files row so one bad track doesn't abort the rest of the playlist.
 */
export async function processSpotifyImportFile(
  jobId: number,
  jobFileId: number,
  jobUuid: string,
  metadataJson: string,
  targetPlaylistId: number | null,
  isCancelled: () => boolean
): Promise<void> {
  let metadata: SpotifyTrackMetadata;
  try {
    metadata = JSON.parse(metadataJson) as SpotifyTrackMetadata;
  } catch {
    markJobFileFailed(jobId, jobFileId, "Corrupt track metadata.");
    publishJobUpdate(jobId);
    return;
  }

  const artist = metadata.artists[0] ?? "Unknown Artist";
  const outputDir = path.join(stagingDirFor(jobUuid), String(jobFileId));

  // Same Spotify track already in the library (re-importing a playlist, or the same song
  // showing up in two playlists) — skip the YouTube match + download entirely and just point
  // the target playlist at the existing track. Mirrors folderScanPipeline's duplicate_skipped
  // handling for watched-folder rescans.
  const db = getDb();
  const existingTrack = db
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(eq(tracks.sourceProvider, "spotify"), eq(tracks.sourceUrl, metadata.spotifyUrl), isNull(tracks.deletedAt)))
    .get();
  if (existingTrack) {
    setJobFileStatus(jobFileId, "duplicate_skipped", { trackId: existingTrack.id });
    db.update(importJobs)
      .set({ processedFiles: sql`${importJobs.processedFiles} + 1` })
      .where(eq(importJobs.id, jobId))
      .run();
    if (targetPlaylistId != null) {
      appendTrackToCrate(targetPlaylistId, existingTrack.id);
    }
    publishJobUpdate(jobId);
    return;
  }

  try {
    setJobFileStatus(jobFileId, "matching");
    publishJobUpdate(jobId);

    const created = await postMatchJob({
      title: metadata.title,
      artist,
      durationMs: metadata.durationMs,
      outputDir,
    });

    const finalJob = await streamJobUntilDone(created.id, (update) => {
      if (isCancelled()) {
        void cancelPythonJob(update.id);
        return;
      }
      if (update.status === "matching" || update.status === "downloading") {
        setJobFileStatus(jobFileId, update.status);
        publishJobUpdate(jobId);
      }
    });

    if (finalJob.status === "cancelled") {
      markJobFileFailed(jobId, jobFileId, "Cancelled");
      publishJobUpdate(jobId);
      return;
    }
    if (finalJob.status !== "completed" || !finalJob.filepath) {
      markJobFileFailed(jobId, jobFileId, finalJob.error || "Download failed.");
      publishJobUpdate(jobId);
      return;
    }

    await finishDownloadedTrack(jobId, jobFileId, finalJob.filepath, metadata, targetPlaylistId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Spotify import failed.";
    markJobFileFailed(jobId, jobFileId, message);
    publishJobUpdate(jobId);
  }
}

async function finishDownloadedTrack(
  jobId: number,
  jobFileId: number,
  downloadedPath: string,
  metadata: SpotifyTrackMetadata,
  targetPlaylistId: number | null
): Promise<void> {
  const artist = metadata.artists[0] ?? "Unknown Artist";
  let waveformWritten: string | null = null;
  let movedTo: string | null = null;

  try {
    setJobFileStatus(jobFileId, "reading_tags");
    publishJobUpdate(jobId);

    const originalFilename = path.basename(downloadedPath);
    const extracted = await readTagsAndWaveform(downloadedPath, originalFilename);
    const { waveform } = extracted;

    let coverArt = extracted.tags.coverArt;
    if (metadata.coverArtUrl) {
      try {
        const res = await fetch(metadata.coverArtUrl);
        if (res.ok) {
          coverArt = {
            data: Buffer.from(await res.arrayBuffer()),
            format: res.headers.get("content-type") || "image/jpeg",
          };
        }
      } catch {
        // Keep whatever ffmpeg/yt-dlp embedded (if anything) — cover art is a nice-to-have, not fatal.
      }
    }

    const tags = {
      ...extracted.tags,
      title: metadata.title,
      artist,
      albumArtist: artist,
      album: metadata.album ?? extracted.tags.album,
      // yt-dlp/ffmpeg rarely carries a useful year tag for a YouTube-sourced download — prefer
      // Spotify's catalog release date when it has one, same as title/artist/album above. Genre
      // isn't available here: Spotify deprecated the artist genres field, so this keeps whatever
      // the source file had embedded (backfilled later by Smart Shuffle's audio-based genre
      // detection, see lib/similarity/queue.ts).
      genre: extracted.tags.genre,
      year: parseReleaseYear(metadata.releaseDate) ?? extracted.tags.year,
      coverArt,
    };

    setJobFileStatus(jobFileId, "transcoding_waveform");
    publishJobUpdate(jobId);

    const trackUuid = randomUUID();
    const { waveformAbsPath, coverArtRelativePath } = writeSidecars(trackUuid, tags, waveform);
    waveformWritten = waveformAbsPath;

    setJobFileStatus(jobFileId, "saving");
    publishJobUpdate(jobId);

    const destDir = originalsDirFor(trackUuid);
    mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, sanitizeFilename(originalFilename));
    renameSync(downloadedPath, destPath);
    movedTo = destPath;

    const stat = statSync(destPath);
    const relativePath = toDataDirRelative(destPath);

    let track: ReturnType<typeof insertTrackRow>;
    try {
      track = insertTrackRow({
        uuid: trackUuid,
        relativePath,
        libraryRootId: null,
        fileSizeBytes: stat.size,
        fileMtimeMs: stat.mtimeMs,
        tags,
        waveform,
        waveformAbsPath,
        coverArtRelativePath,
        importJobId: jobId,
        jobFileId,
        sourceProvider: "spotify",
        sourceUrl: metadata.spotifyUrl,
      });
    } catch (err) {
      // idx_tracks_source lost the race it's meant to guard: another worker's insert for this
      // same Spotify track landed between the up-front duplicate check above and this insert.
      // Fall back to that winner instead of creating a second `tracks` row for one Spotify track.
      const existing = isUniqueSourceConstraintError(err)
        ? getDb()
            .select({ id: tracks.id })
            .from(tracks)
            .where(
              and(eq(tracks.sourceProvider, "spotify"), eq(tracks.sourceUrl, metadata.spotifyUrl), isNull(tracks.deletedAt))
            )
            .get()
        : undefined;
      if (!existing) throw err;

      if (existsSync(destPath)) unlinkSync(destPath);
      if (existsSync(waveformAbsPath)) unlinkSync(waveformAbsPath);
      movedTo = null;
      waveformWritten = null;

      setJobFileStatus(jobFileId, "duplicate_skipped", { trackId: existing.id });
      getDb()
        .update(importJobs)
        .set({ processedFiles: sql`${importJobs.processedFiles} + 1` })
        .where(eq(importJobs.id, jobId))
        .run();
      if (targetPlaylistId != null) {
        appendTrackToCrate(targetPlaylistId, existing.id);
      }
      publishJobUpdate(jobId);
      return;
    }

    if (targetPlaylistId != null) {
      appendTrackToCrate(targetPlaylistId, track.id);
    }

    publishJobUpdate(jobId);
  } catch (err) {
    if (movedTo && existsSync(movedTo)) {
      try {
        renameSync(movedTo, downloadedPath);
      } catch {
        // Staging dir may already be gone — leaving the file in originals/ untracked
        // is safer than losing it; Health can surface it later.
      }
    }
    if (waveformWritten && existsSync(waveformWritten)) {
      try {
        unlinkSync(waveformWritten);
      } catch {
        /* ignore */
      }
    }

    const message =
      err instanceof UnsupportedFormatError || err instanceof CorruptFileError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown import error";

    markJobFileFailed(jobId, jobFileId, message);
    publishJobUpdate(jobId);
  }
}

/** True if `err` is a SQLite UNIQUE violation on idx_tracks_source (tracks.source_provider + tracks.source_url). */
function isUniqueSourceConstraintError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  const message = err instanceof Error ? err.message : "";
  return code === "SQLITE_CONSTRAINT_UNIQUE" && message.includes("tracks.source_provider") && message.includes("tracks.source_url");
}

/** Appends a track to the end of the crate created for this playlist import (see app/api/v1/import/spotify/route.ts). Mirrors the position-computation in app/api/v1/playlists/[id]/tracks/route.ts. */
function appendTrackToCrate(playlistId: number, trackId: number): void {
  const db = getDb();
  const positions = db
    .select({ position: playlistTracks.position })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position))
    .all()
    .map((r) => r.position);

  const position = generateKeyBetween(positions[positions.length - 1] ?? null, null);
  db.insert(playlistTracks)
    .values({ playlistId, trackId, position, addedAt: new Date().toISOString() })
    .run();
}
