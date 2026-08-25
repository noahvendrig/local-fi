/** Server-side counterpart of lib/ingest/collectFiles.ts's client-side filter — same supported set (ARCHITECTURE.md §3.1). */
export const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".wav",
  ".aac",
  ".m4a",
  ".ogg",
  ".oga",
  ".opus",
  ".aif",
  ".aiff",
  ".webm",
]);

export function isAudioFilePath(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return AUDIO_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}
