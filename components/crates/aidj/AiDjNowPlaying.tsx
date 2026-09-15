"use client";

import { useEffect, useState } from "react";
import type { PlaylistTrackItem } from "@/lib/api/playlistsClient";
import { getPlaybackEqualizer } from "@/lib/audio/equalizer";
import { useAiDjStore } from "@/lib/store/aiDj";
import { CamelotKeyBadge } from "../dj/CamelotKeyBadge";
import { PrepStatusBadge } from "./PrepStatusBadge";

function TrackLine({ track, label }: { track: PlaylistTrackItem; label: string }) {
  const prepStatus = useAiDjStore((s) => s.prepStatus[track.id]);
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-t3">{label}</span>
        <PrepStatusBadge status={prepStatus} />
      </div>
      <div className="truncate text-[15px] font-medium text-t1">{track.title ?? "Untitled"}</div>
      <div className="flex items-center gap-2 truncate font-mono text-[11px] text-t3">
        <span className="truncate">{track.artistName}</span>
        {track.bpm != null && <span>· {track.bpm} bpm</span>}
        {track.key && <CamelotKeyBadge camelotKey={track.key} />}
      </div>
    </div>
  );
}

/** Live transition-progress bar between the current and next track, driven by AudioContext time
 *  (not a plain interval) so it can never drift from what's actually audible. */
function TransitionProgress() {
  const transition = useAiDjStore((s) => s.transition);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!transition) return;
    let raf: number;
    const tick = () => {
      const ctx = getPlaybackEqualizer().ensureAudioContext();
      const now = ctx?.currentTime ?? transition.startContextTime;
      const elapsed = now - transition.startContextTime;
      setPct(Math.max(0, Math.min(100, (elapsed / transition.totalDurationSec) * 100)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transition]);

  if (!transition) return null;

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-t3">
        <span>{transition.kind === "mashup" ? "mashing transition…" : "crossfading…"}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-sm bg-surf-2">
        <div className="h-full rounded-sm bg-acc transition-[width] duration-75" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function AiDjNowPlaying() {
  const order = useAiDjStore((s) => s.order);
  const currentIndex = useAiDjStore((s) => s.currentIndex);
  const error = useAiDjStore((s) => s.error);
  const current = order[currentIndex];
  const next = order[currentIndex + 1];

  if (!current) return null;

  return (
    <div className="mx-8 mb-6 rounded-xl border border-line bg-surf px-5 py-4">
      <div className="flex items-center gap-6">
        <TrackLine track={current} label="Now playing" />
        {next && (
          <>
            <div className="h-10 w-px flex-none bg-line" />
            <TrackLine track={next} label="Up next" />
          </>
        )}
      </div>
      <TransitionProgress />
      {error && <p className="mt-2 text-[11px] text-err">{error}</p>}
    </div>
  );
}
