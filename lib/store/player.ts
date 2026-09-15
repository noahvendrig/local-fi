import { create } from "zustand";
import type { TrackSummary } from "@/lib/api-client";
import { hasCredentials } from "@/lib/api/http";
import { fetchPlaybackState, putPlaybackState, type RepeatMode, type ShuffleMode } from "@/lib/api/playbackClient";
import {
  DEFAULT_EQ_STATE,
  matchPresetId,
  presetById,
  snapEqGain,
  type EqPresetId,
} from "@/lib/audio/eqConfig";
import { useDjStore } from "./dj";
import { useMixtapePlayerStore } from "./mixtapePlayer";
import { useTransportSourceStore } from "./transportSource";
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

/** Where the current queue came from — only `crate` restricts Smart Shuffle's candidate pool to
 *  that crate's members; album/artist/allSongs (and no context at all) all mean "whole library"
 *  for Smart Shuffle purposes (see app/api/v1/smart-suggest/route.ts). */
export type QueueSource =
  | { type: "allSongs" }
  | { type: "crate"; crateId: number }
  | { type: "album"; albumId: number }
  | { type: "artist"; artistId: number };

function pushRecentlyPlayed(recentlyPlayed: number[], trackId: number): number[] {
  // No size cap: Smart Shuffle must not repeat a track until every other eligible track in
  // scope has played once (see setSmartUpcoming's exhaustion reset), so this has to remember
  // the whole current lap, not just a short tail -- personal-library scale keeps this cheap.
  return [trackId, ...recentlyPlayed.filter((id) => id !== trackId)];
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
  shuffleMode: ShuffleMode;
  /** Where the current queue came from (crate/album/artist/allSongs); drives Smart Shuffle's
   *  candidate-pool scoping. Set explicitly by playTrack/playContext on every call, never
   *  carried over, so switching context always clears stale scope. */
  queueSource: QueueSource | null;
  /** Every track id played this "lap" (most recent first, uncapped) — passed to Smart Shuffle
   *  as its exclude list so no track repeats until every other eligible track has played once.
   *  Cleared by resetRecentlyPlayed once Smart Shuffle exhausts the pool and needs to start a
   *  new lap. */
  recentlyPlayed: number[];
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
  /** Selects a track; re-clicking the already-current track toggles play/pause instead of restarting it.
   *  `source` describes where queueContext came from (crate/album/artist/allSongs); omit for
   *  ad-hoc queues (e.g. a single track with no list context). */
  playTrack: (track: TrackSummary, queueContext?: TrackSummary[], source?: QueueSource) => void;
  /** Plays a list from the start, or from a random track when shuffle is on. */
  playContext: (tracks: TrackSummary[], source?: QueueSource) => void;
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
  toggleSmartShuffle: () => void;
  /** Splices a Smart Shuffle suggestion in as the track right after `afterTrackId`, if that's
   *  still the current track and smart shuffle is still on (guards against a stale/late response
   *  landing after the user skipped elsewhere or turned smart shuffle off). See
   *  components/shell/useSmartShuffle.ts for the caller. */
  setSmartUpcoming: (afterTrackId: number, track: TrackSummary) => void;
  /** Starts a new Smart Shuffle lap: called once the candidate pool is exhausted (every
   *  eligible track has already played), so recommendations can start repeating again. Keeps
   *  only the currently-playing track excluded. See components/shell/useSmartShuffle.ts. */
  resetRecentlyPlayed: (currentTrackId: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  /** Drops every occurrence of a library track from the queue (used when removing from the library). */
  removeTrackById: (id: number) => void;
  /** Refresh cover URLs in the live queue after a tag/cover edit. */
  updateTrackCover: (trackId: number, coverArtUrl: string) => void;
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
    if (!hasCredentials()) return; // nothing to persist to before the standalone app is paired
    void putPlaybackState({
      queue: s.queue.map((t) => t.id),
      currentIndex: s.currentIndex,
      isPlaying: s.isPlaying,
      volume: s.volume,
      repeatMode: s.repeatMode,
      shuffleMode: s.shuffleMode,
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
  shuffleMode: "off",
  queueSource: null,
  recentlyPlayed: [],
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
    if (!hasCredentials()) {
      set({ hydrated: true }); // standalone, not paired yet — nothing to fetch
      return;
    }
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
        shuffleMode: data.shuffleMode,
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

  playTrack: (track, queueContext, source) => {
    const { currentTrack, isPlaying, shuffleMode } = get();
    useTransportSourceStore.getState().setActiveSource("regular");
    if (currentTrack?.id === track.id) {
      const next = !isPlaying;
      if (next) {
        useDjStore.getState().setDjPlaying(false);
        useMixtapePlayerStore.getState().setMixtapePlaying(false);
      }
      set({ isPlaying: next });
      schedulePersist(get);
      return;
    }
    useDjStore.getState().setDjPlaying(false);
    useMixtapePlayerStore.getState().setMixtapePlaying(false);
    const sourceQueue = queueContext && queueContext.length > 0 ? [...queueContext] : [track];
    let queue = [...sourceQueue];
    let currentIndex = queue.findIndex((t) => t.id === track.id);
    if (currentIndex < 0) currentIndex = 0;
    if (shuffleMode === "random") {
      const shuffled = shuffledQueueFrom(queue, currentIndex);
      queue = shuffled.queue;
      currentIndex = shuffled.currentIndex;
    }
    set({
      currentTrack: track,
      queue,
      sourceQueue,
      currentIndex,
      queueSource: source ?? null,
      recentlyPlayed: pushRecentlyPlayed(get().recentlyPlayed, track.id),
      isPlaying: true,
      currentTime: 0,
      pendingSeekSeconds: null,
    });
    schedulePersist(get);
  },

  playContext: (tracks, source) => {
    if (tracks.length === 0) return;
    const startIndex = get().shuffleMode === "random" ? Math.floor(Math.random() * tracks.length) : 0;
    get().playTrack(tracks[startIndex], tracks, source);
  },

  enqueue: (tracksToAdd) => {
    if (tracksToAdd.length === 0) return;
    const { queue, sourceQueue, currentTrack, currentIndex, shuffleMode } = get();
    const nextSource = [...sourceQueue, ...tracksToAdd];
    if (!currentTrack) {
      // Nothing playing: queuing starts playback, matching common player UX.
      useTransportSourceStore.getState().setActiveSource("regular");
      useDjStore.getState().setDjPlaying(false);
      useMixtapePlayerStore.getState().setMixtapePlaying(false);
      const nextQueue = shuffleMode === "random" ? shuffleInPlace([...tracksToAdd]) : [...tracksToAdd];
      set({
        currentTrack: nextQueue[0],
        queue: nextQueue,
        sourceQueue: [...tracksToAdd],
        currentIndex: 0,
        recentlyPlayed: pushRecentlyPlayed(get().recentlyPlayed, nextQueue[0].id),
        isPlaying: true,
        currentTime: 0,
        pendingSeekSeconds: null,
      });
    } else if (shuffleMode === "random") {
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
    const next = !get().isPlaying;
    if (next) useDjStore.getState().setDjPlaying(false);
    set({ isPlaying: next });
    schedulePersist(get);
  },

  setPlaying: (playing) => {
    if (playing) {
      useDjStore.getState().setDjPlaying(false);
      useMixtapePlayerStore.getState().setMixtapePlaying(false);
    }
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
    useTransportSourceStore.getState().setActiveSource("regular");
    let nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      if (repeatMode !== "all") {
        set({ isPlaying: false });
        schedulePersist(get);
        return;
      }
      nextIndex = 0;
    }
    useDjStore.getState().setDjPlaying(false);
    useMixtapePlayerStore.getState().setMixtapePlaying(false);
    set({
      currentIndex: nextIndex,
      currentTrack: queue[nextIndex],
      recentlyPlayed: pushRecentlyPlayed(get().recentlyPlayed, queue[nextIndex].id),
      isPlaying: true,
      currentTime: 0,
      pendingSeekSeconds: null,
    });
    schedulePersist(get);
  },

  playPrevious: () => {
    const { queue, currentIndex, repeatMode } = get();
    if (queue.length === 0) return;
    useTransportSourceStore.getState().setActiveSource("regular");
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      if (repeatMode !== "all") {
        prevIndex = 0;
      } else {
        prevIndex = queue.length - 1;
      }
    }
    useDjStore.getState().setDjPlaying(false);
    useMixtapePlayerStore.getState().setMixtapePlaying(false);
    set({
      currentIndex: prevIndex,
      currentTrack: queue[prevIndex],
      recentlyPlayed: pushRecentlyPlayed(get().recentlyPlayed, queue[prevIndex].id),
      isPlaying: true,
      currentTime: 0,
      pendingSeekSeconds: null,
    });
    schedulePersist(get);
  },

  playFromQueue: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    useTransportSourceStore.getState().setActiveSource("regular");
    useDjStore.getState().setDjPlaying(false);
    useMixtapePlayerStore.getState().setMixtapePlaying(false);
    set({
      currentIndex: index,
      currentTrack: queue[index],
      recentlyPlayed: pushRecentlyPlayed(get().recentlyPlayed, queue[index].id),
      isPlaying: true,
      currentTime: 0,
      pendingSeekSeconds: null,
    });
    schedulePersist(get);
  },

  toggleRepeatMode: () => {
    set((s) => ({ repeatMode: s.repeatMode === "off" ? "all" : s.repeatMode === "all" ? "one" : "off" }));
    schedulePersist(get);
  },

  // Shuffle rebuilds play order from the unshuffled source (current track stays put). Toggling
  // off restores that source order so Up Next updates immediately without stopping playback.
  toggleShuffle: () => {
    const { shuffleMode, queue, sourceQueue, currentIndex } = get();
    const source = sourceQueue.length > 0 ? sourceQueue : queue;
    const current = queue[currentIndex] ?? source[currentIndex] ?? null;
    if (!current) {
      set({ shuffleMode: shuffleMode === "random" ? "off" : "random" });
      schedulePersist(get);
      return;
    }
    const sourceIndex = Math.max(0, source.findIndex((t) => t.id === current.id));
    if (shuffleMode !== "random") {
      const shuffled = shuffledQueueFrom(source, sourceIndex >= 0 ? sourceIndex : 0);
      set({ queue: shuffled.queue, currentIndex: shuffled.currentIndex, shuffleMode: "random" });
    } else {
      const restoredIndex = sourceIndex >= 0 ? sourceIndex : 0;
      set({ queue: [...source], currentIndex: restoredIndex, shuffleMode: "off" });
    }
    schedulePersist(get);
  },

  // Smart Shuffle and random Shuffle are mutually exclusive UX-wise (both answer "what plays
  // next"), so turning one on always turns the other off. Same source-order-restore shape as
  // toggleShuffle's off-path -- dropping any smart-suggested track spliced in past the current
  // one, since it was chosen for a mode we're now leaving.
  toggleSmartShuffle: () => {
    const { shuffleMode, queue, sourceQueue, currentIndex } = get();
    const source = sourceQueue.length > 0 ? sourceQueue : queue;
    const current = queue[currentIndex] ?? source[currentIndex] ?? null;
    if (!current) {
      set({ shuffleMode: shuffleMode === "smart" ? "off" : "smart" });
      schedulePersist(get);
      return;
    }
    const sourceIndex = Math.max(0, source.findIndex((t) => t.id === current.id));
    if (shuffleMode === "smart") {
      const restoredIndex = sourceIndex >= 0 ? sourceIndex : 0;
      set({ queue: [...source], currentIndex: restoredIndex, shuffleMode: "off" });
    } else {
      const restoredIndex = sourceIndex >= 0 ? sourceIndex : 0;
      set({ queue: [...source], currentIndex: restoredIndex, shuffleMode: "smart" });
    }
    schedulePersist(get);
  },

  setSmartUpcoming: (afterTrackId, track) => {
    const { currentTrack, shuffleMode, queue, sourceQueue, currentIndex } = get();
    if (currentTrack?.id !== afterTrackId || shuffleMode !== "smart") return; // stale response
    if (track.id === currentTrack.id) return; // never queue the currently-playing track as itself
    const nextQueue = queue.slice();
    if (currentIndex + 1 < nextQueue.length) {
      nextQueue[currentIndex + 1] = track;
    } else {
      nextQueue.push(track);
    }
    const nextSource = sourceQueue.slice();
    if (currentIndex + 1 < nextSource.length) {
      nextSource[currentIndex + 1] = track;
    } else {
      nextSource.push(track);
    }
    set({ queue: nextQueue, sourceQueue: nextSource });
    schedulePersist(get);
  },

  resetRecentlyPlayed: (currentTrackId) => {
    set({ recentlyPlayed: [currentTrackId] });
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

    const sourceQueue = get().shuffleMode === "random" ? get().sourceQueue : newQueue;
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

  removeTrackById: (id) => {
    const indexes: number[] = [];
    get().queue.forEach((track, index) => {
      if (track.id === id) indexes.push(index);
    });
    for (let i = indexes.length - 1; i >= 0; i--) {
      get().removeFromQueue(indexes[i]);
    }
  },

  updateTrackCover: (trackId, coverArtUrl) => {
    const patch = (track: TrackSummary) => (track.id === trackId ? { ...track, coverArtUrl } : track);
    const current = get().currentTrack;
    set({
      currentTrack: current ? patch(current) : current,
      queue: get().queue.map(patch),
      sourceQueue: get().sourceQueue.map(patch),
    });
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
    if (!get().hydrated || !hasCredentials()) return;
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
