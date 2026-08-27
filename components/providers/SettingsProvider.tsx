"use client";

import { useEffect, useRef } from "react";
import { withAuthQuery } from "@/lib/api/http";
import { useSettingsStore } from "@/lib/store/settings";
import { usePlayerStore } from "@/lib/store/player";

export function SettingsProvider() {
  const hydrateFromDom = useSettingsStore((s) => s.hydrateFromDom);
  const showTrackInTitle = useSettingsStore((s) => s.showTrackInTitle);
  const trackNotifications = useSettingsStore((s) => s.trackNotifications);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const notifiedIdRef = useRef<number | null>(null);

  useEffect(() => {
    hydrateFromDom();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run exactly once on mount
  }, []);

  useEffect(() => {
    if (!showTrackInTitle || !currentTrack) return;
    const previous = document.title;
    const title = currentTrack.title ?? "Untitled";
    const artist = currentTrack.artistName ?? "Unknown artist";
    document.title = `${isPlaying ? "▶ " : ""}${title} · ${artist}`;
    return () => {
      document.title = previous;
    };
  }, [showTrackInTitle, currentTrack, isPlaying]);

  useEffect(() => {
    if (!currentTrack) return;
    if (notifiedIdRef.current == null) {
      notifiedIdRef.current = currentTrack.id;
      return;
    }
    if (notifiedIdRef.current === currentTrack.id) return;
    notifiedIdRef.current = currentTrack.id;
    if (!trackNotifications || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted" || !document.hidden) return;
    try {
      const n = new Notification(currentTrack.title ?? "Untitled", {
        body: currentTrack.artistName ?? "Unknown artist",
        silent: true,
        icon: currentTrack.coverArtUrl ? withAuthQuery(currentTrack.coverArtUrl) : undefined,
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // Some browsers reject Notification construction even after a grant.
    }
  }, [currentTrack, trackNotifications]);

  // navigator.mediaSession (lock screen / notification / media keys) lives in its own
  // source-aware controller — see lib/player/mediaSession.ts, mounted via MediaSessionMount.

  return null;
}
