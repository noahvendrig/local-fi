import { create } from "zustand";
import type { TrackSummary } from "@/lib/api-client";
import { useTransportSourceStore } from "./transportSource";

/**
 * DJ-view session state: target BPM/key/octave for matching tracks in a crate's DJ view, plus the
 * single DJ-deck's current track/playback state. Deliberately separate from usePlayerStore and
 * not persisted to /playback-state — this is ephemeral per session, not something to restore
 * into a page load that never opens the DJ view. Regular playback (usePlayerStore,
 * usePlaybackEngine) is untouched by any of this. The bottom transport bar reads both stores
 * plus useTransportSourceStore to show whichever deck the user last selected — see
 * TransportBar's `djActive` logic.
 */
interface DjState {
  targetBpm: number | null;
  targetKey: string | null;
  /** Whole-octave shift relative to the track's original pitch (−2…+2). Applied with key lock. */
  targetOctave: number;
  keyLockEnabled: boolean;
  setTargetBpm: (bpm: number | null) => void;
  bumpTargetBpm: (delta: number) => void;
  setTargetKey: (key: string | null) => void;
  setTargetOctave: (octave: number) => void;
  bumpTargetOctave: (delta: number) => void;
  toggleKeyLock: () => void;

  currentTrack: TrackSummary | null;
  isPlaying: boolean;
  /** Selects a track on the DJ deck; re-clicking the already-loaded track toggles play/pause instead of restarting it. */
  playDjTrack: (track: TrackSummary) => void;
  setDjPlaying: (playing: boolean) => void;

  /** Mirrors the DJ deck's <audio> position, so the bottom transport bar can show live DJ progress. */
  currentTime: number;
  setCurrentTime: (seconds: number) => void;
  pendingSeekSeconds: number | null;
  seekTo: (seconds: number) => void;
  consumePendingSeek: () => void;
}

const OCTAVE_MIN = -2;
const OCTAVE_MAX = 2;

function clampOctave(octave: number): number {
  return Math.max(OCTAVE_MIN, Math.min(OCTAVE_MAX, Math.round(octave)));
}

export const useDjStore = create<DjState>((set, get) => ({
  targetBpm: null,
  targetKey: null,
  targetOctave: 0,
  keyLockEnabled: true,

  setTargetBpm: (bpm) => set({ targetBpm: bpm == null ? null : Math.max(20, Math.min(400, bpm)) }),
  bumpTargetBpm: (delta) =>
    set((s) => ({ targetBpm: Math.max(20, Math.min(400, (s.targetBpm ?? 120) + delta)) })),
  setTargetKey: (key) => set((s) => ({ targetKey: s.targetKey === key ? null : key })),
  setTargetOctave: (octave) => set({ targetOctave: clampOctave(octave) }),
  bumpTargetOctave: (delta) => set((s) => ({ targetOctave: clampOctave(s.targetOctave + delta) })),
  toggleKeyLock: () => set((s) => ({ keyLockEnabled: !s.keyLockEnabled })),

  currentTrack: null,
  isPlaying: false,
  playDjTrack: (track) => {
    const { currentTrack, isPlaying } = get();
    useTransportSourceStore.getState().setActiveSource("dj");
    if (currentTrack?.id === track.id) {
      set({ isPlaying: !isPlaying });
      return;
    }
    set({ currentTrack: track, isPlaying: true, currentTime: 0 });
  },
  setDjPlaying: (playing) => set({ isPlaying: playing }),

  currentTime: 0,
  setCurrentTime: (seconds) => set({ currentTime: seconds }),
  pendingSeekSeconds: null,
  seekTo: (seconds) => set({ pendingSeekSeconds: seconds, currentTime: seconds }),
  consumePendingSeek: () => set({ pendingSeekSeconds: null }),
}));
