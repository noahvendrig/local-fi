"use client";

import { withAuthQuery } from "@/lib/api/http";
import { usePlayerStore } from "@/lib/store/player";
import { WaveformScrubber } from "./WaveformScrubber";
import { IconButton } from "./IconButton";
import {
  AlbumPlaceholderIcon,
  CloseIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
} from "./PlayerIcons";

// Full-screen Now Playing overlay (ARCHITECTURE.md M5) — the one and only use of
// backdrop-filter in the app, per §9's semantic rule.
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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden px-6 pb-[88px]"
      style={{ backgroundColor: "var(--lf-glass, rgba(18,16,22,.87))", backdropFilter: "blur(48px) saturate(140%)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 15%, var(--lf-glow-a, rgba(138,92,240,.32)), transparent 70%)," +
            "radial-gradient(50% 40% at 85% 85%, var(--lf-glow-b, rgba(201,166,255,.18)), transparent 70%)",
        }}
      />

      <button
        type="button"
        onClick={closeNowPlaying}
        aria-label="Close Now Playing"
        className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-full text-t2 hover:bg-[var(--lf-tint)] hover:text-t1"
      >
        <CloseIcon />
      </button>

      <div className="relative flex w-full max-w-md flex-col items-center gap-6">
        <div className="h-72 w-72 max-w-full overflow-hidden rounded-2xl bg-surf-2 shadow-[var(--lf-shadow)]">
          {currentTrack.coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local-only images
            <img src={withAuthQuery(currentTrack.coverArtUrl)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
              <AlbumPlaceholderIcon />
            </div>
          )}
        </div>

        <div className="w-full text-center">
          <h1 className="truncate font-serif text-2xl text-t1" title={currentTrack.title ?? undefined}>
            {currentTrack.title ?? "Untitled"}
          </h1>
          <p className="mt-1 truncate text-sm text-t2">{currentTrack.artistName ?? "Unknown artist"}</p>
          {currentTrack.albumTitle && <p className="truncate text-xs text-t3">{currentTrack.albumTitle}</p>}
        </div>

        <div className="w-full">
          <WaveformScrubber
            waveform={waveform}
            currentTime={currentTime}
            duration={currentTrack.durationSeconds}
            onSeek={seekTo}
            disabled={false}
          />
        </div>

        <div className="flex items-center gap-3">
          <IconButton onClick={toggleShuffle} label="Shuffle" active={shuffle}>
            <ShuffleIcon />
          </IconButton>
          <IconButton onClick={playPrevious} label="Previous track" size="lg">
            <PreviousIcon />
          </IconButton>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-acc text-[var(--lf-on-acc)] hover:bg-acc-2"
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <IconButton onClick={playNext} label="Next track" size="lg">
            <NextIcon />
          </IconButton>
          <IconButton onClick={toggleRepeatMode} label="Repeat" active={repeatMode !== "off"}>
            {repeatMode === "one" ? <RepeatOneIcon /> : <RepeatIcon />}
          </IconButton>
        </div>

        <button
          type="button"
          onClick={toggleQueue}
          aria-pressed={isQueueOpen}
          className={`text-sm font-medium ${isQueueOpen ? "text-acc-text" : "text-t2"} hover:text-t1`}
        >
          Up Next
        </button>
      </div>
    </div>
  );
}
