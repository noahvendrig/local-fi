import { create } from "zustand";
import type { ResolvedVibeFilter } from "@/lib/llm/vibeResolve";
import type { VibeTier } from "@/lib/llm/vibeScore";

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
  /** Opaque token, fresh on every start() — including a new prompt submitted while already
   *  running. Lets useVibeRadio.ts tell "first fill of this session" (use replaceUpcoming,
   *  discarding whatever was queued next so the next song follows the new prompt) apart from a
   *  later replenishment batch (plain enqueue), without depending on whether a track happened to
   *  already be playing when Vibe Radio was started. */
  sessionId: string | null;
  /** Every track id already played or currently queued this session — passed as excludeIds so a
   *  later replenishment batch never repeats one, same "whole lap" shape as usePlayerStore's
   *  recentlyPlayed. */
  seenIds: number[];
  isFetching: boolean;
  error: string | null;
  /** How the first batch of this session interpreted the prompt, echoed back on every later batch
   *  so Stage A runs once per session instead of once per batch. Beyond the saved Ollama round
   *  trip, this is what keeps a session's batches consistent: re-interpreting the same prompt can
   *  resolve it differently, which is how a "justin bieber" queue used to drift into other artists. */
  resolved: ResolvedVibeFilter | null;
  /** How loosely the latest batch had to match, for the popover's status line. */
  tier: VibeTier | null;

  /** Starts a session, or (when already active) re-interprets a new prompt for the next song
   *  without stopping the current track. Always mints a new sessionId so the first batch uses
   *  replaceUpcoming rather than enqueue. */
  start: (prompt: string, initialSeenIds: number[]) => void;
  stop: () => void;
  markSeen: (ids: number[]) => void;
  resetSeen: (keepId: number) => void;
  setFetching: (isFetching: boolean) => void;
  setError: (error: string | null) => void;
  setResolved: (resolved: ResolvedVibeFilter) => void;
  setTier: (tier: VibeTier) => void;
}

export const useVibeRadioStore = create<VibeRadioState>((set) => ({
  active: false,
  prompt: null,
  sessionId: null,
  seenIds: [],
  isFetching: false,
  error: null,
  resolved: null,
  tier: null,

  // A new session always re-interprets: the prompt may be different, and even the same prompt
  // deserves a fresh reading of a library that may have changed since. isFetching is cleared so a
  // prompt change mid-fetch is not skipped by useVibeRadio's in-flight guard after the previous
  // request is cancelled.
  start: (prompt, initialSeenIds) =>
    set({
      active: true,
      prompt,
      sessionId: newSessionId(),
      seenIds: initialSeenIds,
      isFetching: false,
      error: null,
      resolved: null,
      tier: null,
    }),
  stop: () => set({ active: false, prompt: null, sessionId: null, seenIds: [], isFetching: false, error: null, resolved: null, tier: null }),
  markSeen: (ids) => set((s) => ({ seenIds: [...s.seenIds, ...ids.filter((id) => !s.seenIds.includes(id))] })),
  resetSeen: (keepId) => set({ seenIds: [keepId] }),
  setFetching: (isFetching) => set({ isFetching }),
  setError: (error) => set({ error }),
  setResolved: (resolved) => set({ resolved }),
  setTier: (tier) => set({ tier }),
}));
