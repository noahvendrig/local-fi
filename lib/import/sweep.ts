import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { importJobs } from "../db/schema";
import { getDataDir } from "../storage/dataDir";

const STALE_STAGING_MS = 24 * 60 * 60 * 1000;

/**
 * ARCHITECTURE.md §3.7 crash recovery: a job left `running` from a previous
 * process means that process died mid-import — no auto-resume, just mark it
 * failed. Anything left in staging/ older than 24h gets swept too.
 */
export function sweepStaleImports(): void {
  const db = getDb();
  const stuck = db.select().from(importJobs).where(eq(importJobs.status, "running")).all();
  if (stuck.length > 0) {
    db.update(importJobs)
      .set({ status: "failed", finishedAt: new Date().toISOString() })
      .where(
        inArray(
          importJobs.id,
          stuck.map((j) => j.id)
        )
      )
      .run();
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
