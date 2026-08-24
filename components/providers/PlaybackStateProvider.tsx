"use client";

import { useEffect } from "react";
import { usePlayerStore } from "@/lib/store/player";

/** Loads the persisted queue/position once on mount (ARCHITECTURE.md M5), after the auth token is set. */
export function PlaybackStateProvider() {
  const hydrate = usePlayerStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run exactly once on mount
  }, []);

  return null;
}
