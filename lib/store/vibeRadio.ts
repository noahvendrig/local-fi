import { create } from "zustand";

/** Vibe Radio's ephemeral session state — deliberately NOT part of usePlayerStore's persisted
 *  playback_state (that table's shuffle_mode has a DB-level CHECK constraint that would need a
 *  migration to extend, for a free-text prompt schedulePersist doesn't carry anyway). Modeled on
 *  Smart Shuffle's "what governs next-track selection" shape, not on useAiDjStore's heavier
 *  session store (stem-prep/beatmatch/AudioContext state is irrelevant to plain crossfade playback). */
function newSessionId(): string {
  return `vibe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface VibeRadioState {
  active: boolean;
  prompt: string | null;
  /** Opaque token, fresh on every start() — lets useVibeRadio.ts tell "first fill of this
   *  session" (use replaceUpcoming, discarding whatever was queued next) apart from a later
   *  replenishment batch (plain enqueue), without depending on whether a track happened to
   *  already be playing when Vibe Radio was started. */
  sessionId: string | null;
  /** Every track id already played or currently queued this session — passed as excludeIds so a
   *  later replenishment batch never repeats one, same "whole lap" shape as usePlayerStore's
   *  recentlyPlayed. */
  seenIds: number[];
  isFetching: boolean;
  error: string | null;

  start: (prompt: string, initialSeenIds: number[]) => void;
  stop: () => void;
  markSeen: (ids: number[]) => void;
  resetSeen: (keepId: number) => void;
  setFetching: (isFetching: boolean) => void;
  setError: (error: string | null) => void;
}

export const useVibeRadioStore = create<VibeRadioState>((set) => ({
  active: false,
  prompt: null,
  sessionId: null,
  seenIds: [],
  isFetching: false,
  error: null,

  start: (prompt, initialSeenIds) => set({ active: true, prompt, sessionId: newSessionId(), seenIds: initialSeenIds, error: null }),
  stop: () => set({ active: false, prompt: null, sessionId: null, seenIds: [], isFetching: false, error: null }),
  markSeen: (ids) => set((s) => ({ seenIds: [...s.seenIds, ...ids.filter((id) => !s.seenIds.includes(id))] })),
  resetSeen: (keepId) => set({ seenIds: [keepId] }),
  setFetching: (isFetching) => set({ isFetching }),
  setError: (error) => set({ error }),
}));
