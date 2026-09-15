"use client";

import { useEffect } from "react";
import { fetchSmartSuggestion } from "@/lib/api/smartSuggestClient";
import { usePlayerStore } from "@/lib/store/player";

// Prefetches the Smart Shuffle suggestion as soon as a new track becomes current -- the same
// timing as usePlaybackEngine's own preloadUpcomingRef effect (both key off currentTrack?.id),
// so the network round-trip (Next.js -> python-backend) has the whole track's duration to
// complete before crossfade-begin or track-end need queue[currentIndex + 1] to be correct. If
// it's still in flight at that point, playback just falls through to whatever's already in the
// queue -- a graceful degrade, not a block, matching preloadUpcomingRef's own best-effort stance.
export function useSmartShuffle() {
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);

  useEffect(() => {
    if (shuffleMode !== "smart" || currentTrackId == null) return;
    let cancelled = false;

    void (async () => {
      const { queueSource, recentlyPlayed } = usePlayerStore.getState();
      const track = await fetchSmartSuggestion(currentTrackId, queueSource, recentlyPlayed);
      if (cancelled || !track) return;
      usePlayerStore.getState().setSmartUpcoming(currentTrackId, track);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentTrackId, shuffleMode]);
}
