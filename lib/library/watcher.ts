import { existsSync, statSync } from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { libraryRoots, tracks } from "../db/schema";
import { trackFingerprint } from "../import/fingerprint";
import { extractTags } from "../import/tags";
import { ensureAlbumArtistLink, ensureTrackArtistLink, upsertAlbum, upsertArtist } from "../import/upsert";
import { toRootRelative } from "../storage/resolveTrackPath";
import { isAudioFilePath } from "./audioExtensions";
import { getLibraryRootById, listLibraryRoots, type LibraryRootRow } from "./libraryRoots";
import { enqueueSingleFileFolderScan } from "./scan";

// One chokidar watcher per registered root, kept for the process lifetime (AGENTS.md
// watch-in-place design). Never watches anything outside a root explicitly added by the user.
const watchers = new Map<number, FSWatcher>();

export function isWatcherActive(rootId: number): boolean {
  return watchers.has(rootId);
}

export function startWatcher(root: Pick<LibraryRootRow, "id" | "path">): void {
  if (watchers.has(root.id)) return;

  try {
    const watcher = chokidar.watch(root.path, {
      ignoreInitial: true,
      persistent: true,
      // Debounces the burst of events a big copy (a whole album) fires — an "add" only
      // reaches the handler once the file has stopped growing for a couple seconds.
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
    });

    watcher.on("add", (filePath) => {
      if (isAudioFilePath(filePath)) enqueueSingleFileFolderScan(root.id, filePath);
    });
    watcher.on("unlink", (filePath) => {
      if (isAudioFilePath(filePath)) handleUnlink(root.id, root.path, filePath);
    });
    watcher.on("change", (filePath) => {
      if (isAudioFilePath(filePath)) void handleChange(root.id, root.path, filePath);
    });
    watcher.on("error", (err) => {
      console.warn(`[local-fi] Watcher error for library root "${root.path}" — falling back to manual rescan.`, err);
    });

    watchers.set(root.id, watcher);
  } catch (err) {
    // Permissions, an unreachable network drive, etc. — the root stays registered and
    // usable via manual rescan; watching is a nice-to-have, not a hard requirement.
    console.warn(`[local-fi] Failed to start watcher for library root "${root.path}" — relying on manual rescan.`, err);
  }
}

export function stopWatcher(rootId: number): void {
  const watcher = watchers.get(rootId);
  if (!watcher) return;
  watchers.delete(rootId);
  void watcher.close();
}

export function startAllWatchers(): void {
  for (const root of listLibraryRoots()) startWatcher(root);
}

export function stopAllWatchers(): void {
  for (const rootId of Array.from(watchers.keys())) stopWatcher(rootId);
}

/** A watched file vanished (delete, or a rename that looks like delete+add — accepted tradeoff, no content-hash relink). */
function handleUnlink(rootId: number, rootPath: string, absPath: string): void {
  const relativePath = toRootRelative(rootPath, absPath);
  const db = getDb();
  db.update(tracks)
    .set({ missingSince: new Date().toISOString() })
    .where(and(eq(tracks.libraryRootId, rootId), eq(tracks.path, relativePath), isNull(tracks.deletedAt)))
    .run();
  db.update(libraryRoots)
    .set({ totalFileCount: sql`max(0, ${libraryRoots.totalFileCount} - 1)` })
    .where(eq(libraryRoots.id, rootId))
    .run();
}

/** A watched file's content changed on disk — refresh the fingerprint and, if tags moved, re-extract them. */
async function handleChange(rootId: number, rootPath: string, absPath: string): Promise<void> {
  const root = getLibraryRootById(rootId);
  if (!root) return;

  const relativePath = toRootRelative(rootPath, absPath);
  const db = getDb();
  const track = db
    .select()
    .from(tracks)
    .where(and(eq(tracks.libraryRootId, rootId), eq(tracks.path, relativePath), isNull(tracks.deletedAt)))
    .get();

  if (!track) {
    // Not indexed yet (e.g. it changed before its own "add" event was processed) — treat as new.
    enqueueSingleFileFolderScan(rootId, absPath);
    return;
  }
  if (!existsSync(absPath)) return;

  const stat = statSync(absPath);
  const fingerprint = trackFingerprint(relativePath, stat.size, stat.mtimeMs);
  if (fingerprint === track.fingerprint) return;

  try {
    const tags = await extractTags(absPath, path.basename(absPath));
    const now = new Date().toISOString();

    db.transaction((tx) => {
      const artist = upsertArtist(tx, tags.artist);
      const albumArtist = tags.albumArtist ? upsertArtist(tx, tags.albumArtist) : artist;
      const album = tags.album ? upsertAlbum(tx, tags.album, albumArtist.id, tags.year) : null;
      if (album) ensureAlbumArtistLink(tx, album.id, albumArtist.id, 0);

      tx.update(tracks)
        .set({
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
          codec: tags.codec,
          bitrate: tags.bitrate,
          sampleRate: tags.sampleRate,
          bitDepth: tags.bitDepth,
          channels: tags.channels,
          lossless: tags.lossless ? 1 : 0,
          rawTagsJson: tags.rawTagsJson,
          fingerprint,
          fileMtime: new Date(stat.mtimeMs).toISOString(),
          fileSizeBytes: stat.size,
          dateModified: now,
          missingSince: null,
        })
        .where(eq(tracks.id, track.id))
        .run();

      ensureTrackArtistLink(tx, track.id, artist.id, "primary", 0);
    });
  } catch {
    // Corrupt mid-write or a format the pipeline can't read right now — leave the row as-is;
    // the next full rescan (or the file settling) will reconcile it.
  }
}
