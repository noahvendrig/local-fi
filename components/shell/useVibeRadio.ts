"use client";

import { useEffect, useRef } from "react";
import { selectVibeTracks, VibeSelectError } from "@/lib/api/vibeClient";
import { usePlayerStore } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";
import { useVibeRadioStore } from "@/lib/store/vibeRadio";

const REPLENISH_THRESHOLD = 3;
const BATCH_SIZE = 12;

// Keeps Vibe Radio's queue topped up. Fires on currentTrack/queue-depth changes (not track-end) --
// same timing rationale as useSmartShuffle.ts: usePlaybackEngine's crossfade needs
// queue[currentIndex + 1] populated several seconds before the current track ends, so a
// replenishment fetch needs the rest of the track's duration to land, not just its final moment.
export function useVibeRadio() {
  const active = useVibeRadioStore((s) => s.active);
  const prompt = useVibeRadioStore((s) => s.prompt);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const ollamaModel = useSettingsStore((s) => s.ollamaModel);
  // Which session's first batch has already used replaceUpcoming -- every batch after that one
  // uses plain enqueue(), regardless of whether a track happened to be playing when Vibe Radio
  // was started (see lib/store/vibeRadio.ts's sessionId doc comment).
  const initializedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !prompt || !ollamaModel) return;
    const { sessionId } = useVibeRadioStore.getState();
    // The session's first batch must run unconditionally -- it's what calls replaceUpcoming to
    // blow away whatever was already queued, so gating it on "is the (stale) queue already deep
    // enough" could skip it entirely when Vibe Radio is started mid-album/mid-crate with several
    // tracks already lined up, silently leaving the old queue in place.
    const isFirstBatch = sessionId != null && initializedSessionRef.current !== sessionId;
    const remaining = queueLength - currentIndex - 1;
    if (!isFirstBatch && remaining >= REPLENISH_THRESHOLD) return;
    // First-batch (new session or a new prompt while running) must not wait out an in-flight
    // replenishment: that request is for the previous prompt and gets cancelled on this effect's
    // cleanup. Gating it here would skip the replaceUpcoming swap until some later dep change.
    if (!isFirstBatch && useVibeRadioStore.getState().isFetching) return;

    let cancelled = false;

    void (async () => {
      useVibeRadioStore.getState().setFetching(true);
      try {
        // Read through getState() rather than a selector hook, the same way seenIds is read: this
        // effect's dep array would otherwise re-fire the instant the first batch stores `resolved`.
        const { seenIds, resolved } = useVibeRadioStore.getState();
        // useStageB: false on every batch -- the interpretation is settled by the time we get here,
        // and a second Ollama round trip per batch only adds drift and latency inside the crossfade
        // window this effect is racing.
        const request = { model: ollamaModel, limit: BATCH_SIZE, useStageB: false, sessionId: sessionId ?? undefined, resolved: resolved ?? undefined };
        let result = await selectVibeTracks(prompt, { ...request, excludeIds: seenIds });

        // No candidates left excluding everything already seen: start a new lap, same "reset and
        // retry once" shape as useSmartShuffle's pool-exhaustion handling. The resolved filter is
        // deliberately kept -- a new lap is the same request, not a new interpretation of it.
        if (result.tracks.length === 0 && seenIds.length > 1 && currentTrackId != null && !cancelled) {
          useVibeRadioStore.getState().resetSeen(currentTrackId);
          result = await selectVibeTracks(prompt, {
            ...request,
            excludeIds: [currentTrackId],
            resolved: resolved ?? result.resolved,
          });
        }

        if (cancelled) return;
        if (result.tracks.length === 0) {
          useVibeRadioStore.getState().setError("Running out of matches for this vibe.");
          return;
        }

        useVibeRadioStore.getState().setError(null);
        if (resolved == null) useVibeRadioStore.getState().setResolved(result.resolved);
        useVibeRadioStore.getState().setTier(result.tier);
        useVibeRadioStore.getState().markSeen(result.tracks.map((t) => t.id));
        const { sessionId: currentSessionId } = useVibeRadioStore.getState();
        if (currentSessionId != null && initializedSessionRef.current !== currentSessionId) {
          // First batch of this session: discard whatever was queued next and swap in the vibe picks.
          initializedSessionRef.current = currentSessionId;
          usePlayerStore.getState().replaceUpcoming(result.tracks);
        } else {
          usePlayerStore.getState().enqueue(result.tracks);
        }
      } catch (err) {
        if (!cancelled) {
          useVibeRadioStore.getState().setError(err instanceof VibeSelectError ? err.message : "Couldn't reach Ollama.");
        }
      } finally {
        if (!cancelled) useVibeRadioStore.getState().setFetching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, prompt, ollamaModel, currentTrackId, currentIndex, queueLength]);
}
