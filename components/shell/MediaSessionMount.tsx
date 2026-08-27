"use client";

import { useEffect } from "react";
import { startMediaSession } from "@/lib/player/mediaSession";

// Thin lifecycle wrapper for the framework-free lib/player/mediaSession.ts controller. Mounted
// once per app (both layouts), alongside SettingsProvider. Reads the playback stores directly —
// it needs no audio-element ref, since seeks it issues flow through the same
// usePlayerStore.seekTo / useDjStore.seekTo the engines already consume.
export function MediaSessionMount() {
  useEffect(() => {
    const controller = startMediaSession();
    return () => controller.stop();
  }, []);
  return null;
}
