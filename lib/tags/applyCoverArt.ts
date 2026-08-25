import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { albums, tracks } from "@/lib/db/schema";
import { extForPictureFormat } from "@/lib/import/coverArt";
import { trackFingerprint } from "@/lib/import/fingerprint";
import { artworkPathFor, toDataDirRelative } from "@/lib/import/paths";
import { getDataDir } from "@/lib/storage/dataDir";
import { resolveTrackAbsPath } from "@/lib/storage/resolveTrackPath";
import { formatSupportsEmbeddedPictures } from "./coverFormats";
import type { CoverImage } from "./coverImage";
import { writeTrackCoverArt } from "./writeTags";

type TrackRow = typeof tracks.$inferSelect;

export function applyCoverArtToTrack(
  track: TrackRow,
  image: CoverImage,
  options: { promoteToAlbum?: "if-empty-or-same" | "always" | "never" } = {}
): { embedded: boolean; coverArtRelativePath: string } {
  const promoteToAlbum = options.promoteToAlbum ?? "if-empty-or-same";
  const absPath = resolveTrackAbsPath(track);
  const canEmbed = formatSupportsEmbeddedPictures(track.format);

  if (canEmbed) {
    writeTrackCoverArt(absPath, image);
  }

  const ext = extForPictureFormat(image.mimeType);
  const artPath = artworkPathFor(track.uuid, ext);
  mkdirSync(path.dirname(artPath), { recursive: true });
  writeFileSync(artPath, image.bytes);
  const coverArtRelativePath = toDataDirRelative(artPath);
  const previousCoverPath = track.coverArtPath;

  const now = new Date().toISOString();
  const db = getDb();

  if (canEmbed) {
    const stat = statSync(absPath);
    db.update(tracks)
      .set({
        coverArtPath: coverArtRelativePath,
        fileMtime: new Date(stat.mtimeMs).toISOString(),
        fileSizeBytes: stat.size,
        fingerprint: trackFingerprint(track.path, stat.size, stat.mtimeMs),
        dateModified: now,
      })
      .where(eq(tracks.id, track.id))
      .run();
  } else {
    db.update(tracks)
      .set({ coverArtPath: coverArtRelativePath, dateModified: now })
      .where(eq(tracks.id, track.id))
      .run();
  }

  if (track.albumId && promoteToAlbum !== "never") {
    const album = db.select().from(albums).where(eq(albums.id, track.albumId)).get();
    const shouldPromote =
      promoteToAlbum === "always" ||
      !album?.coverArtPath ||
      album.coverArtPath === previousCoverPath;
    if (album && shouldPromote) {
      db.update(albums).set({ coverArtPath: coverArtRelativePath }).where(eq(albums.id, track.albumId)).run();
    }
  }

  unlinkOrphanCoverSidecar(previousCoverPath);

  return { embedded: canEmbed, coverArtRelativePath };
}

/** Drops a sidecar file only when no track or album row still points at it. */
export function unlinkOrphanCoverSidecar(relativePath: string | null | undefined): void {
  if (!relativePath) return;
  const db = getDb();
  const usedByTrack = db.select({ id: tracks.id }).from(tracks).where(eq(tracks.coverArtPath, relativePath)).get();
  if (usedByTrack) return;
  const usedByAlbum = db.select({ id: albums.id }).from(albums).where(eq(albums.coverArtPath, relativePath)).get();
  if (usedByAlbum) return;

  const oldAbs = path.join(getDataDir(), relativePath);
  try {
    if (existsSync(oldAbs)) unlinkSync(oldAbs);
  } catch {
    // Best-effort: don't fail the write because an old sidecar is locked.
  }
}
