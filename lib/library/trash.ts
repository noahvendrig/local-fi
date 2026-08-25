import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { trackFingerprint } from "@/lib/import/fingerprint";
import { trashDirFor } from "@/lib/import/paths";
import { DEFAULT_TRASH_GRACE_DAYS } from "@/lib/library/trashConfig";
import { getDataDir } from "@/lib/storage/dataDir";
import { resolveTrackAbsPath } from "@/lib/storage/resolveTrackPath";

export { DEFAULT_TRASH_GRACE_DAYS };

type TrackRow = typeof tracks.$inferSelect;

export function trashGraceDays(): number {
  const raw = process.env.LOCALFI_TRASH_GRACE_DAYS;
  const parsed = raw ? Number(raw) : DEFAULT_TRASH_GRACE_DAYS;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TRASH_GRACE_DAYS;
  return Math.floor(parsed);
}

export function daysRemainingInTrash(deletedAt: string, graceDays = trashGraceDays()): number {
  const purgeAt = Date.parse(deletedAt) + graceDays * 86_400_000;
  if (Number.isNaN(purgeAt)) return 0;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / 86_400_000));
}

function originalsAbsPath(track: TrackRow): string {
  return resolveTrackAbsPath(track);
}

function findTrashAudio(track: TrackRow): string | null {
  const dir = trashDirFor(track.uuid);
  if (!existsSync(dir)) return null;
  const preferred = path.join(dir, path.basename(track.path));
  if (existsSync(preferred)) return preferred;
  const files = readdirSync(dir).filter((name) => !name.startsWith("."));
  if (files.length === 1) return path.join(dir, files[0]);
  return null;
}

function isBusyError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

function sleepMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Local app: wait for the OS to release a just-closed audio file (Windows especially).
  }
}

function renameWithRetry(from: string, to: string): void {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      mkdirSync(path.dirname(to), { recursive: true });
      renameSync(from, to);
      return;
    } catch (err) {
      lastErr = err;
      if (!isBusyError(err)) throw err;
      sleepMs(50 * (attempt + 1));
    }
  }
  throw lastErr;
}

function unlinkQuiet(filePath: string | null | undefined): void {
  if (!filePath) return;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(getDataDir(), filePath);
  try {
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    // Best-effort sidecar cleanup — a purged row shouldn't be blocked by a locked file.
  }
}

/**
 * Move the audio into trash/ and stamp deletedAt. Leaves waveform/art in place so restore is instant.
 * A watched track's audio lives inside its library root, not the data dir — it's never moved or
 * unlinked (index-only removal); only deletedAt flips.
 */
export function softDeleteTrack(track: TrackRow): void {
  if (track.deletedAt) return;

  if (track.libraryRootId == null) {
    const absPath = originalsAbsPath(track);
    if (!track.missingSince && existsSync(absPath)) {
      const trashPath = path.join(trashDirFor(track.uuid), path.basename(absPath));
      renameWithRetry(absPath, trashPath);
    }
  }

  getDb().update(tracks).set({ deletedAt: new Date().toISOString() }).where(eq(tracks.id, track.id)).run();
}

/**
 * Move the audio back into originals/ and clear deletedAt.
 * If the trash file is gone, the row is still restored and flagged missing so Health can pick it up.
 */
export function restoreTrack(track: TrackRow): void {
  if (!track.deletedAt) return;

  const dest = originalsAbsPath(track);
  const trashAudio = findTrashAudio(track);
  let missingSince = track.missingSince;

  if (trashAudio) {
    if (existsSync(dest)) {
      try {
        rmSync(trashDirFor(track.uuid), { recursive: true, force: true });
      } catch {
        // Directory cleanup is best-effort.
      }
    } else {
      renameWithRetry(trashAudio, dest);
      try {
        rmSync(trashDirFor(track.uuid), { recursive: true, force: true });
      } catch {
        // Directory cleanup is best-effort.
      }
    }
    missingSince = null;
  } else if (!existsSync(dest)) {
    missingSince = missingSince ?? new Date().toISOString();
  }

  const now = new Date().toISOString();
  let fileMtime = track.fileMtime;
  let fileSizeBytes = track.fileSizeBytes;
  let fingerprint = track.fingerprint;
  if (existsSync(dest)) {
    const stat = statSync(dest);
    fileMtime = new Date(stat.mtimeMs).toISOString();
    fileSizeBytes = stat.size;
    fingerprint = trackFingerprint(track.path, stat.size, stat.mtimeMs);
  }

  getDb()
    .update(tracks)
    .set({
      deletedAt: null,
      missingSince,
      fileMtime,
      fileSizeBytes,
      fingerprint,
      dateModified: now,
    })
    .where(eq(tracks.id, track.id))
    .run();
}

/** Permanently drop the row and any leftover waveform/art files. A watched track's audio is never unlinked. */
export function purgeTrack(track: TrackRow): void {
  if (track.libraryRootId == null) {
    unlinkQuiet(originalsAbsPath(track));
  }
  try {
    rmSync(trashDirFor(track.uuid), { recursive: true, force: true });
  } catch {
    // ignore
  }
  unlinkQuiet(track.waveformPath);
  unlinkQuiet(track.coverArtPath);
  getDb().delete(tracks).where(eq(tracks.id, track.id)).run();
}

/** Purge anything sitting in trash longer than the grace period (ARCHITECTURE.md §2). */
export function sweepExpiredTrash(): number {
  const cutoff = new Date(Date.now() - trashGraceDays() * 86_400_000).toISOString();
  const expired = getDb()
    .select()
    .from(tracks)
    .where(and(isNotNull(tracks.deletedAt), lte(tracks.deletedAt, cutoff)))
    .all();
  for (const track of expired) purgeTrack(track);
  return expired.length;
}

export function emptyTrash(): number {
  const trashed = getDb().select().from(tracks).where(isNotNull(tracks.deletedAt)).all();
  for (const track of trashed) purgeTrack(track);
  return trashed.length;
}
