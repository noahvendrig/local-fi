import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { albums, importJobFiles, importJobs, tracks } from "../db/schema";
import { extForPictureFormat } from "./coverArt";
import { publishJobUpdate } from "./events";
import { trackFingerprint } from "./fingerprint";
import { artworkPathFor, originalsDirFor, sanitizeFilename, toDataDirRelative, waveformPathFor } from "./paths";
import { CorruptFileError, extractTags, UnsupportedFormatError } from "./tags";
import { ensureAlbumArtistLink, ensureTrackArtistLink, upsertAlbum, upsertArtist } from "./upsert";
import { generateWaveform } from "./waveform";

function setFileStatus(jobFileId: number, status: string, extra: Record<string, unknown> = {}): void {
  getDb()
    .update(importJobFiles)
    .set({ status, updatedAt: new Date().toISOString(), ...extra })
    .where(eq(importJobFiles.id, jobFileId))
    .run();
}

/**
 * Runs one staged file through the full import pipeline (ARCHITECTURE.md §5/§6):
 * tag extraction -> artist/album upsert -> waveform generation -> atomic move into
 * originals/ -> track insert. Never throws — failures are recorded on the
 * import_job_files row so one bad file doesn't abort the rest of the batch.
 */
export async function processImportFile(jobId: number, jobFileId: number, stagedPath: string, originalFilename: string): Promise<void> {
  const db = getDb();
  let waveformWritten: string | null = null;
  let movedTo: string | null = null;

  try {
    setFileStatus(jobFileId, "reading_tags");
    publishJobUpdate(jobId);

    const tags = await extractTags(stagedPath, originalFilename);

    setFileStatus(jobFileId, "transcoding_waveform");
    publishJobUpdate(jobId);

    const waveform = await generateWaveform(stagedPath, tags.durationSeconds);

    setFileStatus(jobFileId, "saving");
    publishJobUpdate(jobId);

    const trackUuid = randomUUID();

    const waveformPath = waveformPathFor(trackUuid);
    mkdirSync(path.dirname(waveformPath), { recursive: true });
    writeFileSync(waveformPath, waveform.buffer);
    waveformWritten = waveformPath;

    const destDir = originalsDirFor(trackUuid);
    mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, sanitizeFilename(originalFilename));
    renameSync(stagedPath, destPath);
    movedTo = destPath;

    let coverArtRelativePath: string | null = null;
    if (tags.coverArt) {
      const ext = extForPictureFormat(tags.coverArt.format);
      const artPath = artworkPathFor(trackUuid, ext);
      mkdirSync(path.dirname(artPath), { recursive: true });
      writeFileSync(artPath, tags.coverArt.data);
      coverArtRelativePath = toDataDirRelative(artPath);
    }

    const stat = statSync(destPath);
    const relativePath = toDataDirRelative(destPath);
    const fingerprint = trackFingerprint(relativePath, stat.size, stat.mtimeMs);
    const now = new Date().toISOString();

    db.transaction((tx) => {
      const artist = upsertArtist(tx, tags.artist);
      const albumArtist = tags.albumArtist ? upsertArtist(tx, tags.albumArtist) : artist;
      const album = tags.album ? upsertAlbum(tx, tags.album, albumArtist.id, tags.year) : null;

      if (album) {
        ensureAlbumArtistLink(tx, album.id, albumArtist.id, 0);
        if (!album.coverArtPath && coverArtRelativePath) {
          tx.update(albums).set({ coverArtPath: coverArtRelativePath }).where(eq(albums.id, album.id)).run();
        }
      }

      const track = tx
        .insert(tracks)
        .values({
          uuid: trackUuid,
          path: relativePath,
          fingerprint,
          fileMtime: new Date(stat.mtimeMs).toISOString(),
          fileSizeBytes: stat.size,
          title: tags.title,
          artistId: artist.id,
          albumId: album?.id ?? null,
          trackNumber: tags.trackNumber,
          trackTotal: tags.trackTotal,
          discNumber: tags.discNumber,
          discTotal: tags.discTotal,
          year: tags.year,
          genre: tags.genre,
          durationSeconds: tags.durationSeconds,
          format: tags.format,
          codec: tags.codec,
          bitrate: tags.bitrate,
          sampleRate: tags.sampleRate,
          bitDepth: tags.bitDepth,
          channels: tags.channels,
          lossless: tags.lossless ? 1 : 0,
          coverArtPath: coverArtRelativePath,
          waveformPath: toDataDirRelative(waveformPath),
          waveformStatus: "ready",
          waveformPeakCount: waveform.peakCount,
          waveformAvgLevel: waveform.avgLevel,
          rawTagsJson: tags.rawTagsJson,
          importJobId: jobId,
          dateAdded: now,
        })
        .returning()
        .get();

      ensureTrackArtistLink(tx, track.id, artist.id, "primary", 0);

      tx.update(importJobFiles)
        .set({ status: "done", trackId: track.id, bytesProcessed: stat.size, updatedAt: now })
        .where(eq(importJobFiles.id, jobFileId))
        .run();

      tx.update(importJobs)
        .set({ processedFiles: sql`${importJobs.processedFiles} + 1` })
        .where(eq(importJobs.id, jobId))
        .run();
    });

    publishJobUpdate(jobId);
  } catch (err) {
    // Best-effort cleanup so a failed file doesn't leave orphaned artifacts behind.
    if (movedTo && existsSync(movedTo)) {
      try {
        renameSync(movedTo, stagedPath);
      } catch {
        // stagedPath's parent dir may already be gone; leaving the file in originals/
        // untracked is safer than losing it, and Health (M10) can surface it later.
      }
    }
    // Reaching the catch block means no track row was committed, so the sidecar
    // (if it was written) is always orphaned — clean it up.
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

    const db2 = getDb();
    db2
      .update(importJobFiles)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date().toISOString() })
      .where(eq(importJobFiles.id, jobFileId))
      .run();
    db2
      .update(importJobs)
      .set({
        processedFiles: sql`${importJobs.processedFiles} + 1`,
        failedFiles: sql`${importJobs.failedFiles} + 1`,
      })
      .where(eq(importJobs.id, jobId))
      .run();

    publishJobUpdate(jobId);
  }
}
