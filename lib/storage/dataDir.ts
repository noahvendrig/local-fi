import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

// See ARCHITECTURE.md §2 for the full layout this bootstraps.
const SUBDIRS = ["originals", "artwork", "waveforms", "staging", "trash", "tmp"] as const;

export function getDataDir(): string {
  // Runtime-only storage outside the source tree — never meant to be traced/bundled.
  return path.resolve(/* turbopackIgnore: true */ process.env.LOCALFI_DATA_DIR ?? "./data");
}

export function getDbPath(): string {
  return path.join(getDataDir(), "library.db");
}

export function getAuthTokenPath(): string {
  return path.join(getDataDir(), "auth-token");
}

/** Creates LOCALFI_DATA_DIR and all subdirectories it needs. Idempotent. */
export function bootstrapDataDir(): string {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  for (const sub of SUBDIRS) {
    mkdirSync(path.join(/* turbopackIgnore: true */ dataDir, sub), { recursive: true });
  }
  return dataDir;
}

/** Writes then removes a scratch file under tmp/ to confirm the data dir is actually writable. */
export function isDataDirWritable(): boolean {
  try {
    bootstrapDataDir();
    const probePath = path.join(getDataDir(), "tmp", `.write-check-${randomUUID()}`);
    writeFileSync(probePath, "");
    rmSync(probePath);
    return true;
  } catch {
    return false;
  }
}
