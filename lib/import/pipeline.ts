import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { insertTrackRow, markJobFileFailed, readTagsAndWaveform, setJobFileStatus, writeSidecars } from "./indexCommon";
import { publishJobUpdate } from "./events";
import { originalsDirFor, sanitizeFilename, toDataDirRelative } from "./paths";
import { CorruptFileError, UnsupportedFormatError } from "./tags";

/**
 * Runs one staged file through the full copy-on-import pipeline (ARCHITECTURE.md §5/§6):
 * tag extraction -> waveform generation -> atomic move into originals/ -> artist/album
 * upsert -> track insert. Never throws — failures are recorded on the import_job_files
 * row so one bad file doesn't abort the rest of the batch.
 */
export async function processImportFile(jobId: number, jobFileId: number, stagedPath: string, originalFilename: string): Promise<void> {
  let waveformWritten: string | null = null;
  let movedTo: string | null = null;

  try {
    setJobFileStatus(jobFileId, "reading_tags");
    publishJobUpdate(jobId);

    const { tags, waveform } = await readTagsAndWaveform(stagedPath, originalFilename);

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
    renameSync(stagedPath, destPath);
    movedTo = destPath;

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
