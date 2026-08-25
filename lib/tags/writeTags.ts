import { ByteVector, File, Picture, PictureType } from "node-taglib-sharp";
import { camelotToWriteableKey } from "@/lib/tags/camelotKey";
import type { CoverImage } from "./coverImage";

export interface TrackTagWrite {
  title?: string;
  artist?: string;
  album?: string | null;
  albumArtist?: string | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  year?: number | null;
  genre?: string | null;
  bpm?: number | null;
  /** Camelot notation (e.g. "8A"); converted to standard key text before writing. */
  key?: string | null;
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
    if (patch.bpm !== undefined) file.tag.beatsPerMinute = patch.bpm ?? 0;
    if (patch.key !== undefined) file.tag.initialKey = patch.key ? (camelotToWriteableKey(patch.key) ?? "") : "";
    file.save();
  } finally {
    file.dispose();
  }
}

/** Embeds a front-cover picture in the audio file. Caller must only invoke this when the format can hold pictures. */
export function writeTrackCoverArt(absPath: string, image: CoverImage): void {
  const file = File.createFromPath(absPath);
  try {
    const picture = Picture.fromData(ByteVector.fromByteArray(image.bytes));
    picture.type = PictureType.FrontCover;
    picture.mimeType = image.mimeType;
    picture.description = "Cover";
    file.tag.pictures = [picture];
    file.save();
  } finally {
    file.dispose();
  }
}
