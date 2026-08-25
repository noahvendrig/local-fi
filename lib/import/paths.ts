import path from "node:path";
import { getDataDir } from "../storage/dataDir";

/** 2-char shard prefix so no single directory ends up with tens of thousands of siblings (ARCHITECTURE.md §2). */
export function shardOf(uuid: string): string {
  return uuid.slice(0, 2);
}

export function stagingDirFor(jobUuid: string): string {
  return path.join(getDataDir(), "staging", jobUuid);
}

export function originalsDirFor(trackUuid: string): string {
  return path.join(getDataDir(), "originals", shardOf(trackUuid), trackUuid);
}

export function waveformPathFor(trackUuid: string): string {
  return path.join(getDataDir(), "waveforms", shardOf(trackUuid), `${trackUuid}.lfpk`);
}

export function artworkPathFor(trackUuid: string, ext: string): string {
  return path.join(getDataDir(), "artwork", shardOf(trackUuid), `${trackUuid}.${ext}`);
}

/** Soft-deleted audio lives at trash/<uuid>/<original-filename> (ARCHITECTURE.md §2). */
export function trashDirFor(trackUuid: string): string {
  return path.join(getDataDir(), "trash", trackUuid);
}

/** Strips path separators and other filesystem-hostile characters from a user-supplied filename. */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\]/g, "_").trim();
  return base.length > 0 ? base : "untitled";
}

/** Path stored on the `tracks`/`albums` row, relative to LOCALFI_DATA_DIR — never an absolute path. */
export function toDataDirRelative(absolutePath: string): string {
  return path.relative(getDataDir(), absolutePath).split(path.sep).join("/");
}
