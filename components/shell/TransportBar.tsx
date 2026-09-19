"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { withAuthQuery } from "@/lib/api/http";
import { mixtapeWaveformUrl } from "@/lib/api/mixtapesClient";
import { pauseAiDjPlayback, resumeAiDjPlayback } from "@/components/crates/aidj/useAiDjEngine";
import { getPlaybackEqualizer } from "@/lib/audio/equalizer";
import { resolveWaveform } from "@/lib/offline/playback";
import { usePlayerStore } from "@/lib/store/player";
import { useAiDjStore, type AiDjRuntimeAnchor } from "@/lib/store/aiDj";
import { useDjStore } from "@/lib/store/dj";
import { useMixtapePlayerStore } from "@/lib/store/mixtapePlayer";
import { useTransportSourceStore } from "@/lib/store/transportSource";
import { useSettingsStore } from "@/lib/store/settings";
import { fetchWaveform } from "@/lib/waveform/parse";
import { WaveformScrubber } from "./WaveformScrubber";
import { EqualizerPopover } from "./EqualizerPopover";
import { HoverTip, IconButton } from "./IconButton";
import { usePlaybackEngine } from "./usePlaybackEngine";
import { useSmartShuffle } from "./useSmartShuffle";
import { useVibeRadio } from "./useVibeRadio";
import { VibeRadioPopover } from "./VibeRadioPopover";
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

/** AI DJ plays through Web Audio buffer sources, not an <audio> element, so it has no native
 *  timeupdate event — this derives a live position from the shared AudioContext clock against
 *  whatever anchor the engine last published (see useAiDjStore's runtimeAnchor), the same way
 *  AiDjNowPlaying's TransitionProgress derives its bar. Naturally holds steady while paused, since
 *  a suspended AudioContext's currentTime stops advancing on its own. */
function useAiDjLiveCurrentTime(anchor: AiDjRuntimeAnchor | null): number {
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (!anchor) return;
    let raf: number;
    const tick = () => {
      const ctx = getPlaybackEqualizer().ensureAudioContext();
      const now = ctx?.currentTime ?? anchor.anchorContextTime;
      setTime(Math.max(0, anchor.anchorPosition + (now - anchor.anchorContextTime) * anchor.tempoRatio));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchor]);
  return time;
}

