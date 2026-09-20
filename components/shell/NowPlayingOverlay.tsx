"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { withAuthQuery } from "@/lib/api/http";
import { fetchLyrics } from "@/lib/api/lyricsClient";
import { usePlayerStore } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";
import { WaveformScrubber } from "./WaveformScrubber";
import { IconButton } from "./IconButton";
import { LyricsPanel } from "./LyricsPanel";
import {
  AlbumPlaceholderIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SmartShuffleIcon,
} from "./PlayerIcons";
import { UpNextList } from "./UpNextList";
import { VibeRadioPopover } from "./VibeRadioPopover";

// Must match the lyrics dock's h-56 below — used to check whether it would overlap the controls.
const LYRICS_DOCK_HEIGHT_PX = 224;
// Breathing room between the controls row and the dock's top edge before we call it a collision.
const LYRICS_DOCK_COLLISION_BUFFER_PX = 24;

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
  const closeQueue = usePlayerStore((s) => s.closeQueue);
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const toggleRepeatMode = usePlayerStore((s) => s.toggleRepeatMode);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleSmartShuffle = usePlayerStore((s) => s.toggleSmartShuffle);
  const smartShuffleAvailable = usePlayerStore(
    (s) => (s.sourceQueue.length > 0 ? s.sourceQueue : s.queue).filter((t) => t.similarityStatus === "ready").length >= 2
  );
  const nowPlayingBackdrop = useSettingsStore((s) => s.nowPlayingBackdrop);
  const vinylSpin = useSettingsStore((s) => s.vinylSpin);
  const showFormatBadges = useSettingsStore((s) => s.showFormatBadges);
  const lyricsLines = useSettingsStore((s) => s.lyricsLines);

  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  // Where the lyrics panel docks: "bottom" is the default; falls back to "right" (like the Queue
  // drawer) when the controls row sits too close to the screen's bottom edge for the dock to fit
  // without covering them — short/laptop viewports, mostly, since the xl row layout's art shrinks
  // with viewport height but the stacked (sub-xl) layout doesn't.
  const [lyricsDockSide, setLyricsDockSide] = useState<"bottom" | "right">("bottom");
  const controlsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    function measure() {
      const el = controlsRef.current;
      if (!el) return;
      const controlsBottom = el.getBoundingClientRect().bottom;
      const dockTop = window.innerHeight - LYRICS_DOCK_HEIGHT_PX;
      setLyricsDockSide(controlsBottom + LYRICS_DOCK_COLLISION_BUFFER_PX > dockTop ? "right" : "bottom");
    }
    measure();
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    if (controlsRef.current) observer.observe(controlsRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [isOpen]);

  // Only queried while this view is open (not on every track change app-wide) — the panel itself
  // needn't be open yet, so the Lyrics button can grey out the moment availability is known rather
  // than only after the user clicks it.
  const { data: lyricsData, isLoading: lyricsLoading } = useQuery({
    queryKey: ["lyrics", currentTrack?.id],
    queryFn: () => fetchLyrics(currentTrack!.id),
    enabled: isOpen && currentTrack != null,
    staleTime: Infinity,
  });
  // Enabled (not greyed) by default until a definitive "not found" comes back — avoids a flash of
  // disabled state while the lookup is still in flight.
  const lyricsUnavailable = lyricsData?.found === false;

  if (!isOpen || !currentTrack) return null;

  const isGlass = nowPlayingBackdrop === "glass";

  function handleToggleQueue() {
    setIsLyricsOpen(false);
    toggleQueue();
  }

  function handleToggleLyrics() {
    if (isLyricsOpen) {
      setIsLyricsOpen(false);
      return;
    }
    closeQueue();
    setIsLyricsOpen(true);
  }

  function handleCloseLyrics() {
    setIsLyricsOpen(false);
  }

  const lyricsInSidePanel = isLyricsOpen && lyricsDockSide === "right";
  const lyricsInBottomDock = isLyricsOpen && lyricsDockSide === "bottom";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      className="fixed inset-0 z-50 hidden flex-col overflow-hidden md:flex"
      style={
        isGlass
          ? {
              background:
                "radial-gradient(120% 90% at 22% 12%, var(--lf-glow-a), transparent 60%)," +
                "radial-gradient(90% 80% at 82% 78%, var(--lf-glow-b), transparent 62%)," +
                "var(--lf-glass)",
              backdropFilter: "blur(48px) saturate(140%)",
              animation: "lfrise 220ms cubic-bezier(.22,1.3,.4,1)",
            }
          : {
              background: "var(--lf-bg)",
              animation: "lfrise 220ms cubic-bezier(.22,1.3,.4,1)",
            }
      }
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

      {/* Column when narrow (art stacks above meta); row when wide. Art flexes into leftover
          space so meta + controls stay on-screen without scrolling. */}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-hidden px-8 py-2 xl:flex-row xl:items-center xl:justify-center xl:gap-14 xl:px-16 xl:py-4">
        <div
          className="flex min-h-0 w-full max-w-[520px] flex-1 items-center justify-center xl:h-[min(380px,70dvh)] xl:w-[min(380px,70dvh)] xl:max-w-none xl:flex-none"
          style={{ containerType: "size" }}
        >
          <div
            className={`lf-hatch relative z-20 overflow-hidden shadow-[var(--lf-art-shadow-lg)] ${
              vinylSpin ? "rounded-full" : "rounded-3xl"
            }`}
            style={{ width: "min(380px, 100cqmin)", height: "min(380px, 100cqmin)" }}
          >
            {currentTrack.coverArtUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local-only images
              <img
                src={withAuthQuery(currentTrack.coverArtUrl)}
                alt=""
                className={`h-full w-full object-cover ${vinylSpin ? "lf-vinyl-spin" : ""} ${vinylSpin && !isPlaying ? "is-paused" : ""}`}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
                <AlbumPlaceholderIcon />
              </div>
            )}
            {vinylSpin ? (
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 h-[12%] w-[12%] min-h-4 min-w-4 max-h-9 max-w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-bg shadow-[var(--lf-art-shadow)]"
                aria-hidden
              />
            ) : null}
          </div>
        </div>

        <div ref={controlsRef} className="relative z-20 w-full max-w-[520px] shrink-0 pt-5 xl:pt-0">
          <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-playing xl:mb-3.5">Now playing</p>
          <h1
            className="mb-2 font-serif text-[clamp(1.75rem,3.5vw,2.5rem)] font-medium leading-[1.1] text-t1 xl:mb-3"
            title={currentTrack.title ?? undefined}
          >
            {currentTrack.title ?? "Untitled"}
          </h1>
          <p className="mb-3 text-sm leading-[1.5] text-t2 xl:mb-5">
            {currentTrack.artistId ? (
              <Link href={`/artists/${currentTrack.artistId}`} className="hover:text-acc-text">
                {currentTrack.artistName ?? "Unknown artist"}
              </Link>
            ) : (
              (currentTrack.artistName ?? "Unknown artist")
            )}
            {currentTrack.albumTitle ? ` · ${currentTrack.albumTitle}` : ""}
          </p>
          {showFormatBadges ? (
            <p className="mb-4 flex gap-3.5 font-mono text-xs text-t3 xl:mb-7">
              <span className="text-ok">{currentTrack.format.toUpperCase()}</span>
            </p>
          ) : (
            <div className="mb-4 xl:mb-7" />
          )}

          <div className="mb-4 xl:mb-7">
            <WaveformScrubber
              waveform={waveform}
              currentTime={currentTime}
              duration={currentTrack.durationSeconds}
              onSeek={seekTo}
              disabled={false}
            />
          </div>

          <div className="flex items-center gap-5">
            <IconButton onClick={toggleShuffle} label="Shuffle" active={shuffleMode === "random"} size="xl">
              <ShuffleIcon size={36} />
            </IconButton>
            <IconButton
              onClick={toggleSmartShuffle}
              label="Smart Shuffle"
              active={shuffleMode === "smart"}
              size="xl"
              disabled={!smartShuffleAvailable}
            >
              <SmartShuffleIcon size={36} />
            </IconButton>
            <VibeRadioPopover size="xl" />
            <IconButton onClick={playPrevious} label="Previous track" size="xl">
              <PreviousIcon size={40} />
            </IconButton>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full border border-acc bg-acc text-on-acc shadow-[0_10px_26px_rgba(20,15,10,.4)] hover:bg-acc-2"
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
              onClick={handleToggleLyrics}
              aria-pressed={isLyricsOpen}
              disabled={lyricsUnavailable}
              className={`rounded-lg px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.04em] ${
                lyricsUnavailable
                  ? "cursor-default border border-line bg-surf-2 text-t3 opacity-40"
                  : isLyricsOpen
                    ? "border border-acc bg-surf-2 text-acc-text"
                    : "border border-line bg-surf-2 text-t1 hover:border-acc"
              }`}
            >
              Lyrics
            </button>
            <button
              type="button"
              onClick={handleToggleQueue}
              aria-pressed={isQueueOpen}
              className={`rounded-lg px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.04em] ${
                isQueueOpen
                  ? "border border-acc bg-surf-2 text-acc-text"
                  : "border border-line bg-surf-2 text-t1 hover:border-acc"
              }`}
            >
              Up next
            </button>
          </div>
        </div>
      </div>

      <aside
        aria-hidden={!isQueueOpen && !lyricsInSidePanel}
        className={`absolute inset-y-0 right-0 z-30 flex w-[360px] flex-col border-l border-line bg-surf/90 transition-transform duration-200 ${
          isQueueOpen || lyricsInSidePanel ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-4">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-t1">{lyricsInSidePanel ? "Lyrics" : "Queue"}</span>
          <button
            type="button"
            onClick={lyricsInSidePanel ? handleCloseLyrics : closeQueue}
            aria-label={lyricsInSidePanel ? "Close lyrics" : "Close queue"}
            className="flex h-6 w-6 items-center justify-center rounded-md text-t3 hover:bg-surf-2 hover:text-t1"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {lyricsInSidePanel ? (
            <LyricsPanel data={lyricsData} isLoading={lyricsLoading} linesVisible={lyricsLines} active={lyricsInSidePanel} />
          ) : (
            <UpNextList />
          )}
        </div>
      </aside>

      {/* Slides up from the screen edge, z-indexed under the header/controls above (z-20) so it
          reads as tucked behind the player rather than covering it. Sized for ~4-5 lyric lines.
          Falls back to the right-side panel above (lyricsInSidePanel) on viewports too short to
          fit it without covering the controls row.
          No backdrop-blur here (unlike the header's glass backdrop) — nesting backdrop-filter
          inside a transformed, overflow-hidden ancestor is a known compositor trap where the
          closed (translated-away) panel can flash back into view on the next repaint (e.g. from
          scrolling elsewhere on the page). Matches the Queue aside, which is plain for the same
          reason. */}
      <div
        aria-hidden={!lyricsInBottomDock}
        className={`absolute inset-x-0 bottom-0 z-10 flex h-56 flex-col border-t border-line bg-surf/95 transition-transform duration-200 ${
          lyricsInBottomDock ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-t1">Lyrics</span>
          <button
            type="button"
            onClick={handleCloseLyrics}
            aria-label="Close lyrics"
            className="flex h-6 w-6 items-center justify-center rounded-md text-t3 hover:bg-surf-2 hover:text-t1"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LyricsPanel data={lyricsData} isLoading={lyricsLoading} linesVisible={lyricsLines} active={lyricsInBottomDock} />
        </div>
      </div>
    </div>
  );
}
