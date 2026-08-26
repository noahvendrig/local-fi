"use client";

import { useCallback, useEffect, useRef } from "react";
import type { TrackSummary } from "@/lib/api-client";
import { recordPlay } from "@/lib/api/tracksClient";
import { fadeDurationSeconds } from "@/lib/audio/crossfade";
import { getPlaybackEqualizer, type DeckId } from "@/lib/audio/equalizer";
import { loudnessGain } from "@/lib/audio/loudness";
import { resolvePlaybackSrc } from "@/lib/offline/playback";
import { getUpcomingTrack } from "@/lib/player/upNext";
import { usePlayerStore } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";

const POSITION_PERSIST_INTERVAL_MS = 5000;

function waitForCanPlay(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("audio load timeout"));
    }, 8000);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("audio failed to load"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("error", onError);
    };
    audio.addEventListener("canplay", onReady);
    audio.addEventListener("error", onError);
  });
}

// A resolved offline blob becomes an object URL, which — unlike streamUrl()'s plain string —
// owns a real browser resource until revoked. Stashing it on the element itself (rather than a
// side map keyed by deck) keeps "does this deck currently hold a blob URL" co-located with the
// element it belongs to, and survives the two decks trading the "lead" role.
function revokeDeckBlobUrl(audio: HTMLAudioElement) {
  const prev = audio.dataset.blobUrl;
  if (prev) {
    URL.revokeObjectURL(prev);
    delete audio.dataset.blobUrl;
  }
}

async function assignTrack(audio: HTMLAudioElement, track: TrackSummary): Promise<void> {
  if (audio.dataset.trackId === String(track.id) && audio.getAttribute("src")) {
    return waitForCanPlay(audio);
  }
  const url = await resolvePlaybackSrc(track);
  revokeDeckBlobUrl(audio);
  audio.dataset.trackId = String(track.id);
  if (url.startsWith("blob:")) audio.dataset.blobUrl = url;
  audio.src = url;
  audio.load();
  return waitForCanPlay(audio);
}

function clearDeck(audio: HTMLAudioElement | null, deck: DeckId) {
  if (!audio) return;
  audio.pause();
  revokeDeckBlobUrl(audio);
  audio.removeAttribute("src");
  audio.load();
  audio.dataset.trackId = "";
  getPlaybackEqualizer().setDeckGain(deck, 0);
}

