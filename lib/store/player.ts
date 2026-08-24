import { create } from "zustand";
import type { TrackSummary } from "@/lib/api-client";
import { fetchPlaybackState, putPlaybackState, type RepeatMode } from "@/lib/api/playbackClient";
import {
  DEFAULT_EQ_STATE,
  matchPresetId,
  presetById,
  snapEqGain,
  type EqPresetId,
} from "@/lib/audio/eqConfig";
import type { WaveformData } from "@/lib/waveform/parse";

const PERSIST_DEBOUNCE_MS = 400;

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Keep the selected track first so Up Next is the shuffled remainder (what will actually play). */
function shuffledQueueFrom(queue: TrackSummary[], currentIndex: number): { queue: TrackSummary[]; currentIndex: number } {
  if (queue.length <= 1) return { queue, currentIndex };
  const selected = queue[currentIndex];
  const rest = [...queue.slice(0, currentIndex), ...queue.slice(currentIndex + 1)];
  shuffleInPlace(rest);
  return { queue: [selected, ...rest], currentIndex: 0 };
}

interface PlayerState {
  currentTrack: TrackSummary | null;
  queue: TrackSummary[];
  /** Unshuffled crate/album order; used to rebuild the play queue when shuffle is toggled off. */
  sourceQueue: TrackSummary[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  /** Requested audio-element position; TransportBar's effect applies it and clears it. */
  pendingSeekSeconds: number | null;
  /** Live position, driven by TransportBar's <audio> onTimeUpdate — the single source shared
   *  by every waveform scrubber (transport bar + full-screen Now Playing) via store selectors. */
  currentTime: number;
  /** Current track's parsed peak sidecar, fetched once by TransportBar and shared the same way. */
  waveform: WaveformData | null;
  isQueueOpen: boolean;
  isNowPlayingOpen: boolean;
  hydrated: boolean;
  sleepEndsAt: number | null;
  sleepAfterTrack: boolean;
  sleepMinutes: 15 | 30 | 45 | 60 | null;
  eqEnabled: boolean;
  eqGains: number[];
  eqPreamp: number;
  eqPreset: EqPresetId;

  hydrate: () => Promise<void>;
  /** Selects a track; re-clicking the already-current track toggles play/pause instead of restarting it. */
  playTrack: (track: TrackSummary, queueContext?: TrackSummary[]) => void;
  /** Plays a list from the start, or from a random track when shuffle is on. */
  playContext: (tracks: TrackSummary[]) => void;
  /** Appends tracks to the end of the queue; if nothing is playing, starts playback instead. */
  enqueue: (tracks: TrackSummary[]) => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
  setEqEnabled: (enabled: boolean) => void;
  setEqBand: (index: number, gainDb: number) => void;
  setEqPreamp: (preampDb: number) => void;
  setEqPreset: (preset: Exclude<EqPresetId, "custom">) => void;
  resetEq: () => void;
  playNext: () => void;
  playPrevious: () => void;
  toggleRepeatMode: () => void;
  toggleShuffle: () => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  playFromQueue: (index: number) => void;
  setCurrentTime: (seconds: number) => void;
  setWaveform: (data: WaveformData | null) => void;
  seekTo: (seconds: number) => void;
  consumePendingSeek: () => void;
  persistPosition: (seconds: number) => void;
  openQueue: () => void;
  closeQueue: () => void;
  toggleQueue: () => void;
  openNowPlaying: () => void;
  closeNowPlaying: () => void;
  setSleepTimer: (minutes: 15 | 30 | 45 | 60) => void;
  setSleepAfterTrack: () => void;
  clearSleepTimer: () => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounce-writes the non-position playback fields to /playback-state (ARCHITECTURE.md M5). */
function schedulePersist(get: () => PlayerState) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = get();
    if (!s.hydrated) return; // don't clobber saved state with pre-hydrate defaults
    void putPlaybackState({
      queue: s.queue.map((t) => t.id),
      currentIndex: s.currentIndex,
      isPlaying: s.isPlaying,
      volume: s.volume,
      repeatMode: s.repeatMode,
      shuffle: s.shuffle,
      eq: {
        enabled: s.eqEnabled,
        gains: s.eqGains,
        preamp: s.eqPreamp,
        preset: s.eqPreset,
      },
    });
  }, PERSIST_DEBOUNCE_MS);
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  sourceQueue: [],
  currentIndex: 0,
  isPlaying: false,
  volume: 1,
  repeatMode: "off",
  shuffle: false,
  pendingSeekSeconds: null,
  currentTime: 0,
  waveform: null,
  isQueueOpen: false,
  isNowPlayingOpen: false,
  hydrated: false,
  sleepEndsAt: null,
  sleepAfterTrack: false,
  sleepMinutes: null,
  eqEnabled: DEFAULT_EQ_STATE.enabled,
  eqGains: [...DEFAULT_EQ_STATE.gains],
  eqPreamp: DEFAULT_EQ_STATE.preamp,
  eqPreset: DEFAULT_EQ_STATE.preset,

  hydrate: async () => {
    try {
      const data = await fetchPlaybackState();
      const currentIndex = data.queue.length > 0 ? Math.min(data.currentIndex, data.queue.length - 1) : 0;
      const currentTrack = data.queue[currentIndex] ?? null;
      set({
        queue: data.queue,
        sourceQueue: data.queue,
        currentIndex,
        currentTrack,
        volume: data.volume,
        repeatMode: data.repeatMode,
        shuffle: data.shuffle,
        eqEnabled: data.eq?.enabled ?? DEFAULT_EQ_STATE.enabled,
        eqGains: [...(data.eq?.gains ?? DEFAULT_EQ_STATE.gains)],
        eqPreamp: data.eq?.preamp ?? DEFAULT_EQ_STATE.preamp,
        eqPreset: data.eq?.preset ?? DEFAULT_EQ_STATE.preset,
        isPlaying: false, // never autoplay on load — browsers block it anyway, and it's a jarring UX
        currentTime: currentTrack ? data.positionSeconds : 0,
        pendingSeekSeconds: currentTrack && data.positionSeconds > 0 ? data.positionSeconds : null,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  playTrack: (track, queueContext) => {
    const { currentTrack, isPlaying, shuffle } = get();
    if (currentTrack?.id === track.id) {
      set({ isPlaying: !isPlaying });
      schedulePersist(get);
      return;
    }
    const sourceQueue = queueContext && queueContext.length > 0 ? [...queueContext] : [track];
    let queue = [...sourceQueue];
    let currentIndex = queue.findIndex((t) => t.id === track.id);
    if (currentIndex < 0) currentIndex = 0;
    if (shuffle) {
      const shuffled = shuffledQueueFrom(queue, currentIndex);
      queue = shuffled.queue;
      currentIndex = shuffled.currentIndex;
    }
    set({
      currentTrack: track,
      queue,
      sourceQueue,
      currentIndex,
      isPlaying: true,
      currentTime: 0,
      pendingSeekSeconds: null,
    });
    schedulePersist(get);
  },

  playContext: (tracks) => {
    if (tracks.length === 0) return;
    const startIndex = get().shuffle ? Math.floor(Math.random() * tracks.length) : 0;
    get().playTrack(tracks[startIndex], tracks);
  },

  enqueue: (tracksToAdd) => {
    if (tracksToAdd.length === 0) return;
    const { queue, sourceQueue, currentTrack, currentIndex, shuffle } = get();
    const nextSource = [...sourceQueue, ...tracksToAdd];
    if (!currentTrack) {
      // Nothing playing: queuing starts playback, matching common player UX.
      const nextQueue = shuffle ? shuffleInPlace([...tracksToAdd]) : [...tracksToAdd];
      set({
        currentTrack: nextQueue[0],
        queue: nextQueue,
        sourceQueue: [...tracksToAdd],
        currentIndex: 0,
        isPlaying: true,
        currentTime: 0,
        pendingSeekSeconds: null,
      });
    } else if (shuffle) {
      const nextQueue = queue.slice();
      for (const added of shuffleInPlace([...tracksToAdd])) {
        const upcomingSlots = nextQueue.length - currentIndex;
        const insertAt = currentIndex + 1 + Math.floor(Math.random() * upcomingSlots);
        nextQueue.splice(insertAt, 0, added);
      }
      set({ queue: nextQueue, sourceQueue: nextSource });
    } else {
      set({ queue: [...queue, ...tracksToAdd], sourceQueue: nextSource });
    }
    schedulePersist(get);
  },

  togglePlay: () => {
    if (!get().currentTrack) return;
    set((s) => ({ isPlaying: !s.isPlaying }));
    schedulePersist(get);
  },

  setPlaying: (playing) => {
    set({ isPlaying: playing });
    schedulePersist(get);
  },

  setVolume: (volume) => {
    set({ volume });
    schedulePersist(get);
  },

  setEqEnabled: (enabled) => {
    set({ eqEnabled: enabled });
    schedulePersist(get);
  },

  setEqBand: (index, gainDb) => {
    if (index < 0 || index >= DEFAULT_EQ_STATE.gains.length) return;
    const eqGains = get().eqGains.map((gain, i) => (i === index ? snapEqGain(gainDb) : gain));
    set({ eqGains, eqPreset: matchPresetId(eqGains), eqEnabled: true });
    schedulePersist(get);
  },

  setEqPreamp: (preampDb) => {
    set({ eqPreamp: snapEqGain(preampDb) });
    schedulePersist(get);
  },

  setEqPreset: (presetId) => {
    const preset = presetById(presetId);
    set({
      eqGains: [...preset.gains],
      eqPreset: preset.id,
      eqEnabled: true,
    });
    schedulePersist(get);
  },

  resetEq: () => {
    const flat = presetById("flat");
    set({
      eqGains: [...flat.gains],
      eqPreamp: 0,
      eqPreset: "flat",
    });
    schedulePersist(get);
  },

  playNext: () => {
    const { queue, currentIndex, repeatMode } = get();
    if (queue.length === 0) return;
    let nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      if (repeatMode !== "all") {
        set({ isPlaying: false });
        schedulePersist(get);
        return;
      }
      nextIndex = 0;
    }
    set({ currentIndex: nextIndex, currentTrack: queue[nextIndex], isPlaying: true, currentTime: 0, pendingSeekSeconds: null });
    schedulePersist(get);
  },

  playPrevious: () => {
    const { queue, currentIndex, repeatMode } = get();
    if (queue.length === 0) return;
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      if (repeatMode !== "all") {
        prevIndex = 0;
      } else {
        prevIndex = queue.length - 1;
      }
    }
    set({ currentIndex: prevIndex, currentTrack: queue[prevIndex], isPlaying: true, currentTime: 0, pendingSeekSeconds: null });
    schedulePersist(get);
  },

  playFromQueue: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    set({ currentIndex: index, currentTrack: queue[index], isPlaying: true, currentTime: 0, pendingSeekSeconds: null });
    schedulePersist(get);
  },

  toggleRepeatMode: () => {
    set((s) => ({ repeatMode: s.repeatMode === "off" ? "all" : s.repeatMode === "all" ? "one" : "off" }));
    schedulePersist(get);
  },

  // Shuffle rebuilds play order from the unshuffled source (current track stays put). Toggling
  // off restores that source order so Up Next updates immediately without stopping playback.
  toggleShuffle: () => {
    const { shuffle, queue, sourceQueue, currentIndex } = get();
    const source = sourceQueue.length > 0 ? sourceQueue : queue;
    const current = queue[currentIndex] ?? source[currentIndex] ?? null;
    if (!current) {
      set({ shuffle: !shuffle });
      schedulePersist(get);
      return;
    }
    const sourceIndex = Math.max(0, source.findIndex((t) => t.id === current.id));
    if (!shuffle) {
      const shuffled = shuffledQueueFrom(source, sourceIndex >= 0 ? sourceIndex : 0);
      set({ queue: shuffled.queue, currentIndex: shuffled.currentIndex, shuffle: true });
    } else {
      const restoredIndex = sourceIndex >= 0 ? sourceIndex : 0;
      set({ queue: [...source], currentIndex: restoredIndex, shuffle: false });
    }
    schedulePersist(get);
  },

  reorderQueue: (fromIndex, toIndex) => {
    const { queue, currentIndex } = get();
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) {
      return;
    }
    const newQueue = queue.slice();
    const [moved] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, moved);

    let newCurrentIndex = currentIndex;
    if (fromIndex === currentIndex) newCurrentIndex = toIndex;
    else if (fromIndex < currentIndex && toIndex >= currentIndex) newCurrentIndex = currentIndex - 1;
    else if (fromIndex > currentIndex && toIndex <= currentIndex) newCurrentIndex = currentIndex + 1;

    const sourceQueue = get().shuffle ? get().sourceQueue : newQueue;
    set({ queue: newQueue, sourceQueue, currentIndex: newCurrentIndex });
    schedulePersist(get);
  },

  removeFromQueue: (index) => {
    const { queue, currentIndex } = get();
    if (index < 0 || index >= queue.length) return;
    const newQueue = queue.slice();
    newQueue.splice(index, 1);

    let newCurrentIndex = currentIndex;
    let newCurrentTrack = get().currentTrack;
    let isPlaying = get().isPlaying;
    let pendingSeekSeconds = get().pendingSeekSeconds;
    let currentTime = get().currentTime;

    if (index < currentIndex) {
      newCurrentIndex = currentIndex - 1;
    } else if (index === currentIndex) {
      newCurrentIndex = Math.min(currentIndex, newQueue.length - 1);
      newCurrentTrack = newQueue[newCurrentIndex] ?? null;
      pendingSeekSeconds = null;
      currentTime = 0;
      if (!newCurrentTrack) isPlaying = false;
    }

    const removed = queue[index];
    const nextSource = get().sourceQueue.slice();
    const sourceIndex = nextSource.findIndex((t) => t.id === removed.id);
    if (sourceIndex >= 0) nextSource.splice(sourceIndex, 1);

    set({
      queue: newQueue,
      sourceQueue: nextSource,
      currentIndex: Math.max(0, newCurrentIndex),
      currentTrack: newCurrentTrack,
      isPlaying,
      pendingSeekSeconds,
      currentTime,
    });
    schedulePersist(get);
  },

  setCurrentTime: (seconds) => set({ currentTime: seconds }),
  setWaveform: (data) => set({ waveform: data }),

  seekTo: (seconds) => {
    const duration = get().currentTrack?.durationSeconds ?? 0;
    const clamped = duration > 0 ? Math.min(Math.max(seconds, 0), duration) : Math.max(seconds, 0);
    set({ pendingSeekSeconds: clamped, currentTime: clamped });
  },

  consumePendingSeek: () => set({ pendingSeekSeconds: null }),

  // Position is persisted on its own, throttled cadence (called by TransportBar) rather than
  // through schedulePersist — it changes far more often than the other fields and the API
  // merges partial PUTs server-side, so this never clobbers queue/index/etc.
  persistPosition: (seconds) => {
    if (!get().hydrated) return;
    void putPlaybackState({ positionSeconds: seconds });
  },

  openQueue: () => set({ isQueueOpen: true }),
  closeQueue: () => set({ isQueueOpen: false }),
  toggleQueue: () => set((s) => ({ isQueueOpen: !s.isQueueOpen })),
  openNowPlaying: () => set({ isNowPlayingOpen: true }),
  closeNowPlaying: () => set({ isNowPlayingOpen: false }),

  setSleepTimer: (minutes) =>
    set({
      sleepEndsAt: Date.now() + minutes * 60_000,
      sleepMinutes: minutes,
      sleepAfterTrack: false,
    }),
  setSleepAfterTrack: () => set({ sleepEndsAt: null, sleepMinutes: null, sleepAfterTrack: true }),
  clearSleepTimer: () => set({ sleepEndsAt: null, sleepMinutes: null, sleepAfterTrack: false }),
}));
