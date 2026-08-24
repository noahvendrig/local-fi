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

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (!currentTrack) {
      session.metadata = null;
      return;
    }
    const artworkUrl = currentTrack.coverArtUrl
      ? `${window.location.origin}${withAuthQuery(currentTrack.coverArtUrl)}`
      : undefined;
    session.metadata = new MediaMetadata({
      title: currentTrack.title ?? "Untitled",
      artist: currentTrack.artistName ?? "Unknown artist",
      album: currentTrack.albumTitle ?? "",
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: "512x512" }] : [],
    });
    session.playbackState = isPlaying ? "playing" : "paused";
    session.setActionHandler("play", () => usePlayerStore.getState().setPlaying(true));
    session.setActionHandler("pause", () => usePlayerStore.getState().setPlaying(false));
    session.setActionHandler("previoustrack", () => usePlayerStore.getState().playPrevious());
    session.setActionHandler("nexttrack", () => usePlayerStore.getState().playNext());
    session.setActionHandler("seekbackward", () => {
      const s = usePlayerStore.getState();
      s.seekTo(s.currentTime - useSettingsStore.getState().seekStep);
    });
    session.setActionHandler("seekforward", () => {
      const s = usePlayerStore.getState();
      s.seekTo(s.currentTime + useSettingsStore.getState().seekStep);
    });
    session.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") usePlayerStore.getState().seekTo(details.seekTime);
    });
    return () => {
      session.setActionHandler("play", null);
      session.setActionHandler("pause", null);
      session.setActionHandler("previoustrack", null);
      session.setActionHandler("nexttrack", null);
      session.setActionHandler("seekbackward", null);
      session.setActionHandler("seekforward", null);
      session.setActionHandler("seekto", null);
    };
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const id = window.setInterval(() => {
      const track = usePlayerStore.getState().currentTrack;
      if (!track) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: Math.max(track.durationSeconds, 0),
          playbackRate: 1,
          position: Math.min(usePlayerStore.getState().currentTime, track.durationSeconds),
        });
      } catch {
        // setPositionState throws if duration/position are out of range in some browsers.
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [currentTrack?.id, isPlaying]);

  return null;
}
