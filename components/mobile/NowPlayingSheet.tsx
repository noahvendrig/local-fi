"use client";

import { useState } from "react";
import { withAuthQuery } from "@/lib/api/http";
import { usePlayerStore } from "@/lib/store/player";
import { AlbumPlaceholderIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "@/components/shell/PlayerIcons";
import { WaveformScrubber } from "@/components/shell/WaveformScrubber";
import { EqSheet } from "./EqSheet";

// Full-screen mobile Now Playing (design board 1c, "m4 now playing" frame) — the mobile
// counterpart of NowPlayingOverlay.tsx, reusing the same store + WaveformScrubber rather
// than a second playback engine. hidden md:hidden on both surfaces means exactly one is
// ever painted for a given viewport width.
export function NowPlayingSheet() {
  const isOpen = usePlayerStore((s) => s.isNowPlayingOpen);
  const closeNowPlaying = usePlayerStore((s) => s.closeNowPlaying);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const waveform = usePlayerStore((s) => s.waveform);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const eqEnabled = usePlayerStore((s) => s.eqEnabled);
  const eqPreset = usePlayerStore((s) => s.eqPreset);
  const [eqOpen, setEqOpen] = useState(false);

  if (!isOpen || !currentTrack) return null;

  const eqSummary = eqEnabled ? (eqPreset === "custom" ? "Custom" : eqPreset) : "Off";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden md:hidden"
      style={{
        background:
          "radial-gradient(120% 60% at 30% 14%, var(--lf-glow-a), transparent 62%)," +
          "radial-gradient(90% 60% at 76% 82%, var(--lf-glow-b), transparent 60%)," +
          "var(--lf-glass)",
        backdropFilter: "blur(48px) saturate(140%)",
      }}
    >
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <button
          type="button"
          onClick={closeNowPlaying}
          aria-label="Collapse"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surf-2 text-t1"
        >
          ↓
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5">
        <div className="lf-hatch mx-auto my-5 aspect-square w-full max-w-[380px] shrink-0 overflow-hidden rounded-3xl shadow-[var(--lf-art-shadow-lg)]">
          {currentTrack.coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local-only images
            <img src={withAuthQuery(currentTrack.coverArtUrl)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
              <AlbumPlaceholderIcon />
            </div>
          )}
        </div>

        <h1 className="text-2xl font-medium leading-[1.2] text-t1" title={currentTrack.title ?? undefined}>
          {currentTrack.title ?? "Untitled"}
        </h1>
        <p className="mt-1.5 text-sm text-t2">
          {currentTrack.artistName ?? "Unknown artist"}
          {currentTrack.albumTitle ? ` · ${currentTrack.albumTitle}` : ""}
        </p>

        <div className="mt-6">
          <WaveformScrubber
            waveform={waveform}
            currentTime={currentTime}
            duration={currentTrack.durationSeconds}
            onSeek={seekTo}
            disabled={false}
          />
        </div>

        <div className="mt-6 flex items-center justify-center gap-7">
          <button type="button" onClick={playPrevious} aria-label="Previous track" className="text-t2">
            <PreviousIcon size={30} />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-acc bg-acc text-on-acc shadow-[0_10px_24px_rgba(20,15,10,.4)]"
          >
            {isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
          </button>
          <button type="button" onClick={playNext} aria-label="Next track" className="text-t2">
            <NextIcon size={30} />
          </button>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 py-5">
          <button
            type="button"
            onClick={toggleQueue}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surf-2 px-3 py-2 text-[11px] font-medium tracking-[0.04em] text-t1 uppercase"
          >
            ↑ Up next
          </button>
          <button
            type="button"
            onClick={() => setEqOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-acc px-3 py-2 text-[11px] font-medium tracking-[0.04em] text-acc-text uppercase"
          >
            EQ<span className="font-mono text-[10px] font-normal normal-case tracking-normal text-t2">{eqSummary}</span>
          </button>
        </div>
      </div>

      {eqOpen ? <EqSheet onClose={() => setEqOpen(false)} /> : null}
    </div>
  );
}
