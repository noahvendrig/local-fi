const FORMAT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  wav: "audio/wav",
  aac: "audio/aac",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  alac: "audio/mp4",
  aiff: "audio/aiff",
  webm: "audio/webm",
};

export function contentTypeForFormat(format: string): string {
  return FORMAT_TO_MIME[format.toLowerCase()] ?? "application/octet-stream";
}
