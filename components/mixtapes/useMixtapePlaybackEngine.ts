"use client";

import { useCallback, useEffect, useRef } from "react";
import { mixtapeStreamUrl } from "@/lib/api/mixtapesClient";
import { useMixtapePlayerStore } from "@/lib/store/mixtapePlayer";

/**
 * Drives the mixtape detail page's single deck: a dedicated `<audio>` element (never the regular
 * player's decks or the DJ deck) kept in sync with useMixtapePlayerStore. Mounted only inside the
 * mixtape detail route, mirroring components/crates/dj/useDjPlaybackEngine.ts — so it never
 * initializes, and can never affect, regular or DJ playback.
 */
export function useMixtapePlaybackEngine() {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const loadedMixtapeIdRef = useRef<number | null>(null);

  const currentMixtape = useMixtapePlayerStore((s) => s.currentMixtape);
  const isPlaying = useMixtapePlayerStore((s) => s.isPlaying);
  const setMixtapePlaying = useMixtapePlayerStore((s) => s.setMixtapePlaying);
  const setCurrentTime = useMixtapePlayerStore((s) => s.setCurrentTime);
  const pendingSeekSeconds = useMixtapePlayerStore((s) => s.pendingSeekSeconds);
  const consumePendingSeek = useMixtapePlayerStore((s) => s.consumePendingSeek);

  // A callback ref (not useRef + a `[]`-dep effect) for the same reason as the DJ engine: the
  // mixtape detail view can return early (loading state) before the <audio> node ever mounts.
  const audioRef = useCallback((node: HTMLAudioElement | null) => {
    audioElRef.current = node;
  }, []);

  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || !currentMixtape) return;
    if (loadedMixtapeIdRef.current === currentMixtape.id) return;
    loadedMixtapeIdRef.current = currentMixtape.id;
    audio.src = mixtapeStreamUrl(currentMixtape.id);
    audio.load();
  }, [currentMixtape]);

  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || !currentMixtape) return;
    if (isPlaying) {
      audio.play().catch(() => setMixtapePlaying(false));
    } else {
      audio.pause();
    }
  }, [isPlaying, currentMixtape, setMixtapePlaying]);

  // Unlike a plain immediate check, this also retries once metadata finishes loading — a segment
  // clicked in the waveform right after choosing a mixtape (before its <audio> has metadata)
  // would otherwise seek to nothing since readyState hasn't reached HAVE_METADATA yet.
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || pendingSeekSeconds == null) return;
    const target = pendingSeekSeconds;
    const apply = () => {
      audio.currentTime = target;
      consumePendingSeek();
    };
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      apply();
      return;
    }
    audio.addEventListener("loadedmetadata", apply, { once: true });
    return () => audio.removeEventListener("loadedmetadata", apply);
  }, [pendingSeekSeconds, consumePendingSeek]);

  const handleEnded = () => setMixtapePlaying(false);
  const handlePause = () => setMixtapePlaying(false);
  const handlePlay = () => setMixtapePlaying(true);
  const handleTimeUpdate = (audio: HTMLAudioElement) => setCurrentTime(audio.currentTime);

  return { audioRef, handleEnded, handlePause, handlePlay, handleTimeUpdate };
}
