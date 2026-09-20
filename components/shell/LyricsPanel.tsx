"use client";

import { useEffect, useMemo, useRef } from "react";
import type { LyricLine, LyricsResponse } from "@/lib/api/lyricsClient";
import { usePlayerStore } from "@/lib/store/player";

// Per-line font size / line height / vertical padding (px) so the dock's fixed content height
// (~184px — the h-56 dock minus its header) always holds exactly `linesVisible` lines: fewer
// lines means each one gets more of that fixed space, i.e. bigger text.
const LINE_METRICS: Record<number, { fontSize: number; lineHeight: number; paddingBlock: number }> = {
  3: { fontSize: 24, lineHeight: 34, paddingBlock: 12 },
  4: { fontSize: 19, lineHeight: 27, paddingBlock: 9 },
  5: { fontSize: 14, lineHeight: 20, paddingBlock: 6 },
  6: { fontSize: 13, lineHeight: 18, paddingBlock: 4 },
  7: { fontSize: 12, lineHeight: 16, paddingBlock: 3 },
};

function lineMetrics(linesVisible: number) {
  return LINE_METRICS[linesVisible] ?? LINE_METRICS[5];
}

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

// Body of the Now Playing overlay's Lyrics bottom panel (see NowPlayingOverlay.tsx) — synced lyrics
// scroll and highlight against playback position, clicking a line seeks to it; plain-only lyrics
// (LRCLIB has some tracks without timing data) render as a static block instead.
export function LyricsPanel({
  data,
  isLoading,
  linesVisible = 5,
  active,
}: {
  data: LyricsResponse | undefined;
  isLoading: boolean;
  linesVisible?: number;
  /** Whether the dock is actually open — gates the auto-scroll effect so it doesn't keep nudging
   *  the (translated off-screen) scroll container while the panel is closed. */
  active: boolean;
}) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  const synced = data?.found ? data.synced : null;
  const plain = data?.found ? data.plain : null;
  const activeIndex = useMemo(() => (synced ? activeLineIndex(synced, currentTime) : -1), [synced, currentTime]);
  const metrics = lineMetrics(linesVisible);

  useEffect(() => {
    if (!active) return;
    activeLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, activeIndex]);

  if (isLoading) {
    return <p className="px-5 py-3 text-center text-sm text-t3">Loading lyrics…</p>;
  }

  if (!data?.found) {
    return <p className="px-5 py-3 text-center text-sm text-t3">No lyrics found for this track.</p>;
  }

  if (synced && synced.length > 0) {
    return (
      <ul className="mx-auto max-w-2xl px-3 py-2 text-center">
        {synced.map((line, i) => (
          <li key={`${line.timeSeconds}-${i}`}>
            <button
              type="button"
              ref={i === activeIndex ? activeLineRef : undefined}
              onClick={() => seekTo(line.timeSeconds)}
              style={{ fontSize: metrics.fontSize, lineHeight: `${metrics.lineHeight}px`, paddingBlock: metrics.paddingBlock }}
              className={`w-full rounded-lg px-2 text-center transition-colors ${
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

  return <p className="mx-auto max-w-2xl whitespace-pre-line px-5 py-3 text-center text-sm leading-relaxed text-t2">{plain}</p>;
}
