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
    }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setDeviceInfo: (deviceInfo) => set({ deviceInfo }),
  setPrepStatus: (trackId, status) => set((s) => ({ prepStatus: { ...s.prepStatus, [trackId]: status } })),
  advanceToIndex: (index) => set({ currentIndex: index }),
  setTransition: (transition) => set({ transition }),
  setRuntimeAnchor: (runtimeAnchor) => set({ runtimeAnchor }),
}));
