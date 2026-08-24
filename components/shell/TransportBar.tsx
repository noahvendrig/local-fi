"use client";

import { useEffect, useRef } from "react";
import { streamUrl, waveformUrl } from "@/lib/api-client";
import { withAuthQuery } from "@/lib/api/http";
import { fetchWaveform } from "@/lib/waveform/parse";
import { usePlayerStore } from "@/lib/store/player";
import { getPlaybackEqualizer } from "@/lib/audio/equalizer";
import { WaveformScrubber } from "./WaveformScrubber";
import { EqualizerPopover } from "./EqualizerPopover";
import { HoverTip, IconButton } from "./IconButton";
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

const POSITION_PERSIST_INTERVAL_MS = 5000;

// Persistent 88px transport bar, mounted once in the root layout so it survives
// route navigation (ARCHITECTURE.md M4/M5). Owns the single <audio> element — every
// other surface (Now Playing overlay, Queue drawer) reads/drives playback through the store.
export function TransportBar() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const toggleRepeatMode = usePlayerStore((s) => s.toggleRepeatMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const eqEnabled = usePlayerStore((s) => s.eqEnabled);
  const eqGains = usePlayerStore((s) => s.eqGains);
  const eqPreamp = usePlayerStore((s) => s.eqPreamp);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const waveform = usePlayerStore((s) => s.waveform);
  const setWaveform = usePlayerStore((s) => s.setWaveform);
  const pendingSeekSeconds = usePlayerStore((s) => s.pendingSeekSeconds);
  const consumePendingSeek = usePlayerStore((s) => s.consumePendingSeek);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const persistPosition = usePlayerStore((s) => s.persistPosition);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const openNowPlaying = usePlayerStore((s) => s.openNowPlaying);

  const audioRef = useRef<HTMLAudioElement>(null);
  const lastPersistedAtRef = useRef(0);

  const duration = currentTrack?.durationSeconds ?? 0;

  // Fetch the new track's peak sidecar whenever the track changes (currentTime itself is
  // reset to 0 by the store action that changed the track, not here — see lib/store/player.ts).
  useEffect(() => {
    setWaveform(null);
    if (!currentTrack) return;
    let cancelled = false;
    fetchWaveform(waveformUrl(currentTrack.id))
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
  }, [currentTrack?.id]);

  // Attach the Web Audio EQ graph once. createMediaElementSource can only run once per element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    getPlaybackEqualizer().connect(audio);
  }, []);

  // Sync the <audio> element's play/pause state to the store, including right after a src change.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      void getPlaybackEqualizer().resume();
      audio.play().catch(() => {
        // Autoplay can be blocked (e.g. no prior user gesture); the UI stays in sync via onPause below.
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  // After the graph is connected, element.volume is ignored in some browsers — drive it via GainNode.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = 1;
    getPlaybackEqualizer().setVolume(volume);
  }, [volume]);

  useEffect(() => {
    getPlaybackEqualizer().setEq({ enabled: eqEnabled, gains: eqGains, preamp: eqPreamp });
  }, [eqEnabled, eqGains, eqPreamp]);

  // Applies a seek requested from anywhere (this bar's scrubber, the Now Playing overlay's
  // scrubber, or a hydrated position restored on load) to the actual audio element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || pendingSeekSeconds == null) return;
    audio.currentTime = pendingSeekSeconds;
    consumePendingSeek();
  }, [pendingSeekSeconds, consumePendingSeek]);

  useEffect(() => {
    const flush = () => {
      const audio = audioRef.current;
      if (audio && currentTrack) persistPosition(audio.currentTime);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
    };
  }, [currentTrack, persistPosition]);

  const handleTimeUpdate = (t: number) => {
    setCurrentTime(t);
    const now = Date.now();
    if (now - lastPersistedAtRef.current > POSITION_PERSIST_INTERVAL_MS) {
      lastPersistedAtRef.current = now;
      persistPosition(t);
    }
  };

  const handleEnded = () => {
    const audio = audioRef.current;
    if (repeatMode === "one" && audio) {
      audio.currentTime = 0;
      setCurrentTime(0);
      audio.play().catch(() => {});
      return;
    }
    playNext();
  };

  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 flex h-[88px] items-center gap-6 overflow-visible border-t border-line bg-surf px-6 shadow-[var(--lf-transport-shadow)]">
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        src={currentTrack ? streamUrl(currentTrack.id) : undefined}
        onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget.currentTime)}
        onEnded={handleEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          if (audioRef.current) persistPosition(audioRef.current.currentTime);
        }}
        preload="metadata"
      />

      {currentTrack ? (
        <>
          <button
            type="button"
            onClick={openNowPlaying}
            className="group relative flex w-[250px] shrink-0 items-center gap-3 text-left"
            aria-label="Now Playing"
          >
            <HoverTip text="Now Playing" />
            <div className="lf-hatch h-14 w-14 shrink-0 overflow-hidden rounded-xl shadow-[var(--lf-art-shadow)]">
              {currentTrack.coverArtUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local-only images
                <img src={withAuthQuery(currentTrack.coverArtUrl)} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
                  <AlbumPlaceholderIcon />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p
                className={`truncate text-sm ${isPlaying ? "text-playing" : "text-t1"}`}
                title={currentTrack.title ?? undefined}
              >
                {currentTrack.title ?? "Untitled"}
              </p>
              <p className="truncate font-mono text-xs text-t3" title={currentTrack.artistName ?? undefined}>
                {currentTrack.artistName ?? "Unknown artist"}
              </p>
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton onClick={playPrevious} label="Previous" size="lg">
              <PreviousIcon size={26} />
            </IconButton>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="lf-top group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-acc bg-acc text-on-acc hover:border-acc-2 hover:bg-acc-2"
            >
              {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={26} />}
              <HoverTip text={isPlaying ? "Pause" : "Play"} />
            </button>
            <IconButton onClick={playNext} label="Next" size="lg">
              <NextIcon size={26} />
            </IconButton>
          </div>

          <WaveformScrubber waveform={waveform} currentTime={currentTime} duration={duration} onSeek={seekTo} disabled={false} />

          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton onClick={toggleShuffle} label="Shuffle" active={shuffle} size="lg">
              <ShuffleIcon size={24} />
            </IconButton>
            <IconButton
              onClick={toggleRepeatMode}
              label={repeatMode === "one" ? "Repeat one" : repeatMode === "all" ? "Repeat all" : "Repeat"}
              active={repeatMode !== "off"}
              size="lg"
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
            <span className="hidden font-mono text-[11px] text-ok xl:inline">{currentTrack.format.toUpperCase()}</span>
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

