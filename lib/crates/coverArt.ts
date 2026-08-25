import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { playlists } from "@/lib/db/schema";
import { artworkPathFor, toDataDirRelative } from "@/lib/import/paths";
import { getDataDir } from "@/lib/storage/dataDir";

export const PLAYLIST_COVER_MAX_BYTES = 10 * 1024 * 1024;

export type CoverImageExt = "jpg" | "png" | "webp" | "gif";

/** Identifies a raster image from magic bytes — MIME headers are not trusted. */
export function detectCoverImageExt(bytes: Uint8Array): CoverImageExt | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "gif";
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (isRiff && isWebp) return "webp";
  return null;
}

export function unlinkCoverArtFile(relativePath: string | null | undefined): void {
  if (!relativePath) return;
  const abs = path.join(getDataDir(), relativePath);
  try {
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    // Best-effort — replacing or deleting a crate shouldn't fail because the sidecar is locked.
  }
}

/** Writes cover bytes under artwork/<shard>/<playlist-uuid>.<ext> and removes a previous file with a different extension. */
export function writePlaylistCoverArt(playlistUuid: string, previousRelativePath: string | null, bytes: Buffer, ext: CoverImageExt): string {
  const absPath = artworkPathFor(playlistUuid, ext);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, bytes);
  const relativePath = toDataDirRelative(absPath);
  if (previousRelativePath && previousRelativePath !== relativePath) {
    unlinkCoverArtFile(previousRelativePath);
  }
  return relativePath;
}

/** Deletes the playlist row after unlinking its uploaded cover. Returns false if the row was already gone. */
export function deletePlaylistRecord(playlistId: number): boolean {
  const db = getDb();
  const row = db.select({ coverArtPath: playlists.coverArtPath }).from(playlists).where(eq(playlists.id, playlistId)).get();
  if (!row) return false;
  unlinkCoverArtFile(row.coverArtPath);
  db.delete(playlists).where(eq(playlists.id, playlistId)).run();
  return true;
}
