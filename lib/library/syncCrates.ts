import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { getDb } from "../db/client";
import { libraryRootCrates, playlistTracks, playlists, tracks } from "../db/schema";
import type { LibraryRootRow } from "./libraryRoots";

/** Immediate subfolder of a root-relative path, or null for a file sitting directly in the root — mirrors lib/import/folderPlaylists.ts's grouping. */
function immediateSubfolderOf(relativePath: string): string | null {
  const segments = relativePath.split("/").filter(Boolean);
  return segments.length > 1 ? segments[0] : null;
}

/** Finds or creates the manual crate that mirrors one scope of a synced root — the whole root ("") or one immediate subfolder. */
function ensureCrateForScope(root: LibraryRootRow, subfolderPath: string, crateName: string): number {
  const db = getDb();
  const existing = db
    .select()
    .from(libraryRootCrates)
    .where(and(eq(libraryRootCrates.libraryRootId, root.id), eq(libraryRootCrates.subfolderPath, subfolderPath)))
    .get();
  if (existing) return existing.playlistId;

  const now = new Date().toISOString();
  const playlist = db
    .insert(playlists)
    .values({ uuid: randomUUID(), name: crateName, type: "manual", createdAt: now, updatedAt: now })
    .returning()
    .get();

  db.insert(libraryRootCrates).values({ libraryRootId: root.id, playlistId: playlist.id, subfolderPath }).run();

  return playlist.id;
}

function addTrackToCrate(playlistId: number, trackId: number): void {
  const db = getDb();
  const already = db
    .select({ id: playlistTracks.id })
    .from(playlistTracks)
    .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId)))
    .get();
  if (already) return;

  const last = db
    .select({ position: playlistTracks.position })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(desc(playlistTracks.position))
    .get();
  const position = generateKeyBetween(last?.position ?? null, null);

  db.insert(playlistTracks).values({ playlistId, trackId, position, addedAt: new Date().toISOString() }).run();
}

/**
 * Adds a newly-indexed watched track to its root's synced crate, and to its immediate
 * subfolder's own crate if it's nested one. No-op unless the root has sync-to-crate enabled.
 * Crates are created on demand the first time a scope is seen, so a subfolder added to the
 * watched folder later automatically gets its own crate too — no separate "new folder" step.
 */
export function syncTrackIntoCrates(root: LibraryRootRow, relativePath: string, trackId: number): void {
  if (!root.syncToCrate) return;

  const rootCratePlaylistId = ensureCrateForScope(root, "", root.name);
  addTrackToCrate(rootCratePlaylistId, trackId);

  const subfolder = immediateSubfolderOf(relativePath);
  if (subfolder) {
    const subfolderCratePlaylistId = ensureCrateForScope(root, subfolder, subfolder);
    addTrackToCrate(subfolderCratePlaylistId, trackId);
  }
}

/**
 * Catches up a root's crates with every track it already has indexed — run this right after
 * flipping syncToCrate on, so turning sync on isn't limited to tracks discovered from that
 * point forward. Safe to call anytime; syncTrackIntoCrates/addTrackToCrate are idempotent.
 */
export function backfillSyncForRoot(root: LibraryRootRow): void {
  if (!root.syncToCrate) return;
  const activeTracks = getDb()
    .select({ id: tracks.id, path: tracks.path })
    .from(tracks)
    .where(and(eq(tracks.libraryRootId, root.id), isNull(tracks.deletedAt)))
    .all();
  for (const track of activeTracks) {
    syncTrackIntoCrates(root, track.path, track.id);
  }
}
