"use client";

import { useEffect } from "react";
import { usePlayerStore } from "@/lib/store/player";

/** Loads the persisted queue/position once on mount (ARCHITECTURE.md M5), after the auth token is set.
 *  Also owns the sleep-timer timeout so it fires even if the transport bar remounts. */
export function PlaybackStateProvider() {
  const hydrate = usePlayerStore((s) => s.hydrate);
  const sleepEndsAt = usePlayerStore((s) => s.sleepEndsAt);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const clearSleepTimer = usePlayerStore((s) => s.clearSleepTimer);

  useEffect(() => {
    void hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run exactly once on mount
  }, []);

  useEffect(() => {
    if (sleepEndsAt == null) return;
    const wait = Math.max(0, sleepEndsAt - Date.now());
    const id = window.setTimeout(() => {
      setPlaying(false);
      clearSleepTimer();
    }, wait);
    return () => window.clearTimeout(id);
  }, [sleepEndsAt, setPlaying, clearSleepTimer]);

  return null;
}
