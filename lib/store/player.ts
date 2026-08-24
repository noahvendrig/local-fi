import { create } from "zustand";
import type { TrackSummary } from "@/lib/api-client";
import { fetchPlaybackState, putPlaybackState, type RepeatMode } from "@/lib/api/playbackClient";
import type { WaveformData } from "@/lib/waveform/parse";

const PERSIST_DEBOUNCE_MS = 400;

interface PlayerState {
  currentTrack: TrackSummary | null;
  queue: TrackSummary[];
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

  hydrate: () => Promise<void>;
  /** Selects a track; re-clicking the already-current track toggles play/pause instead of restarting it. */
  playTrack: (track: TrackSummary, queueContext?: TrackSummary[]) => void;
  /** Appends tracks to the end of the queue; if nothing is playing, starts playback instead. */
  enqueue: (tracks: TrackSummary[]) => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
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
    });
  }, PERSIST_DEBOUNCE_MS);
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
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

  hydrate: async () => {
    try {
      const data = await fetchPlaybackState();
      const currentIndex = data.queue.length > 0 ? Math.min(data.currentIndex, data.queue.length - 1) : 0;
      const currentTrack = data.queue[currentIndex] ?? null;
      set({
        queue: data.queue,
        currentIndex,
        currentTrack,
        volume: data.volume,
        repeatMode: data.repeatMode,
        shuffle: data.shuffle,
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
    const { currentTrack, isPlaying } = get();
    if (currentTrack?.id === track.id) {
      set({ isPlaying: !isPlaying });
      schedulePersist(get);
      return;
    }
    const queue = queueContext && queueContext.length > 0 ? queueContext : [track];
    const index = queue.findIndex((t) => t.id === track.id);
    set({
      currentTrack: track,
      queue,
      currentIndex: index >= 0 ? index : 0,
      isPlaying: true,
      currentTime: 0,
      pendingSeekSeconds: null,
    });
    schedulePersist(get);
  },

  enqueue: (tracksToAdd) => {
    if (tracksToAdd.length === 0) return;
    const { queue, currentTrack } = get();
    if (!currentTrack) {
      // Nothing playing: queuing starts playback, matching common player UX.
      set({
        currentTrack: tracksToAdd[0],
        queue: tracksToAdd,
        currentIndex: 0,
        isPlaying: true,
        currentTime: 0,
        pendingSeekSeconds: null,
      });
    } else {
      set({ queue: [...queue, ...tracksToAdd] });
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
    const { queue, currentIndex } = get();
    if (queue.length === 0) return;
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : 0;
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

  // Reshuffles the upcoming portion of the queue in place; toggling back off just flips the
  // flag (original order isn't retained — matches common player behavior, not a schema need).
  toggleShuffle: () => {
    const { shuffle, queue, currentIndex } = get();
    if (!shuffle) {
      const head = queue.slice(0, currentIndex + 1);
      const tail = queue.slice(currentIndex + 1);
      for (let i = tail.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tail[i], tail[j]] = [tail[j], tail[i]];
      }
      set({ queue: [...head, ...tail], shuffle: true });
    } else {
      set({ shuffle: false });
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

    set({ queue: newQueue, currentIndex: newCurrentIndex });
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

    set({
      queue: newQueue,
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
}));
