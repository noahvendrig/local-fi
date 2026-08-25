/** Formats TagLib can embed a front-cover picture into. Raw AAC ADTS and WebM cannot. */
export const EMBEDDED_COVER_FORMATS = ["mp3", "flac", "m4a", "alac", "ogg", "wav", "aiff"] as const;

export function formatSupportsEmbeddedPictures(format: string): boolean {
  return (EMBEDDED_COVER_FORMATS as readonly string[]).includes(format);
}
