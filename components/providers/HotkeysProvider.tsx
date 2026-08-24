"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCommandPaletteStore } from "@/lib/store/commandPalette";
import { usePlayerStore } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";

function shouldIgnoreHotkey(target: EventTarget | null, allowFromInputs: boolean): boolean {
  if (allowFromInputs) return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest("input, textarea, select, button, a, [role='button'], [role='slider'], [role='radio'], [role='switch']")
  );
}

export function HotkeysProvider() {
  const router = useRouter();
  const lastVolumeRef = useRef(1);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const settings = useSettingsStore.getState();
      const player = usePlayerStore.getState();

      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        router.push("/settings");
        return;
      }

      if (!settings.hotkeysEnabled) return;
      if (useCommandPaletteStore.getState().isOpen) return;
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      if (shouldIgnoreHotkey(e.target, false)) return;

      if (e.key === "Escape") {
        if (player.isNowPlayingOpen && player.isQueueOpen) {
          e.preventDefault();
          player.closeQueue();
          return;
        }
        if (player.isNowPlayingOpen) {
          e.preventDefault();
          player.closeNowPlaying();
          return;
        }
        if (player.isQueueOpen) {
          e.preventDefault();
          player.closeQueue();
        }
        return;
      }

      if (e.key === " " && !e.repeat) {
        e.preventDefault();
        player.togglePlay();
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) player.playPrevious();
        else player.seekTo(player.currentTime - settings.seekStep);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) player.playNext();
        else player.seekTo(player.currentTime + settings.seekStep);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        player.setVolume(Math.min(1, player.volume + 0.05));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        player.setVolume(Math.max(0, player.volume - 0.05));
        return;
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        if (player.volume > 0) {
          lastVolumeRef.current = player.volume;
          player.setVolume(0);
        } else {
          player.setVolume(lastVolumeRef.current > 0 ? lastVolumeRef.current : 1);
        }
        return;
      }
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        player.toggleQueue();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        if (player.isNowPlayingOpen) player.closeNowPlaying();
        else if (player.currentTrack) player.openNowPlaying();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return null;
}
