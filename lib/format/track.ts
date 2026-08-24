export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "16/44.1" for lossless (bit depth/sample rate), "320 kbps" for lossy — the two things listeners actually care about. */
export function formatRate(track: {
  lossless: boolean;
  bitDepth: number | null;
  sampleRate: number | null;
  bitrate: number | null;
}): string {
  if (track.lossless && track.bitDepth && track.sampleRate) {
    return `${track.bitDepth}/${(track.sampleRate / 1000).toFixed(1)}`;
  }
  if (track.bitrate) return `${Math.round(track.bitrate / 1000)} kbps`;
  return "—";
}
