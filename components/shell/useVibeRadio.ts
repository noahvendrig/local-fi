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
    console.log("[VibeRadio] effect check", { active, prompt, ollamaModel, isFirstBatch, remaining, threshold: REPLENISH_THRESHOLD });
    if (!isFirstBatch && remaining >= REPLENISH_THRESHOLD) return;
    if (useVibeRadioStore.getState().isFetching) return;

    let cancelled = false;

    void (async () => {
      useVibeRadioStore.getState().setFetching(true);
      try {
        const { seenIds } = useVibeRadioStore.getState();
        console.log("[VibeRadio] requesting", { model: ollamaModel, prompt, excludeIds: seenIds, limit: BATCH_SIZE });
        let result = await selectVibeTracks(prompt, { model: ollamaModel, excludeIds: seenIds, limit: BATCH_SIZE });
        console.log(
          "[VibeRadio] response",
          result.tracks.map((t) => `${t.id}: ${t.title ?? "Untitled"} — ${t.artistName ?? "Unknown"}`),
          { usedFallback: result.usedFallback },
        );

        // No candidates left excluding everything already seen: start a new lap, same "reset and
        // retry once" shape as useSmartShuffle's pool-exhaustion handling.
        if (result.tracks.length === 0 && seenIds.length > 1 && currentTrackId != null && !cancelled) {
          useVibeRadioStore.getState().resetSeen(currentTrackId);
          console.log("[VibeRadio] pool exhausted, retrying with a fresh lap", { keepId: currentTrackId });
          result = await selectVibeTracks(prompt, { model: ollamaModel, excludeIds: [currentTrackId], limit: BATCH_SIZE });
          console.log(
            "[VibeRadio] retry response",
            result.tracks.map((t) => `${t.id}: ${t.title ?? "Untitled"} — ${t.artistName ?? "Unknown"}`),
            { usedFallback: result.usedFallback },
          );
        }

        if (cancelled) return;
        if (result.tracks.length === 0) {
          console.log("[VibeRadio] no candidates at all — nothing will play");
          useVibeRadioStore.getState().setError("Running out of matches for this vibe.");
          return;
        }

        useVibeRadioStore.getState().setError(null);
        useVibeRadioStore.getState().markSeen(result.tracks.map((t) => t.id));
        const { sessionId } = useVibeRadioStore.getState();
        if (sessionId != null && initializedSessionRef.current !== sessionId) {
          // First batch of this session: discard whatever was queued next and swap in the vibe picks.
          initializedSessionRef.current = sessionId;
          console.log("[VibeRadio] action: replaceUpcoming (first batch) — will play next:", result.tracks[0]?.title, "—", result.tracks[0]?.artistName);
          usePlayerStore.getState().replaceUpcoming(result.tracks);
        } else {
          console.log("[VibeRadio] action: enqueue (replenishment) — appended", result.tracks.length, "tracks");
          usePlayerStore.getState().enqueue(result.tracks);
        }
      } catch (err) {
        console.log("[VibeRadio] error", err);
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
