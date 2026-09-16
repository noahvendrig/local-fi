import { create } from "zustand";
import type { PlaylistTrackItem } from "@/lib/api/playlistsClient";

export type AiDjPrepStatus = "idle" | "queued" | "separating" | "ready" | "fallback" | "failed";

export interface AiDjDeviceInfo {
  available: boolean;
  device: "cuda" | "cpu";
  cudaDeviceName: string | null;
}

export interface AiDjTransitionProgress {
  /** Shared AudioContext time the transition began. */
  startContextTime: number;
  totalDurationSec: number;
  fromTrackId: number;
  toTrackId: number;
  /** Whether this is a full beatmatched stem mashup, or a plain equal-power fallback crossfade. */
  kind: "mashup" | "fallback";
}

/**
 * AI DJ session state (components/crates/aidj/*): a crate's sequenced play order, playback
 * position, and per-track prep status for the JIT stem-separation pipeline. Deliberately
 * ephemeral and separate from useDjStore/usePlayerStore — nothing here is persisted or restored
 * across a page load, matching the "live playback only" design (see the AI DJ plan). The actual
 * Web Audio scheduling lives in useAiDjEngine.ts; this store only holds what the UI renders.
 */
/** Anchors mapping the shared AudioContext's clock to the currently-playing track's own,
 *  untouched-file-timeline position — lets any component (e.g. TransportBar) compute a live
 *  playback position without holding a reference to the engine controller. tempoRatio is that
 *  track's permanent targetBpm/ownBpm stretch factor (see useAiDjEngine.ts). */
export interface AiDjRuntimeAnchor {
  anchorContextTime: number;
  anchorPosition: number;
  tempoRatio: number;
}

/** The verified-safe loop phrase (see loopPointDetect's findLoopSection) the currently-playing
 *  track will transition through, in that track's own native (untouched-file) seconds — the same
 *  timeline as displayTrack.durationSeconds and the waveform scrubber's currentTime/duration, so
 *  no unit conversion is needed to draw it. Keyed by trackId so a consumer can ignore a stale
 *  region left over from a track that's no longer playing (e.g. after a skip) without the engine
 *  needing to race a clear against a track change. Null when no loop was found (or none planned
 *  yet), in which case the transition falls back to playing the track's own tail forward. */
export interface AiDjLoopRegion {
  trackId: number;
  startSec: number;
  endSec: number;
}

interface AiDjState {
  sessionId: string | null;
  playlistId: number | null;
  order: PlaylistTrackItem[];
  skippedCount: number;
  currentIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  deviceInfo: AiDjDeviceInfo | null;
  prepStatus: Record<number, AiDjPrepStatus>;
  transition: AiDjTransitionProgress | null;
  /** Session-wide tempo every track is locked to (see AGENTS.md-adjacent design note in
   *  transitionPlan.ts) — user-chosen at session start, prefilled from the first track's BPM. */
  targetBpm: number | null;
  runtimeAnchor: AiDjRuntimeAnchor | null;
  /** Set as soon as planOwnTransition finds a safe loop phrase for the current track — well
   *  before the transition actually reaches it — so the waveform bar can mark it ahead of time. */
  activeLoopRegion: AiDjLoopRegion | null;
  /** A track the user has picked (via a crate row's "play next" button) to play immediately after
   *  whatever's current — read (and cleared) by useAiDjEngine as soon as it's decided which track
   *  plays next, in preference to the smart-shuffle/tempo-key fallback. Null means "no user pick
   *  pending", not "no track is coming up next" (see order/currentIndex for that). */
  suggestedNextId: number | null;
  /** User-toggled: click on every detected beat (accented on downbeats) of whatever's currently
   *  playing, for judging the beat grid by ear. Persists across track changes/transitions within a
   *  session — useAiDjEngine reschedules clicks against the new current track each time. */
  metronomeEnabled: boolean;

  startSession: (playlistId: number, order: PlaylistTrackItem[], skippedCount: number, targetBpm: number) => void;
  stopSession: () => void;
  setPlaying: (playing: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setDeviceInfo: (info: AiDjDeviceInfo | null) => void;
  setPrepStatus: (trackId: number, status: AiDjPrepStatus) => void;
  advanceToIndex: (index: number) => void;
  setTransition: (transition: AiDjTransitionProgress | null) => void;
  setRuntimeAnchor: (anchor: AiDjRuntimeAnchor | null) => void;
  setActiveLoopRegion: (region: AiDjLoopRegion | null) => void;
  /** order is otherwise controller-owned (grown/rewritten one decision at a time as tracks are
   *  chosen), unlike the other setters here which just mirror simple playback state. */
  setOrder: (order: PlaylistTrackItem[]) => void;
  setSuggestedNext: (trackId: number | null) => void;
  setMetronomeEnabled: (enabled: boolean) => void;
}

function newSessionId(): string {
  return `aidj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useAiDjStore = create<AiDjState>((set) => ({
  sessionId: null,
  playlistId: null,
  order: [],
  skippedCount: 0,
  currentIndex: 0,
  isPlaying: false,
  isLoading: false,
  error: null,
  deviceInfo: null,
  prepStatus: {},
  transition: null,
  targetBpm: null,
  runtimeAnchor: null,
  activeLoopRegion: null,
  suggestedNextId: null,
  metronomeEnabled: false,

  startSession: (playlistId, order, skippedCount, targetBpm) =>
    set({
      sessionId: newSessionId(),
      playlistId,
      order,
      skippedCount,
      currentIndex: 0,
      isPlaying: false,
      isLoading: false,
      error: null,
      prepStatus: {},
      transition: null,
      targetBpm,
      runtimeAnchor: null,
      activeLoopRegion: null,
      suggestedNextId: null,
      metronomeEnabled: false,
    }),
  stopSession: () =>
    set({
      sessionId: null,
      playlistId: null,
      order: [],
      currentIndex: 0,
      isPlaying: false,
      isLoading: false,
      prepStatus: {},
      transition: null,
      targetBpm: null,
      runtimeAnchor: null,
      activeLoopRegion: null,
      suggestedNextId: null,
      metronomeEnabled: false,
    }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setDeviceInfo: (deviceInfo) => set({ deviceInfo }),
  setPrepStatus: (trackId, status) => set((s) => ({ prepStatus: { ...s.prepStatus, [trackId]: status } })),
  advanceToIndex: (index) => set({ currentIndex: index }),
  setTransition: (transition) => set({ transition }),
  setRuntimeAnchor: (runtimeAnchor) => set({ runtimeAnchor }),
  setActiveLoopRegion: (activeLoopRegion) => set({ activeLoopRegion }),
  setOrder: (order) => set({ order }),
  setMetronomeEnabled: (metronomeEnabled) => set({ metronomeEnabled }),
  setSuggestedNext: (suggestedNextId) => set({ suggestedNextId }),
}));
