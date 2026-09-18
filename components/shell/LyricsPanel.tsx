"use client";

import { useEffect, useMemo, useRef } from "react";
import type { LyricLine, LyricsResponse } from "@/lib/api/lyricsClient";
import { usePlayerStore } from "@/lib/store/player";

/** Index of the last line whose timestamp has passed, or -1 before the first line. Binary search
 *  since this re-runs on every currentTime tick while the panel is open. */
function activeLineIndex(lines: LyricLine[], currentTime: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeSeconds <= currentTime) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

// Body of the Now Playing overlay's Lyrics side panel (see NowPlayingOverlay.tsx) — synced lyrics
// scroll and highlight against playback position, clicking a line seeks to it; plain-only lyrics
// (LRCLIB has some tracks without timing data) render as a static block instead.
export function LyricsPanel({ data, isLoading }: { data: LyricsResponse | undefined; isLoading: boolean }) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  const synced = data?.found ? data.synced : null;
  const plain = data?.found ? data.plain : null;
  const activeIndex = useMemo(() => (synced ? activeLineIndex(synced, currentTime) : -1), [synced, currentTime]);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  if (isLoading) {
    return <p className="px-5 py-3 text-sm text-t3">Loading lyrics…</p>;
  }

  if (!data?.found) {
    return <p className="px-5 py-3 text-sm text-t3">No lyrics found for this track.</p>;
  }

  if (synced && synced.length > 0) {
    return (
      <ul className="px-3 py-2">
        {synced.map((line, i) => (
          <li key={`${line.timeSeconds}-${i}`}>
            <button
              type="button"
              ref={i === activeIndex ? activeLineRef : undefined}
              onClick={() => seekTo(line.timeSeconds)}
              className={`w-full rounded-lg px-2 py-1.5 text-left text-sm leading-snug transition-colors ${
                i === activeIndex ? "font-medium text-acc-text" : "text-t3 hover:bg-surf-2 hover:text-t1"
              }`}
            >
              {line.text || " "}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return <p className="whitespace-pre-line px-5 py-3 text-sm leading-relaxed text-t2">{plain}</p>;
}
