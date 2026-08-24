"use client";

import { withAuthQuery } from "@/lib/api/http";
import { usePlayerStore } from "@/lib/store/player";
import { WaveformScrubber } from "./WaveformScrubber";
import { IconButton } from "./IconButton";
import {
  AlbumPlaceholderIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
} from "./PlayerIcons";

// Full-screen Now Playing overlay — the one and only use of backdrop-filter in the app.
export function NowPlayingOverlay() {
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
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const toggleRepeatMode = usePlayerStore((s) => s.toggleRepeatMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);

  if (!isOpen || !currentTrack) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 90% at 22% 12%, var(--lf-glow-a), transparent 60%)," +
          "radial-gradient(90% 80% at 82% 78%, var(--lf-glow-b), transparent 62%)," +
          "var(--lf-glass)",
        backdropFilter: "blur(48px) saturate(140%)",
        animation: "lfrise 220ms cubic-bezier(.22,1.3,.4,1)",
      }}
    >
      <div className="flex items-center px-8 py-5">
        <button
          type="button"
          onClick={closeNowPlaying}
          className="rounded-lg border border-line bg-surf-2 px-3 py-2 text-xs font-medium text-t1 hover:border-acc"
        >
          ↓ Collapse
        </button>
        <div className="flex-1" />
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-t2">
          {currentTrack.albumTitle ? `Playing from · ${currentTrack.albumTitle}` : "Now playing"}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center gap-14 px-16">
        <div className="lf-hatch h-[380px] w-[380px] max-w-full shrink-0 overflow-hidden rounded-3xl shadow-[var(--lf-art-shadow-lg)]">
          {currentTrack.coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local-only images
            <img src={withAuthQuery(currentTrack.coverArtUrl)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
              <AlbumPlaceholderIcon />
            </div>
          )}
        </div>

        <div className="w-full max-w-[520px]">
          <p className="mb-3.5 text-[11px] font-medium uppercase tracking-[0.04em] text-playing">Now playing</p>
          <h1 className="mb-3 font-serif text-[40px] font-medium leading-[1.1] text-t1" title={currentTrack.title ?? undefined}>
            {currentTrack.title ?? "Untitled"}
          </h1>
          <p className="mb-5 text-sm leading-[1.5] text-t2">
            {currentTrack.artistName ?? "Unknown artist"}
            {currentTrack.albumTitle ? ` · ${currentTrack.albumTitle}` : ""}
          </p>
          <p className="mb-7 flex gap-3.5 font-mono text-xs text-t3">
            <span className="text-ok">{currentTrack.format.toUpperCase()}</span>
          </p>

          <div className="mb-7">
            <WaveformScrubber
              waveform={waveform}
              currentTime={currentTime}
              duration={currentTrack.durationSeconds}
              onSeek={seekTo}
              disabled={false}
            />
          </div>

          <div className="flex items-center gap-5">
            <IconButton onClick={toggleShuffle} label="Shuffle" active={shuffle} size="xl">
              <ShuffleIcon size={36} />
            </IconButton>
            <IconButton onClick={playPrevious} label="Previous track" size="xl">
              <PreviousIcon size={40} />
            </IconButton>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-acc bg-acc text-on-acc shadow-[0_10px_26px_rgba(20,15,10,.4)] hover:bg-acc-2"
            >
              {isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
            </button>
            <IconButton onClick={playNext} label="Next track" size="xl">
              <NextIcon size={40} />
            </IconButton>
            <IconButton
              onClick={toggleRepeatMode}
              label={repeatMode === "one" ? "Repeat one" : repeatMode === "all" ? "Repeat all" : "Repeat"}
              active={repeatMode !== "off"}
              size="xl"
            >
              {repeatMode === "one" ? <RepeatOneIcon size={36} /> : <RepeatIcon size={36} />}
            </IconButton>
            <div className="flex-1" />
            <button
              type="button"
              onClick={toggleQueue}
              aria-pressed={isQueueOpen}
              className="rounded-lg border border-line bg-surf-2 px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-t1 hover:border-acc"
            >
              Up next ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