export function usePlaybackEngine() {
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const leadDeckRef = useRef<DeckId>(0);
  const fadingRef = useRef(false);
  const incomingTrackIdRef = useRef<number | null>(null);
  const switchingRef = useRef(false);
  const loadGenRef = useRef(0);
  const fadeGenRef = useRef(0);
  const crossfadeTimerRef = useRef(0);
  const fadeDoneTimerRef = useRef(0);
  const lastPersistedAtRef = useRef(0);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const playNext = usePlayerStore((s) => s.playNext);
  const playFromQueue = usePlayerStore((s) => s.playFromQueue);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const volume = usePlayerStore((s) => s.volume);
  const eqEnabled = usePlayerStore((s) => s.eqEnabled);
  const eqGains = usePlayerStore((s) => s.eqGains);
  const eqPreamp = usePlayerStore((s) => s.eqPreamp);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const pendingSeekSeconds = usePlayerStore((s) => s.pendingSeekSeconds);
  const consumePendingSeek = usePlayerStore((s) => s.consumePendingSeek);
  const persistPosition = usePlayerStore((s) => s.persistPosition);
  const sleepAfterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const clearSleepTimer = usePlayerStore((s) => s.clearSleepTimer);
  const loudnessMatch = useSettingsStore((s) => s.loudnessMatch);
  const crossfadeSeconds = useSettingsStore((s) => s.crossfadeSeconds);

  const deckAudio = useCallback((deck: DeckId) => (deck === 0 ? audioARef.current : audioBRef.current), []);

  const abortFade = useCallback(() => {
    fadingRef.current = false;
    incomingTrackIdRef.current = null;
    fadeGenRef.current += 1;
    window.clearTimeout(crossfadeTimerRef.current);
    window.clearTimeout(fadeDoneTimerRef.current);
  }, []);

  const scheduleCrossfade = useCallback(
    (fromSeconds: number) => {
      window.clearTimeout(crossfadeTimerRef.current);
      if (fadingRef.current || !isPlaying || sleepAfterTrack || repeatMode === "one") return;
      if (!currentTrack || crossfadeSeconds <= 0) return;
      const fade = fadeDurationSeconds(currentTrack.durationSeconds, crossfadeSeconds);
      if (fade <= 0) return;
      const delay = Math.max(0, currentTrack.durationSeconds - fromSeconds - fade);
      crossfadeTimerRef.current = window.setTimeout(() => {
        void beginCrossfadeRef.current();
      }, delay * 1000);
    },
    [currentTrack, isPlaying, sleepAfterTrack, repeatMode, crossfadeSeconds],
  );

  const scheduleCrossfadeRef = useRef(scheduleCrossfade);
  scheduleCrossfadeRef.current = scheduleCrossfade;

  const beginCrossfadeRef = useRef<() => Promise<void>>(async () => {});

  beginCrossfadeRef.current = async () => {
    if (fadingRef.current || switchingRef.current) return;
    fadingRef.current = true;

    const player = usePlayerStore.getState();
    const settings = useSettingsStore.getState();
    const outgoing = player.currentTrack;
    if (!outgoing || player.sleepAfterTrack || player.repeatMode === "one") {
      fadingRef.current = false;
      return;
    }
    const upcoming = getUpcomingTrack(player.queue, player.currentIndex, player.repeatMode);
    if (!upcoming) {
      fadingRef.current = false;
      return;
    }

    const outDeck = leadDeckRef.current;
    const inDeck = (1 - outDeck) as DeckId;
    const audioOut = deckAudio(outDeck);
    const audioIn = deckAudio(inDeck);
    if (!audioOut || !audioIn) {
      fadingRef.current = false;
      return;
    }

    const remaining = Math.max(0.15, outgoing.durationSeconds - audioOut.currentTime);
    const duration = fadeDurationSeconds(outgoing.durationSeconds, Math.min(settings.crossfadeSeconds, remaining));
    if (duration <= 0) {
      fadingRef.current = false;
      return;
    }

    const fadeGen = fadeGenRef.current + 1;
    fadeGenRef.current = fadeGen;
    incomingTrackIdRef.current = upcoming.track.id;

    try {
      await assignTrack(audioIn, upcoming.track);
      if (fadeGen !== fadeGenRef.current) return;
      audioIn.currentTime = 0;
      const loudOut = loudnessGain(outgoing.waveformAvgLevel, settings.loudnessMatch);
      const loudIn = loudnessGain(upcoming.track.waveformAvgLevel, settings.loudnessMatch);
      const eq = getPlaybackEqualizer();
      eq.setDeckGain(inDeck, 0);
      await eq.resume();
      await audioIn.play();
      if (fadeGen !== fadeGenRef.current) return;
      eq.crossfadeDecks(outDeck, inDeck, loudOut, loudIn, duration);
      void recordPlay(outgoing.id).catch(() => {});
      leadDeckRef.current = inDeck;
      playFromQueue(upcoming.index);
      fadeDoneTimerRef.current = window.setTimeout(() => {
        if (fadeGen !== fadeGenRef.current) return;
        clearDeck(audioOut, outDeck);
        fadingRef.current = false;
        incomingTrackIdRef.current = null;
        const lead = deckAudio(inDeck);
        scheduleCrossfadeRef.current(lead?.currentTime ?? 0);
        void preloadUpcomingRef.current();
      }, duration * 1000);
    } catch {
      if (fadeGen !== fadeGenRef.current) return;
      fadingRef.current = false;
      incomingTrackIdRef.current = null;
      playFromQueue(upcoming.index);
    }
  };

  const preloadUpcomingRef = useRef<() => Promise<void>>(async () => {});
  preloadUpcomingRef.current = async () => {
    if (fadingRef.current) return;
    const settings = useSettingsStore.getState();
    if (settings.crossfadeSeconds <= 0) return;
    const player = usePlayerStore.getState();
    const upcoming = getUpcomingTrack(player.queue, player.currentIndex, player.repeatMode);
    if (!upcoming) return;
    const other = (1 - leadDeckRef.current) as DeckId;
    const audio = deckAudio(other);
    if (!audio) return;
    try {
      await assignTrack(audio, upcoming.track);
      getPlaybackEqualizer().setDeckGain(other, 0);
    } catch {
      // Preload is best-effort; the fade start will try again.
    }
  };

  useEffect(() => {
    const a = audioARef.current;
    const b = audioBRef.current;
    if (!a || !b) return;
    const eq = getPlaybackEqualizer();
    eq.connectDeck(a, 0);
    eq.connectDeck(b, 1);
  }, []);

  useEffect(() => {
    const audio = audioARef.current;
    if (audio) audio.volume = 1;
    const other = audioBRef.current;
    if (other) other.volume = 1;
    getPlaybackEqualizer().setVolume(volume);
  }, [volume]);

  useEffect(() => {
    getPlaybackEqualizer().setEq({ enabled: eqEnabled, gains: eqGains, preamp: eqPreamp });
  }, [eqEnabled, eqGains, eqPreamp]);

  useEffect(() => {
    const track = usePlayerStore.getState().currentTrack;
    if (!track) {
      abortFade();
      loadGenRef.current += 1;
      clearDeck(audioARef.current, 0);
      clearDeck(audioBRef.current, 1);
      leadDeckRef.current = 0;
      return;
    }
    if (incomingTrackIdRef.current === track.id) return;

    const gen = ++loadGenRef.current;
    abortFade();
    switchingRef.current = true;

    const run = async () => {
      const lead = leadDeckRef.current;
      const other = (1 - lead) as DeckId;
      const audio = deckAudio(lead);
      if (!audio) return;
      clearDeck(deckAudio(other), other);
      try {
        await assignTrack(audio, track);
        if (gen !== loadGenRef.current) return;
        const player = usePlayerStore.getState();
        const seek = player.pendingSeekSeconds;
        if (seek != null) {
          audio.currentTime = seek;
          consumePendingSeek();
        } else if (player.currentTime > 0) {
          audio.currentTime = player.currentTime;
        } else {
          audio.currentTime = 0;
        }
        const loud = loudnessGain(track.waveformAvgLevel, useSettingsStore.getState().loudnessMatch);
        getPlaybackEqualizer().setDeckGain(lead, loud);
        if (usePlayerStore.getState().isPlaying) {
          await getPlaybackEqualizer().resume();
          await audio.play().catch(() => {});
        }
        scheduleCrossfadeRef.current(audio.currentTime);
        void preloadUpcomingRef.current();
      } catch {
        // Stream errors surface via the audio element's error event; leave UI as-is.
      } finally {
        if (gen === loadGenRef.current) switchingRef.current = false;
      }
    };

    void run();
    // Only reload when the selected track changes — scheduleCrossfade is read from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, abortFade, consumePendingSeek, deckAudio]);

  useEffect(() => {
    if (switchingRef.current) return;
    const lead = deckAudio(leadDeckRef.current);
    const other = deckAudio((1 - leadDeckRef.current) as DeckId);
    if (!lead) return;
    if (isPlaying) {
      void getPlaybackEqualizer().resume();
      lead.play().catch(() => {});
      if (fadingRef.current) other?.play().catch(() => {});
      scheduleCrossfade(lead.currentTime);
      void preloadUpcomingRef.current();
    } else {
      lead.pause();
      other?.pause();
      window.clearTimeout(crossfadeTimerRef.current);
    }
  }, [deckAudio, isPlaying, scheduleCrossfade]);

  useEffect(() => {
    if (fadingRef.current || !currentTrack) return;
    getPlaybackEqualizer().setDeckGain(
      leadDeckRef.current,
      loudnessGain(currentTrack.waveformAvgLevel, loudnessMatch),
    );
  }, [currentTrack?.id, currentTrack?.waveformAvgLevel, loudnessMatch]);

  useEffect(() => {
    const audio = deckAudio(leadDeckRef.current);
    if (!audio || pendingSeekSeconds == null) return;
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      audio.currentTime = pendingSeekSeconds;
      consumePendingSeek();
      scheduleCrossfade(pendingSeekSeconds);
    }
  }, [consumePendingSeek, deckAudio, pendingSeekSeconds, scheduleCrossfade]);

  useEffect(() => {
    const flush = () => {
      const audio = deckAudio(leadDeckRef.current);
      if (audio && usePlayerStore.getState().currentTrack) persistPosition(audio.currentTime);
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
  }, [deckAudio, persistPosition]);

  useEffect(() => {
    return () => {
      window.clearTimeout(crossfadeTimerRef.current);
      window.clearTimeout(fadeDoneTimerRef.current);
    };
  }, []);

  const handleTimeUpdate = (deck: DeckId, audio: HTMLAudioElement) => {
    if (deck !== leadDeckRef.current) return;
    const t = audio.currentTime;
    setCurrentTime(t);
    const now = Date.now();
    if (now - lastPersistedAtRef.current > POSITION_PERSIST_INTERVAL_MS) {
      lastPersistedAtRef.current = now;
      persistPosition(t);
    }
    if (!fadingRef.current && crossfadeSeconds > 0) {
      const duration = currentTrack?.durationSeconds ?? 0;
      const fade = fadeDurationSeconds(duration, crossfadeSeconds);
      if (fade > 0 && duration - t <= fade + 0.05) {
        void beginCrossfadeRef.current();
      }
    }
  };

  const handleEnded = (deck: DeckId) => {
    if (deck !== leadDeckRef.current) return;
    if (fadingRef.current) return;
    const track = usePlayerStore.getState().currentTrack;
    if (track) void recordPlay(track.id).catch(() => {});
    const audio = deckAudio(deck);
    if (sleepAfterTrack) {
      clearSleepTimer();
      setPlaying(false);
      if (audio) persistPosition(audio.currentTime);
      return;
    }
    if (repeatMode === "one" && audio) {
      audio.currentTime = 0;
      setCurrentTime(0);
      audio.play().catch(() => {});
      return;
    }
    playNext();
  };

  const handlePlay = (deck: DeckId) => {
    if (deck === leadDeckRef.current) setPlaying(true);
  };

  const handlePause = (deck: DeckId) => {
    if (deck !== leadDeckRef.current || switchingRef.current || fadingRef.current) return;
    setPlaying(false);
    const audio = deckAudio(deck);
    if (audio) persistPosition(audio.currentTime);
  };

  return {
    audioARef,
    audioBRef,
    handleTimeUpdate,
    handleEnded,
    handlePlay,
    handlePause,
  };
}
