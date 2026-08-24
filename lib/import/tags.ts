import { parseFile } from "music-metadata";
import path from "node:path";

/** Formats validated end-to-end by the phase-1 import pipeline (ARCHITECTURE.md §3.1 note). */
export const SUPPORTED_FORMATS = ["mp3", "flac", "wav", "aac", "m4a", "ogg", "alac", "aiff"] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

const EXT_TO_FORMAT: Record<string, SupportedFormat> = {
  ".mp3": "mp3",
  ".flac": "flac",
  ".wav": "wav",
  ".aac": "aac",
  ".m4a": "m4a",
  ".ogg": "ogg",
  ".oga": "ogg",
  ".aif": "aiff",
  ".aiff": "aiff",
};

const LOSSLESS_FORMATS = new Set<SupportedFormat>(["flac", "wav", "alac", "aiff"]);

export interface ExtractedTags {
  title: string;
  artist: string;
  albumArtist: string | null;
  album: string | null;
  trackNumber: number | null;
  trackTotal: number | null;
  discNumber: number | null;
  discTotal: number | null;
  year: number | null;
  genre: string | null;
  durationSeconds: number;
  format: SupportedFormat;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  lossless: boolean;
  coverArt: { data: Buffer; format: string } | null;
  rawTagsJson: string;
}

export class UnsupportedFormatError extends Error {}
export class CorruptFileError extends Error {}

/** "Artist - Title" (or just "Title") parsed from the bare filename, per the Appendix's yt-dlp-tolerance note. */
function filenameFallback(originalFilename: string): { artist: string; title: string } {
  const base = path.basename(originalFilename, path.extname(originalFilename));
  const dashSplit = base.split(/\s+-\s+/);
  if (dashSplit.length >= 2) {
    return { artist: dashSplit[0].trim(), title: dashSplit.slice(1).join(" - ").trim() };
  }
  return { artist: "Unknown Artist", title: base.trim() || "Untitled" };
}

function resolveFormat(originalFilename: string, container: string | undefined): SupportedFormat {
  const ext = path.extname(originalFilename).toLowerCase();
  const byExt = EXT_TO_FORMAT[ext];
  if (byExt) return byExt;

  const normalizedContainer = container?.toLowerCase() ?? "";
  const byContainer = (SUPPORTED_FORMATS as readonly string[]).find((f) => normalizedContainer.includes(f));
  if (byContainer) return byContainer as SupportedFormat;

  throw new UnsupportedFormatError(`Unsupported file type: ${ext || container || "unknown"}`);
}

export async function extractTags(stagedPath: string, originalFilename: string): Promise<ExtractedTags> {
  let metadata;
  try {
    metadata = await parseFile(stagedPath, { duration: true, skipCovers: false });
  } catch (err) {
    throw new CorruptFileError(err instanceof Error ? err.message : "Failed to read audio metadata");
  }

  const { common, format } = metadata;
  const resolvedFormat = resolveFormat(originalFilename, format.container);

  if (!format.duration || format.duration <= 0) {
    throw new CorruptFileError("File has no decodable audio duration");
  }

  const fallback = filenameFallback(originalFilename);
  const picture = common.picture?.[0];

  return {
    title: common.title?.trim() || fallback.title,
    artist: common.artist?.trim() || fallback.artist,
    albumArtist: common.albumartist?.trim() || null,
    album: common.album?.trim() || null,
    trackNumber: common.track?.no ?? null,
    trackTotal: common.track?.of ?? null,
    discNumber: common.disk?.no ?? null,
    discTotal: common.disk?.of ?? null,
    year: common.year ?? null,
    genre: common.genre?.length ? common.genre.join(", ") : null,
    durationSeconds: format.duration,
    format: resolvedFormat,
    codec: format.codec ?? null,
    bitrate: format.bitrate ? Math.round(format.bitrate) : null,
    sampleRate: format.sampleRate ?? null,
    bitDepth: format.bitsPerSample ?? null,
    channels: format.numberOfChannels ?? null,
    lossless: LOSSLESS_FORMATS.has(resolvedFormat),
    coverArt: picture ? { data: Buffer.from(picture.data), format: picture.format } : null,
    rawTagsJson: JSON.stringify(common),
  };
}
