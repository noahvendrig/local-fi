import { randomUUID } from "node:crypto";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { importJobs, tracks } from "../db/schema";
import { getLibraryRootById } from "../library/libraryRoots";
import { syncTrackIntoCrates } from "../library/syncCrates";
import { toRootRelative } from "../storage/resolveTrackPath";
import { publishJobUpdate } from "./events";
import { insertTrackRow, markJobFileFailed, readTagsAndWaveform, setJobFileStatus, writeSidecars } from "./indexCommon";
import { CorruptFileError, UnsupportedFormatError } from "./tags";

/**
 * Indexes one file from a watched library root in place — no copy, no move, the source
 * file is never touched. Mirrors processImportFile's tag/waveform/upsert steps (via
 * indexCommon) but skips the staging->originals/ relocation entirely (AGENTS.md:
 * watch-in-place import pipeline). Never throws — failures land on the import_job_files row.
 */
export async function processFolderScanFile(
  jobId: number,
  jobFileId: number,
  absPath: string,
  originalFilename: string,
  libraryRootId: number
): Promise<void> {
  const db = getDb();
  let waveformWritten: string | null = null;

  try {
    const root = getLibraryRootById(libraryRootId);
    if (!root) throw new Error("Library root no longer exists");
    if (!existsSync(absPath)) throw new Error("File no longer exists on disk");

    const relativePath = toRootRelative(root.path, absPath);

    // Idempotent rescan: a concurrent scan pass and the live watcher can both discover the
    // same new file — skip rather than double-insert if this root already indexed it.
    const already = db
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.libraryRootId, libraryRootId), eq(tracks.path, relativePath)))
      .get();
    if (already) {
      setJobFileStatus(jobFileId, "duplicate_skipped", { trackId: already.id });
      db.update(importJobs)
        .set({ processedFiles: sql`${importJobs.processedFiles} + 1` })
        .where(eq(importJobs.id, jobId))
        .run();
      publishJobUpdate(jobId);
      return;
    }

    setJobFileStatus(jobFileId, "reading_tags");
    publishJobUpdate(jobId);

    const { tags, waveform } = await readTagsAndWaveform(absPath, originalFilename);

    setJobFileStatus(jobFileId, "transcoding_waveform");
    publishJobUpdate(jobId);

    const trackUuid = randomUUID();
    const { waveformAbsPath, coverArtRelativePath } = writeSidecars(trackUuid, tags, waveform);
    waveformWritten = waveformAbsPath;

    setJobFileStatus(jobFileId, "saving");
    publishJobUpdate(jobId);

    const stat = statSync(absPath);

    const track = insertTrackRow({
      uuid: trackUuid,
      relativePath,
      libraryRootId,
      fileSizeBytes: stat.size,
      fileMtimeMs: stat.mtimeMs,
      tags,
      waveform,
      waveformAbsPath,
      coverArtRelativePath,
      importJobId: jobId,
      jobFileId,
    });

    syncTrackIntoCrates(root, relativePath, track.id);

    publishJobUpdate(jobId);
  } catch (err) {
    // The user's file is never touched here — only clean up a sidecar orphaned by the failure.
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
