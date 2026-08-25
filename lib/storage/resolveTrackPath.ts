import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { libraryRoots } from "../db/schema";
import { getDataDir } from "./dataDir";

/**
 * Every call site that used to do `path.join(getDataDir(), track.path)` must go
 * through this instead — that join is only correct for managed tracks. A watched
 * track's `path` is relative to its library root, not the data dir (see the
 * watch-in-place design in AGENTS.md / the library_roots table).
 */
export function resolveTrackAbsPath(track: { path: string; libraryRootId: number | null }): string {
  if (track.libraryRootId == null) {
    return path.join(getDataDir(), track.path);
  }
  const root = getDb().select().from(libraryRoots).where(eq(libraryRoots.id, track.libraryRootId)).get();
  if (!root) {
    throw new Error(`Library root ${track.libraryRootId} no longer exists`);
  }
  return path.join(root.path, track.path);
}

function normalizeForCompare(absPath: string): string {
  const resolved = path.resolve(absPath);
  // Windows paths are case-insensitive; POSIX paths are not.
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** True if `absFile` is `absRoot` itself or lives somewhere under it. Resolved + separator-safe. */
export function isPathInsideRoot(absFile: string, absRoot: string): boolean {
  const file = normalizeForCompare(absFile);
  const root = normalizeForCompare(absRoot);
  return file === root || file.startsWith(root + path.sep);
}

/** Same-path comparison used for duplicate-root / overlap checks — resolved + case-normalized on Windows. */
export function pathsEqual(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/** Converts an absolute path under `rootAbsPath` into the posix-style relative string stored on `tracks.path`. */
export function toRootRelative(rootAbsPath: string, absFile: string): string {
  return path.relative(rootAbsPath, absFile).split(path.sep).join("/");
}
