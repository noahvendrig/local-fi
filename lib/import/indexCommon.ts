import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { albums, importJobFiles, importJobs, tracks } from "../db/schema";
import { extForPictureFormat } from "./coverArt";
import { trackFingerprint } from "./fingerprint";
import { artworkPathFor, toDataDirRelative, waveformPathFor } from "./paths";
import { extractTags, type ExtractedTags } from "./tags";
import { ensureAlbumArtistLink, ensureTrackArtistLink, upsertAlbum, upsertArtist } from "./upsert";
import { generateWaveform, type WaveformResult } from "./waveform";

/**
 * Shared read half of the import pipeline (ARCHITECTURE.md §5/§6) — identical whether the
 * source file is a staged copy-on-import temp file or a watched track being read in place.
 */
export async function readTagsAndWaveform(
  sourcePath: string,
  originalFilename: string
): Promise<{ tags: ExtractedTags; waveform: WaveformResult }> {
  const tags = await extractTags(sourcePath, originalFilename);
  const waveform = await generateWaveform(sourcePath, tags.durationSeconds);
  return { tags, waveform };
}

/** Writes the waveform sidecar and (if present) extracted cover art under LOCALFI_DATA_DIR — same location for managed and watched tracks. */
export function writeSidecars(
  trackUuid: string,
  tags: ExtractedTags,
  waveform: WaveformResult
): { waveformAbsPath: string; coverArtRelativePath: string | null } {
  const waveformAbsPath = waveformPathFor(trackUuid);
  mkdirSync(path.dirname(waveformAbsPath), { recursive: true });
  writeFileSync(waveformAbsPath, waveform.buffer);

  let coverArtRelativePath: string | null = null;
  if (tags.coverArt) {
    const ext = extForPictureFormat(tags.coverArt.format);
    const artPath = artworkPathFor(trackUuid, ext);
    mkdirSync(path.dirname(artPath), { recursive: true });
    writeFileSync(artPath, tags.coverArt.data);
    coverArtRelativePath = toDataDirRelative(artPath);
  }

  return { waveformAbsPath, coverArtRelativePath };
}

export interface InsertTrackParams {
  uuid: string;
  /** Relative to the data dir for a managed track, relative to the library root for a watched one. */
  relativePath: string;
  libraryRootId: number | null;
  fileSizeBytes: number;
  fileMtimeMs: number;
  tags: ExtractedTags;
  waveform: WaveformResult;
  waveformAbsPath: string;
  coverArtRelativePath: string | null;
  importJobId: number;
  jobFileId: number;
}

/** Artist/album upsert + track insert + job bookkeeping, in one transaction — shared by both import flows. */
export function insertTrackRow(params: InsertTrackParams): typeof tracks.$inferSelect {
  const db = getDb();
  const fingerprint = trackFingerprint(params.relativePath, params.fileSizeBytes, params.fileMtimeMs);
  const now = new Date().toISOString();
  const { tags, waveform } = params;

  return db.transaction((tx) => {
    const artist = upsertArtist(tx, tags.artist);
    const albumArtist = tags.albumArtist ? upsertArtist(tx, tags.albumArtist) : artist;
    const album = tags.album ? upsertAlbum(tx, tags.album, albumArtist.id, tags.year) : null;

    if (album) {
      ensureAlbumArtistLink(tx, album.id, albumArtist.id, 0);
      if (!album.coverArtPath && params.coverArtRelativePath) {
        tx.update(albums).set({ coverArtPath: params.coverArtRelativePath }).where(eq(albums.id, album.id)).run();
      }
    }

    const track = tx
      .insert(tracks)
      .values({
        uuid: params.uuid,
        path: params.relativePath,
        libraryRootId: params.libraryRootId,
        fingerprint,
        fileMtime: new Date(params.fileMtimeMs).toISOString(),
        fileSizeBytes: params.fileSizeBytes,
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
        bpm: tags.bpm,
        bpmSource: tags.bpm != null ? "tag" : null,
        key: tags.key,
        keySource: tags.key != null ? "tag" : null,
        coverArtPath: params.coverArtRelativePath,
        waveformPath: toDataDirRelative(params.waveformAbsPath),
        waveformStatus: "ready",
        waveformPeakCount: waveform.peakCount,
        waveformAvgLevel: waveform.avgLevel,
        rawTagsJson: tags.rawTagsJson,
        importJobId: params.importJobId,
        dateAdded: now,
      })
      .returning()
      .get();

    ensureTrackArtistLink(tx, track.id, artist.id, "primary", 0);

    tx.update(importJobFiles)
      .set({ status: "done", trackId: track.id, bytesProcessed: params.fileSizeBytes, updatedAt: now })
      .where(eq(importJobFiles.id, params.jobFileId))
      .run();

    tx.update(importJobs)
      .set({ processedFiles: sql`${importJobs.processedFiles} + 1` })
      .where(eq(importJobs.id, params.importJobId))
      .run();

    return track;
  });
}

export function setJobFileStatus(jobFileId: number, status: string, extra: Record<string, unknown> = {}): void {
  getDb()
    .update(importJobFiles)
    .set({ status, updatedAt: new Date().toISOString(), ...extra })
    .where(eq(importJobFiles.id, jobFileId))
    .run();
}

export function markJobFileFailed(jobId: number, jobFileId: number, message: string): void {
  const db = getDb();
  db.update(importJobFiles)
    .set({ status: "failed", errorMessage: message, updatedAt: new Date().toISOString() })
    .where(eq(importJobFiles.id, jobFileId))
    .run();
  db.update(importJobs)
    .set({
      processedFiles: sql`${importJobs.processedFiles} + 1`,
      failedFiles: sql`${importJobs.failedFiles} + 1`,
    })
    .where(eq(importJobs.id, jobId))
    .run();
}
