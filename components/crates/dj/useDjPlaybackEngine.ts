"use client";

import { useCallback, useEffect, useRef } from "react";
import { streamUrl } from "@/lib/api-client";
import { computeDjAdjustment } from "@/lib/audio/djMatch";
import { getPlaybackEqualizer } from "@/lib/audio/equalizer";
import { useDjStore } from "@/lib/store/dj";

/**
 * Drives the DJ view's single deck: a dedicated `<audio>` element (never the regular player's
 * decks) routed through PlaybackEqualizer's DJ source (MediaElementSource -> SoundTouch ->
 * shared mixer), with live tempo/pitch kept in sync with the session's target BPM/key. Mounted
 * only inside the DJ route, so it never initializes — and can never affect — regular playback.
 */
export function useDjPlaybackEngine() {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const loadedTrackIdRef = useRef<number | null>(null);

  const currentTrack = useDjStore((s) => s.currentTrack);
  const isPlaying = useDjStore((s) => s.isPlaying);
  const targetBpm = useDjStore((s) => s.targetBpm);
  const targetKey = useDjStore((s) => s.targetKey);
  const targetOctave = useDjStore((s) => s.targetOctave);
  const keyLockEnabled = useDjStore((s) => s.keyLockEnabled);
  const setDjPlaying = useDjStore((s) => s.setDjPlaying);
  const setCurrentTime = useDjStore((s) => s.setCurrentTime);
  const pendingSeekSeconds = useDjStore((s) => s.pendingSeekSeconds);
  const consumePendingSeek = useDjStore((s) => s.consumePendingSeek);

  // A callback ref (not useRef + a `[]`-dep effect) because DjCrateView returns null while its
  // playlist query is loading, so the <audio> element doesn't exist on that first render pass —
  // an effect with empty deps would fire once, too early, against a null ref, and never retry.
  // A callback ref instead connects at the exact moment the node attaches, no matter how many
  // renders happened before that.
  const audioRef = useCallback((node: HTMLAudioElement | null) => {
    audioElRef.current = node;
    if (node) {
      getPlaybackEqualizer()
        .connectDjSource(node)
        .catch((err) => console.error("[DJ] failed to connect audio source:", err));
    } else {
      getPlaybackEqualizer().disconnectDjSource();
    }
  }, []);

  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || !currentTrack) return;
    if (loadedTrackIdRef.current === currentTrack.id) return;
    loadedTrackIdRef.current = currentTrack.id;
    audio.preservesPitch = false;
    audio.src = streamUrl(currentTrack.id);
    audio.load();
  }, [currentTrack]);

  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      void getPlaybackEqualizer().resume();
      audio.play().catch(() => setDjPlaying(false));
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack, setDjPlaying]);

  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || !currentTrack) return;
    const { tempoRatio, pitchSemitones } = computeDjAdjustment(
      currentTrack,
      targetBpm,
      targetKey,
      keyLockEnabled,
      targetOctave
    );
    audio.playbackRate = tempoRatio;
    getPlaybackEqualizer().setDjTempoPitch(tempoRatio, pitchSemitones);
  }, [currentTrack, targetBpm, targetKey, keyLockEnabled, targetOctave]);

  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || pendingSeekSeconds == null) return;
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      audio.currentTime = pendingSeekSeconds;
      consumePendingSeek();
    }
  }, [pendingSeekSeconds, consumePendingSeek]);

  const handleEnded = () => setDjPlaying(false);
  const handlePause = () => setDjPlaying(false);
  const handlePlay = () => setDjPlaying(true);
  const handleTimeUpdate = (audio: HTMLAudioElement) => setCurrentTime(audio.currentTime);

  return { audioRef, handleEnded, handlePause, handlePlay, handleTimeUpdate };
}
