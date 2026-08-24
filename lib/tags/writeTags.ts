import { File } from "node-taglib-sharp";

export interface TrackTagWrite {
  title?: string;
  artist?: string;
  album?: string | null;
  albumArtist?: string | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  year?: number | null;
  genre?: string | null;
}

/**
 * Writes tag fields to the physical file (ARCHITECTURE.md §5). The DB row is only ever
 * updated after this succeeds, so it can never drift from the file (§3's source-of-truth rule) —
 * if the write throws, the caller must not touch the DB.
 */
export function writeTrackTags(absPath: string, patch: TrackTagWrite): void {
  const file = File.createFromPath(absPath);
  try {
    if (patch.title !== undefined) file.tag.title = patch.title;
    if (patch.artist !== undefined) file.tag.performers = [patch.artist];
    if (patch.album !== undefined) file.tag.album = patch.album ?? "";
    if (patch.albumArtist !== undefined) file.tag.albumArtists = patch.albumArtist ? [patch.albumArtist] : [];
    if (patch.trackNumber !== undefined) file.tag.track = patch.trackNumber ?? 0;
    if (patch.discNumber !== undefined) file.tag.disc = patch.discNumber ?? 0;
    if (patch.year !== undefined) file.tag.year = patch.year ?? 0;
    if (patch.genre !== undefined) file.tag.genres = patch.genre ? [patch.genre] : [];
    file.save();
  } finally {
    file.dispose();
  }
}
