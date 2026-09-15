export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/** Relative time up through weeks, then falls back to a calendar date past that. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = Date.now() - date.getTime();
  const calendar = () => date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  if (diffMs < 0) return calendar();
  if (diffMs < MINUTE) return plural(Math.floor(diffMs / SECOND), "second");
  if (diffMs < HOUR) return plural(Math.floor(diffMs / MINUTE), "minute");
  if (diffMs < DAY) return plural(Math.floor(diffMs / HOUR), "hour");
  if (diffMs < WEEK) return plural(Math.floor(diffMs / DAY), "day");
  if (diffMs < 4 * WEEK) return plural(Math.floor(diffMs / WEEK), "week");
  return calendar();
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
