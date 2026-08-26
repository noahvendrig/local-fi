import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { insertTrackRow, markJobFileFailed, readTagsAndWaveform, setJobFileStatus, writeSidecars } from "./indexCommon";
import { publishJobUpdate } from "./events";
import { originalsDirFor, sanitizeFilename, toDataDirRelative } from "./paths";
import { CorruptFileError, UnsupportedFormatError } from "./tags";
import { COMPRESS_BITRATE_KBPS, shouldCompress, transcodeToOpus } from "./transcode";
import { writeTrackCoverArt, writeTrackTags } from "../tags/writeTags";

/** Swaps a filename's extension, e.g. "Track.flac" -> "Track.opus". */
function withExtension(filename: string, ext: string): string {
  const parsed = path.parse(filename);
  return `${parsed.name}.${ext}`;
}

/**
 * Runs one staged file through the full copy-on-import pipeline (ARCHITECTURE.md §5/§6):
 * tag extraction -> waveform generation -> atomic move into originals/ -> artist/album
 * upsert -> track insert. Never throws — failures are recorded on the import_job_files
 * row so one bad file doesn't abort the rest of the batch.
 */
export async function processImportFile(
  jobId: number,
  jobFileId: number,
  stagedPath: string,
  originalFilename: string,
  compressAudio = false
): Promise<void> {
  let waveformWritten: string | null = null;
  let movedTo: string | null = null;
  let transcodedTempPath: string | null = null;

  try {
    setJobFileStatus(jobFileId, "reading_tags");
    publishJobUpdate(jobId);

    const extracted = await readTagsAndWaveform(stagedPath, originalFilename);
    let tags = extracted.tags;
    const { waveform } = extracted;
    let sourcePath = stagedPath;
    let sourceFilename = originalFilename;

    setJobFileStatus(jobFileId, "transcoding_waveform");
    publishJobUpdate(jobId);

    if (compressAudio && shouldCompress(tags)) {
      const candidatePath = `${stagedPath}.opus`;
      try {
        await transcodeToOpus(stagedPath, candidatePath);
        transcodedTempPath = candidatePath;

        try {
          if (tags.coverArt) {
            writeTrackCoverArt(candidatePath, { bytes: tags.coverArt.data, mimeType: tags.coverArt.format });
          }
          writeTrackTags(candidatePath, {
            title: tags.title,
            artist: tags.artist,
            album: tags.album,
            albumArtist: tags.albumArtist,
            trackNumber: tags.trackNumber,
            discNumber: tags.discNumber,
            year: tags.year,
            genre: tags.genre,
            bpm: tags.bpm,
            key: tags.key,
          });
        } catch {
          // Best-effort re-embed — the app's own cover/tag display comes from the DB and
          // the artwork sidecar (written below), not the file, so this never breaks the UI.
        }

        sourcePath = candidatePath;
        sourceFilename = withExtension(originalFilename, "opus");
        tags = {
          ...tags,
          format: "ogg",
          codec: "opus",
          bitrate: COMPRESS_BITRATE_KBPS * 1000,
          sampleRate: 48000,
          bitDepth: null,
          lossless: false,
        };
      } catch {
        // Compression failed (e.g. an ffmpeg hiccup) — fall back to importing the original file untouched.
        transcodedTempPath = null;
        if (existsSync(candidatePath)) {
          try {
            unlinkSync(candidatePath);
          } catch {
            /* ignore */
          }
        }
      }
    }

    const trackUuid = randomUUID();
    const { waveformAbsPath, coverArtRelativePath } = writeSidecars(trackUuid, tags, waveform);
    waveformWritten = waveformAbsPath;

    setJobFileStatus(jobFileId, "saving");
    publishJobUpdate(jobId);

    const destDir = originalsDirFor(trackUuid);
    mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, sanitizeFilename(sourceFilename));
    renameSync(sourcePath, destPath);
    movedTo = destPath;
    transcodedTempPath = null;

    if (sourcePath !== stagedPath && existsSync(stagedPath)) {
      // The compressed copy has replaced it — drop the original so the space is actually reclaimed.
      try {
        unlinkSync(stagedPath);
      } catch {
        /* ignore */
      }
    }

    const stat = statSync(destPath);
    const relativePath = toDataDirRelative(destPath);

    insertTrackRow({
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
    });

    publishJobUpdate(jobId);
  } catch (err) {
    // Best-effort cleanup so a failed file doesn't leave orphaned artifacts behind.
    if (transcodedTempPath && existsSync(transcodedTempPath)) {
      try {
        unlinkSync(transcodedTempPath);
      } catch {
        /* ignore */
      }
    }
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

    markJobFileFailed(jobId, jobFileId, message);
    publishJobUpdate(jobId);
  }
}
