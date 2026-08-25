import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { deletePlaylistRecord } from "../crates/coverArt";
import { getDb } from "../db/client";
import { libraryRootCrates, libraryRoots, tracks } from "../db/schema";
import { isPathInsideRoot, pathsEqual } from "../storage/resolveTrackPath";
import { getDataDir } from "../storage/dataDir";
import { purgeTrack } from "./trash";

export type LibraryRootRow = typeof libraryRoots.$inferSelect;
export interface LibraryRootSummary extends LibraryRootRow {
  trackCount: number;
  missingCount: number;
  /** The root-level synced crate's playlist id, if `syncToCrate` is on and it's been created yet. */
  rootCrateId: number | null;
}

export type RootValidationErrorCode = "not_found" | "not_a_directory" | "inside_data_dir" | "duplicate" | "overlapping_root";

export class RootValidationFailure extends Error {
  code: RootValidationErrorCode;
  constructor(code: RootValidationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function listLibraryRoots(): LibraryRootSummary[] {
  const db = getDb();
  return db
    .select()
    .from(libraryRoots)
    .all()
    .map((root) => {
      const trackCount =
        db
          .select({ c: count() })
          .from(tracks)
          .where(and(eq(tracks.libraryRootId, root.id), isNull(tracks.deletedAt)))
          .get()?.c ?? 0;
      const missingCount =
        db
          .select({ c: count() })
          .from(tracks)
          .where(and(eq(tracks.libraryRootId, root.id), isNull(tracks.deletedAt), isNotNull(tracks.missingSince)))
          .get()?.c ?? 0;
      const rootCrateId = root.syncToCrate
        ? (db
            .select({ playlistId: libraryRootCrates.playlistId })
            .from(libraryRootCrates)
            .where(and(eq(libraryRootCrates.libraryRootId, root.id), eq(libraryRootCrates.subfolderPath, "")))
            .get()?.playlistId ?? null)
        : null;
      return { ...root, trackCount, missingCount, rootCrateId };
    });
}

export function getLibraryRootById(id: number): LibraryRootRow | undefined {
  return getDb().select().from(libraryRoots).where(eq(libraryRoots.id, id)).get();
}

/** Validates a candidate root path against the rules in AGENTS.md (exists, is a dir, not inside data dir, no overlap with an existing root). Throws RootValidationFailure. */
function validateNewRootPath(rawPath: string): string {
  const absPath = path.resolve(rawPath);

  if (!existsSync(absPath)) {
    throw new RootValidationFailure("not_found", "That folder doesn't exist.");
  }
  if (!statSync(absPath).isDirectory()) {
    throw new RootValidationFailure("not_a_directory", "That path is not a folder.");
  }

  const dataDir = path.resolve(getDataDir());
  if (isPathInsideRoot(absPath, dataDir) || isPathInsideRoot(dataDir, absPath)) {
    throw new RootValidationFailure(
      "inside_data_dir",
      "Library folders can't be inside — or contain — the app's data directory."
    );
  }

  for (const existing of getDb().select().from(libraryRoots).all()) {
    if (pathsEqual(absPath, existing.path)) {
      throw new RootValidationFailure("duplicate", "That folder is already a library root.");
    }
    if (isPathInsideRoot(absPath, existing.path) || isPathInsideRoot(existing.path, absPath)) {
      throw new RootValidationFailure(
        "overlapping_root",
        `That folder overlaps with the existing library root "${existing.name}".`
      );
    }
  }

  return absPath;
}

export function createLibraryRoot(rawPath: string, name?: string, syncToCrate = false): LibraryRootRow {
  const absPath = validateNewRootPath(rawPath);
  const displayName = name?.trim() || path.basename(absPath) || absPath;

  return getDb()
    .insert(libraryRoots)
    .values({
      uuid: randomUUID(),
      name: displayName,
      path: absPath,
      syncToCrate: syncToCrate ? 1 : 0,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

/** Persists the recognized-audio-file count from a fresh walk of this root (lib/library/scan.ts). */
export function updateRootFileCount(id: number, totalFileCount: number): void {
  getDb().update(libraryRoots).set({ totalFileCount }).where(eq(libraryRoots.id, id)).run();
}

export function renameLibraryRoot(id: number, name: string): LibraryRootRow | undefined {
  const trimmed = name.trim();
  if (!trimmed) return getLibraryRootById(id);
  return getDb().update(libraryRoots).set({ name: trimmed }).where(eq(libraryRoots.id, id)).returning().get();
}

/** Toggles sync-to-crate on an existing root — callable anytime, not just at add time. */
export function updateSyncToCrate(id: number, syncToCrate: boolean): LibraryRootRow | undefined {
  return getDb()
    .update(libraryRoots)
    .set({ syncToCrate: syncToCrate ? 1 : 0 })
    .where(eq(libraryRoots.id, id))
    .returning()
    .get();
}

/**
 * Index-only removal: deletes the root's rows (and their waveform/art sidecars) but never
 * touches audio on disk. Any crates synced from this root are removed too — they were purely
 * a mirror of a folder that no longer exists in the library.
 */
export function removeLibraryRoot(id: number): LibraryRootRow | undefined {
  const db = getDb();
  const root = getLibraryRootById(id);
  if (!root) return undefined;

  const rootTracks = db.select().from(tracks).where(eq(tracks.libraryRootId, id)).all();
  for (const track of rootTracks) purgeTrack(track);

  const syncedCrates = db.select().from(libraryRootCrates).where(eq(libraryRootCrates.libraryRootId, id)).all();
  for (const crate of syncedCrates) {
    deletePlaylistRecord(crate.playlistId);
  }

  db.delete(libraryRoots).where(eq(libraryRoots.id, id)).run();
  return root;
}
