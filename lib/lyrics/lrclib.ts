// Server-side LRCLIB client (https://lrclib.net) — free, keyless lyrics lookup used for the Now
// Playing view's synced-lyrics panel. LRCLIB asks API consumers to identify themselves via
// User-Agent, hence the header below (see https://lrclib.net/docs).

export interface LyricLine {
  timeSeconds: number;
  text: string;
}

export interface LyricsResult {
  synced: LyricLine[] | null;
  plain: string | null;
}

interface LrclibTrack {
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

const USER_AGENT = "local-fi/1.0 (self-hosted music library manager; https://lrclib.net/docs)";
const LRCLIB_BASE = "https://lrclib.net/api";

async function lrclibGet(path: string, params: Record<string, string>): Promise<Response> {
  const url = `${LRCLIB_BASE}${path}?${new URLSearchParams(params).toString()}`;
  return fetch(url, { headers: { "User-Agent": USER_AGENT } });
}

/** Parses LRC-format timed lyrics (`[mm:ss.xx]text`, possibly several timestamps per line) into
 *  a flat, time-ascending list. Metadata tags (`[ar:...]`, `[ti:...]`, ...) don't match the
 *  timestamp shape and are dropped along with any line that carries no timestamp at all. */
function parseLrc(lrc: string): LyricLine[] {
  const tagPattern = /\[(\d{2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const lines: LyricLine[] = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    const tags = [...rawLine.matchAll(tagPattern)];
    if (tags.length === 0) continue;
    const text = rawLine.replace(tagPattern, "").trim();
    for (const tag of tags) {
      const minutes = Number(tag[1]);
      const seconds = Number(tag[2]);
      const fraction = tag[3] ? Number(tag[3].padEnd(3, "0")) / 1000 : 0;
      lines.push({ timeSeconds: minutes * 60 + seconds + fraction, text });
    }
  }

  return lines.sort((a, b) => a.timeSeconds - b.timeSeconds);
}

function toResult(track: LrclibTrack): LyricsResult | null {
  // An instrumental has nothing to display — treat it the same as "not found".
  if (track.instrumental) return null;
  const synced = track.syncedLyrics ? parseLrc(track.syncedLyrics) : null;
  const plain = track.plainLyrics ?? null;
  if (!synced && !plain) return null;
  return { synced, plain };
}

export interface LyricsLookupInput {
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number;
}

/** Looks up lyrics for one track. Tries LRCLIB's exact-match endpoint first (fast, requires the
 *  title/artist/duration to line up closely with LRCLIB's own record), then falls back to its
 *  fuzzy search and picks the closest duration match. Never throws — any network/parse failure
 *  or "nothing usable" outcome just resolves to null, which the caller renders as "not found". */
export async function fetchLyrics(track: LyricsLookupInput): Promise<LyricsResult | null> {
  const title = track.title.trim();
  const artist = track.artist.trim();
  if (!title || !artist) return null;

  try {
    const exactRes = await lrclibGet("/get", {
      track_name: title,
      artist_name: artist,
      ...(track.album ? { album_name: track.album } : {}),
      duration: String(Math.round(track.durationSeconds)),
    });
    if (exactRes.ok) {
      const exact = (await exactRes.json()) as LrclibTrack;
      return toResult(exact);
    }
    if (exactRes.status !== 404) {
      console.error(`[lyrics] LRCLIB /get failed (HTTP ${exactRes.status})`);
    }

    const searchRes = await lrclibGet("/search", { track_name: title, artist_name: artist });
    if (!searchRes.ok) {
      console.error(`[lyrics] LRCLIB /search failed (HTTP ${searchRes.status})`);
      return null;
    }
    const candidates = (await searchRes.json()) as LrclibTrack[];
    const withLyrics = candidates.filter((c) => !c.instrumental && (c.syncedLyrics || c.plainLyrics));
    if (withLyrics.length === 0) return null;

    // Closest duration wins; ties prefer a synced result over a plain-only one.
    withLyrics.sort((a, b) => {
      const durationDelta = Math.abs(a.duration - track.durationSeconds) - Math.abs(b.duration - track.durationSeconds);
      if (durationDelta !== 0) return durationDelta;
      return (b.syncedLyrics ? 1 : 0) - (a.syncedLyrics ? 1 : 0);
    });

    return toResult(withLyrics[0]);
  } catch (err) {
    console.error("[lyrics] LRCLIB lookup failed:", err);
    return null;
  }
}
