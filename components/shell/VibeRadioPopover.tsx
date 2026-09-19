"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOllamaStatus } from "@/lib/api/vibeClient";
import { usePlayerStore } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";
import { useVibeRadioStore } from "@/lib/store/vibeRadio";
import { HoverTip } from "./IconButton";
import { VibeRadioIcon } from "./PlayerIcons";

/** Prompt-entry trigger + status popover for Vibe Radio (components/shell/useVibeRadio.ts does
 *  the actual queue-filling), mounted next to Shuffle/Smart Shuffle. Modeled on
 *  EqualizerPopover's open/close-ref pattern. */
export function VibeRadioPopover({ size = "lg" }: { size?: "lg" | "xl" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const active = useVibeRadioStore((s) => s.active);
  const prompt = useVibeRadioStore((s) => s.prompt);
  const isFetching = useVibeRadioStore((s) => s.isFetching);
  const error = useVibeRadioStore((s) => s.error);
  const startVibeRadio = useVibeRadioStore((s) => s.start);
  const ollamaModel = useSettingsStore((s) => s.ollamaModel);
  const setOllamaModel = useSettingsStore((s) => s.setOllamaModel);
  const statusQuery = useQuery({ queryKey: ["ollama-status"], queryFn: fetchOllamaStatus, enabled: isOpen });
  const models = statusQuery.data?.models ?? [];

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const start = () => {
    if (!draft.trim() || !ollamaModel) return;
    const { queue, recentlyPlayed } = usePlayerStore.getState();
    const initialSeenIds = [...new Set([...queue.map((t) => t.id), ...recentlyPlayed])];
    // Vibe Radio, random Shuffle, and Smart Shuffle all answer "what plays next" -- starting one
    // turns the others off (toggleShuffle/toggleSmartShuffle return the favor via
    // useVibeRadioStore.getState().stop(), see lib/store/player.ts).
    const { shuffleMode, toggleShuffle, toggleSmartShuffle } = usePlayerStore.getState();
    if (shuffleMode === "random") toggleShuffle();
    else if (shuffleMode === "smart") toggleSmartShuffle();
    startVibeRadio(draft.trim(), initialSeenIds);
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Vibe Radio"
        aria-expanded={isOpen}
        aria-pressed={active}
        className={`group relative flex ${size === "xl" ? "h-14 w-14" : "h-11 w-11"} shrink-0 items-center justify-center rounded-md ${active ? "text-acc-text" : "text-t2"} hover:bg-surf-2 hover:text-t1`}
      >
        <VibeRadioIcon size={size === "xl" ? 36 : 24} />
        <HoverTip text="Vibe Radio" />
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Vibe Radio"
          className="absolute right-0 bottom-full z-40 mb-3 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surf px-4 pt-3.5 pb-4 shadow-[var(--lf-shadow)]"
          style={{ animation: "lfrise 180ms cubic-bezier(.22,1.3,.4,1)" }}
        >
          <p className="text-[11px] font-semibold tracking-[0.06em] text-t1 uppercase">Vibe Radio</p>

          {ollamaModel && models.length > 1 ? (
            <label className="mt-2 flex items-center gap-2 text-[11px] text-t2">
              Model (testing)
              <select
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                className="rounded-md border border-line bg-surf-2 px-1.5 py-1 text-[11px] text-t1"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {!ollamaModel ? (
            <p className="mt-2 text-xs text-t2">
              Choose a local LLM model in{" "}
              <Link href="/settings" className="text-acc-text hover:underline" onClick={() => setIsOpen(false)}>
                Settings
              </Link>{" "}
              first.
            </p>
          ) : active ? (
            <>
              <p className="mt-2 text-xs text-t2">Now playing for: “{prompt}”</p>
              <p className="mt-1 text-[11px] text-t3">Play a track from your library or crate to leave Vibe Radio.</p>
              {isFetching ? <p className="mt-1 text-[11px] text-t3">Finding more tracks…</p> : null}
              {error ? <p className="mt-1 text-[11px] text-err">{error}</p> : null}
            </>
          ) : (
            <>
              <textarea
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="upbeat 90s hip hop"
                className="mt-2 w-full resize-none rounded-md border border-line bg-surf-2 px-2 py-1.5 text-sm text-t1 placeholder:text-t3"
              />
              <button
                type="button"
                onClick={start}
                disabled={!draft.trim()}
                className="mt-2 w-full rounded-lg bg-acc px-3 py-1.5 text-xs font-medium text-on-acc hover:bg-acc-2 disabled:opacity-50"
              >
                Start Vibe Radio
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