// Persistent 88px transport bar, mounted once in the root layout so it survives
// route navigation (ARCHITECTURE.md M4/M5). Owns the dual <audio> decks — every
// other surface (Now Playing overlay, Queue drawer) reads/drives playback through the store.
export function TransportBar() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const toggleRepeatMode = usePlayerStore((s) => s.toggleRepeatMode);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleSmartShuffle = usePlayerStore((s) => s.toggleSmartShuffle);
  const smartShuffleAvailable = usePlayerStore(
    (s) => (s.sourceQueue.length > 0 ? s.sourceQueue : s.queue).filter((t) => t.similarityStatus === "ready").length >= 2
  );
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const waveform = usePlayerStore((s) => s.waveform);
  const setWaveform = usePlayerStore((s) => s.setWaveform);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const openNowPlaying = usePlayerStore((s) => s.openNowPlaying);
  const sleepEndsAt = usePlayerStore((s) => s.sleepEndsAt);
  const sleepAfterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const sleepMinutes = usePlayerStore((s) => s.sleepMinutes);
  const clearSleepTimer = usePlayerStore((s) => s.clearSleepTimer);
  const showFormatBadges = useSettingsStore((s) => s.showFormatBadges);

  const djTrack = useDjStore((s) => s.currentTrack);
  const djIsPlaying = useDjStore((s) => s.isPlaying);
  const djCurrentTime = useDjStore((s) => s.currentTime);
  const setDjPlaying = useDjStore((s) => s.setDjPlaying);
  const djSeekTo = useDjStore((s) => s.seekTo);
  const activeSource = useTransportSourceStore((s) => s.activeSource);

  const mixtapeNowPlaying = useMixtapePlayerStore((s) => s.currentMixtape);
  const mixtapeIsPlaying = useMixtapePlayerStore((s) => s.isPlaying);
  const mixtapeCurrentTime = useMixtapePlayerStore((s) => s.currentTime);
  const setMixtapePlaying = useMixtapePlayerStore((s) => s.setMixtapePlaying);
  const mixtapeSeekTo = useMixtapePlayerStore((s) => s.seekTo);
  const mixtapeWaveform = useMixtapePlayerStore((s) => s.waveform);
  const setMixtapeWaveform = useMixtapePlayerStore((s) => s.setWaveform);

  const aiDjOrder = useAiDjStore((s) => s.order);
  const aiDjCurrentIndex = useAiDjStore((s) => s.currentIndex);
  const aiDjSessionId = useAiDjStore((s) => s.sessionId);
  const aiDjIsPlaying = useAiDjStore((s) => s.isPlaying);
  const aiDjRuntimeAnchor = useAiDjStore((s) => s.runtimeAnchor);
  const aiDjActiveLoopRegion = useAiDjStore((s) => s.activeLoopRegion);
  const aiDjTrack = aiDjOrder[aiDjCurrentIndex] ?? null;
  const aiDjCurrentTime = useAiDjLiveCurrentTime(aiDjRuntimeAnchor);

  const { audioARef, audioBRef, handleTimeUpdate, handleEnded, handlePlay, handlePause } = usePlaybackEngine();
  useSmartShuffle();
  useVibeRadio();

  // Which deck the bar shows/controls is tracked explicitly (useTransportSourceStore), set by
  // whichever store's track-selection actions last ran — NOT derived from isPlaying, so pausing
  // the DJ deck from this bar can't make it silently fall back to a leftover regular track.
  const djActive = activeSource === "dj" && djTrack != null;
  const mixtapeActive = activeSource === "mixtape" && mixtapeNowPlaying != null;
  const aiDjActive = activeSource === "aidj" && aiDjSessionId != null && aiDjTrack != null;
  const displayTrack = aiDjActive ? aiDjTrack : djActive ? djTrack : currentTrack;
  const displayIsPlaying = aiDjActive ? aiDjIsPlaying : djActive ? djIsPlaying : isPlaying;
  const displayCurrentTime = aiDjActive ? aiDjCurrentTime : djActive ? djCurrentTime : currentTime;
  const displayTogglePlay = aiDjActive
    ? () => (aiDjIsPlaying ? pauseAiDjPlayback() : resumeAiDjPlayback())
    : djActive
      ? () => setDjPlaying(!djIsPlaying)
      : togglePlay;
  const displaySeek = aiDjActive ? () => {} : djActive ? djSeekTo : seekTo;
  const duration = displayTrack?.durationSeconds ?? 0;
  // Only meaningful while the track it was planned for is still the one displayed — a stale
  // region for a track that's since been skipped past would otherwise briefly flash.
  const displayLoopRegion = aiDjActive && aiDjActiveLoopRegion?.trackId === displayTrack?.id ? aiDjActiveLoopRegion : null;
  // Prev/next/shuffle/repeat and scrubbing aren't supported for a live AI DJ session (same
  // treatment as the DJ deck) — its transport is start/skip/pause only, driven from the AI DJ page.
  const transportLocked = djActive || aiDjActive;

  useEffect(() => {
    setMixtapeWaveform(null);
    if (!mixtapeNowPlaying) return;
    let cancelled = false;
    fetchWaveform(mixtapeWaveformUrl(mixtapeNowPlaying.id))
      .then((data) => {
        if (!cancelled) setMixtapeWaveform(data);
      })
      .catch(() => {
        if (!cancelled) setMixtapeWaveform(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setMixtapeWaveform is a stable store action
  }, [mixtapeNowPlaying?.id]);

  // Fetch the displayed track's peak sidecar whenever it changes (currentTime itself is
  // reset to 0 by the store action that changed the track, not here — see lib/store/player.ts).
  useEffect(() => {
    setWaveform(null);
    if (!displayTrack) return;
    let cancelled = false;
    resolveWaveform(displayTrack)
      .then((data) => {
        if (!cancelled) setWaveform(data);
      })
      .catch(() => {
        if (!cancelled) setWaveform(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setWaveform is a stable store action
  }, [displayTrack?.id]);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 hidden h-[88px] items-center gap-6 overflow-visible border-t border-line bg-surf px-6 shadow-[var(--lf-transport-shadow)] md:flex">
      <audio
        ref={audioARef}
        crossOrigin="anonymous"
        preload="auto"
        onTimeUpdate={(e) => handleTimeUpdate(0, e.currentTarget)}
        onEnded={() => handleEnded(0)}
        onPlay={() => handlePlay(0)}
        onPause={() => handlePause(0)}
      />
      <audio
        ref={audioBRef}
        crossOrigin="anonymous"
        preload="auto"
        onTimeUpdate={(e) => handleTimeUpdate(1, e.currentTarget)}
        onEnded={() => handleEnded(1)}
        onPlay={() => handlePlay(1)}
        onPause={() => handlePause(1)}
      />

      {mixtapeActive && mixtapeNowPlaying ? (
        <>
          <div
            className="group relative flex w-[250px] shrink-0 cursor-default items-center gap-3 text-left"
            aria-label="Now Playing"
          >
            <div className="lf-hatch h-14 w-14 shrink-0 overflow-hidden rounded-xl shadow-[var(--lf-art-shadow)]">
              <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
                <AlbumPlaceholderIcon />
              </div>
            </div>
            <div className="min-w-0">
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.06em] text-acc-text">Mixtape</p>
              <p
                className={`truncate text-sm ${mixtapeIsPlaying ? "text-playing" : "text-t1"}`}
                title={mixtapeNowPlaying.title}
              >
                {mixtapeNowPlaying.title}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton onClick={playPrevious} label="Previous" size="lg" disabled>
              <PreviousIcon size={26} />
            </IconButton>
            <button
              type="button"
              onClick={() => setMixtapePlaying(!mixtapeIsPlaying)}
              aria-label={mixtapeIsPlaying ? "Pause" : "Play"}
              className="lf-top group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-acc bg-acc text-on-acc hover:border-acc-2 hover:bg-acc-2"
            >
              {mixtapeIsPlaying ? <PauseIcon size={20} /> : <PlayIcon size={26} />}
              <HoverTip text={mixtapeIsPlaying ? "Pause" : "Play"} />
            </button>
            <IconButton onClick={playNext} label="Next" size="lg" disabled>
              <NextIcon size={26} />
            </IconButton>
          </div>

          <WaveformScrubber
            waveform={mixtapeWaveform}
            currentTime={mixtapeCurrentTime}
            duration={mixtapeNowPlaying.durationSeconds}
            onSeek={mixtapeSeekTo}
            disabled={false}
            preferBarWhenNarrow
          />

          <div className="flex shrink-0 items-center gap-1.5">
            {showFormatBadges ? (
              <span className="hidden font-mono text-[11px] text-ok xl:inline">{mixtapeNowPlaying.format.toUpperCase()}</span>
            ) : null}
          </div>
        </>
      ) : displayTrack ? (
        <>
          <div
            role="button"
            tabIndex={0}
            onClick={() => !transportLocked && openNowPlaying()}
            onKeyDown={(e) => {
              if (!transportLocked && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                openNowPlaying();
              }
            }}
            className={`group relative flex w-[250px] shrink-0 items-center gap-3 text-left ${transportLocked ? "cursor-default" : "cursor-pointer"}`}
            aria-label="Now Playing"
          >
            {!transportLocked && <HoverTip text="Now Playing" />}
            <div className="lf-hatch h-14 w-14 shrink-0 overflow-hidden rounded-xl shadow-[var(--lf-art-shadow)]">
              {displayTrack.coverArtUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local-only images
                <img src={withAuthQuery(displayTrack.coverArtUrl)} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
                  <AlbumPlaceholderIcon />
                </div>
              )}
            </div>
            <div className="min-w-0">
              {transportLocked && (
                <p className="truncate font-mono text-[10px] uppercase tracking-[0.06em] text-acc-text">{aiDjActive ? "AI DJ" : "DJ deck"}</p>
              )}
              <p
                className={`truncate text-sm ${displayIsPlaying ? "text-playing" : "text-t1"}`}
                title={displayTrack.title ?? undefined}
              >
                {displayTrack.title ?? "Untitled"}
              </p>
              {displayTrack.artistId ? (
                <Link
                  href={`/artists/${displayTrack.artistId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-block max-w-full truncate font-mono text-xs text-t3 hover:text-acc-text"
                  title={displayTrack.artistName ?? undefined}
                >
                  {displayTrack.artistName ?? "Unknown artist"}
                </Link>
              ) : (
                <p className="truncate font-mono text-xs text-t3" title={displayTrack.artistName ?? undefined}>
                  {displayTrack.artistName ?? "Unknown artist"}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton onClick={playPrevious} label="Previous" size="lg" disabled={transportLocked}>
              <PreviousIcon size={26} />
            </IconButton>
            <button
              type="button"
              onClick={displayTogglePlay}
              aria-label={displayIsPlaying ? "Pause" : "Play"}
              className="lf-top group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-acc bg-acc text-on-acc hover:border-acc-2 hover:bg-acc-2"
            >
              {displayIsPlaying ? <PauseIcon size={20} /> : <PlayIcon size={26} />}
              <HoverTip text={displayIsPlaying ? "Pause" : "Play"} />
            </button>
            <IconButton onClick={playNext} label="Next" size="lg" disabled={transportLocked}>
              <NextIcon size={26} />
            </IconButton>
          </div>

          <WaveformScrubber
            waveform={waveform}
            currentTime={displayCurrentTime}
            duration={duration}
            onSeek={displaySeek}
            disabled={aiDjActive}
            loopRegion={displayLoopRegion}
            preferBarWhenNarrow
          />

          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton onClick={toggleShuffle} label="Shuffle" active={shuffleMode === "random"} size="lg" disabled={transportLocked}>
              <ShuffleIcon size={24} />
            </IconButton>
            <IconButton
              onClick={toggleSmartShuffle}
              label="Smart Shuffle"
              active={shuffleMode === "smart"}
              size="lg"
              disabled={transportLocked || !smartShuffleAvailable}
            >
              <SmartShuffleIcon size={24} />
            </IconButton>
            <VibeRadioPopover />
            <IconButton
              onClick={toggleRepeatMode}
              label={repeatMode === "one" ? "Repeat one" : repeatMode === "all" ? "Repeat all" : "Repeat"}
              active={repeatMode !== "off"}
              size="lg"
              disabled={transportLocked}
            >
              {repeatMode === "one" ? <RepeatOneIcon size={24} /> : <RepeatIcon size={24} />}
            </IconButton>
            <div className="group relative flex h-11 items-center px-1">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-2 w-24 accent-acc"
              />
              <HoverTip text="Volume" />
            </div>
            <EqualizerPopover />
            {(sleepEndsAt != null || sleepAfterTrack) && (
              <button
                type="button"
                onClick={clearSleepTimer}
                className="rounded-lg border border-playing px-2 py-1 font-mono text-[11px] text-playing hover:bg-[var(--lf-tint)]"
                aria-label="Cancel sleep timer"
                title="Cancel sleep timer"
              >
                {sleepAfterTrack ? "sleep · track" : `sleep · ${sleepMinutes ?? ""}m`}
              </button>
            )}
            {showFormatBadges ? (
              <span className="hidden font-mono text-[11px] text-ok xl:inline">{displayTrack.format.toUpperCase()}</span>
            ) : null}
            <button
              type="button"
              onClick={toggleQueue}
              aria-pressed={isQueueOpen}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.04em] ${
                isQueueOpen ? "border border-acc text-acc-text" : "border border-line text-t2 hover:border-acc hover:text-t1"
              }`}
            >
              Queue
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex w-[250px] shrink-0 items-center gap-3">
            <div className="lf-hatch h-14 w-14 shrink-0 rounded-xl" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm text-t3">Nothing playing</p>
              <p className="truncate font-mono text-xs text-t3">pick a track or ⌘K</p>
            </div>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-t3" aria-hidden>
            <PlayIcon size={18} />
          </div>
          <span className="flex-1 font-mono text-xs text-t3">—:—</span>
        </>
      )}
    </footer>
  );
}

