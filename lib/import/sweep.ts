import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "../db/client";
import { importJobFiles, importJobs } from "../db/schema";
import { getDataDir } from "../storage/dataDir";
import { enqueueImportJob } from "./queue";

const STALE_STAGING_MS = 24 * 60 * 60 * 1000;

// Every import_job_files status except the terminal ones ('done', 'failed',
// 'duplicate_skipped') — a file caught in any of these when the process dies
// was mid-pipeline and needs to be reprocessed from scratch.
const NON_TERMINAL_STATUSES = ["queued", "matching", "downloading", "reading_tags", "transcoding_waveform", "saving"];

/**
 * ARCHITECTURE.md §3.7 crash recovery, updated: a job left `running` used to
 * just get marked `failed` with no auto-resume, on the theory that for a plain
 * file drop, re-dropping the files is cheap. That doesn't hold for
 * `spotify_import` jobs — "just redo it" means re-matching and re-downloading
 * an entire playlist from scratch. Instead, any file left in a non-terminal
 * status (still `queued`, or caught mid-pipeline) when the process died gets
 * reset to `queued` and its job re-enqueued on the next startup. Already-`done`
 * files are untouched, and processSpotifyImportFile's duplicate-skip check
 * means a track that made it into the library before the crash won't be
 * downloaded again. Anything left in staging/ older than 24h gets swept too.
 */
export function sweepStaleImports(): void {
  const db = getDb();

  const staleFiles = db
    .select({ id: importJobFiles.id, jobId: importJobFiles.jobId, status: importJobFiles.status })
    .from(importJobFiles)
    .innerJoin(importJobs, eq(importJobFiles.jobId, importJobs.id))
    .where(and(inArray(importJobFiles.status, NON_TERMINAL_STATUSES), ne(importJobs.status, "cancelled")))
    .all();

  if (staleFiles.length > 0) {
    const toReset = staleFiles.filter((f) => f.status !== "queued").map((f) => f.id);
    if (toReset.length > 0) {
      db.update(importJobFiles)
        .set({ status: "queued", updatedAt: new Date().toISOString() })
        .where(inArray(importJobFiles.id, toReset))
        .run();
    }

    // enqueueImportJob only picks up files still 'queued' and unconditionally flips
    // the job back to 'running' — safe to call even for jobs an earlier startup's
    // sweep already marked 'failed', or ones that never got past 'pending'.
    const jobIds = [...new Set(staleFiles.map((f) => f.jobId))];
    for (const jobId of jobIds) {
      enqueueImportJob(jobId);
    }
  }

  const stagingDir = path.join(getDataDir(), "staging");
  if (!existsSync(stagingDir)) return;

  const now = Date.now();
  for (const entry of readdirSync(stagingDir)) {
    const entryPath = path.join(stagingDir, entry);
    try {
      const stat = statSync(entryPath);
      if (now - stat.mtimeMs > STALE_STAGING_MS) {
        rmSync(entryPath, { recursive: true, force: true });
      }
    } catch {
      // best-effort sweep; skip entries that vanish mid-scan
    }
  }
}
