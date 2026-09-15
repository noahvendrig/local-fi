"use client";

import { useAiDjStore } from "@/lib/store/aiDj";
import { usePlayerStore } from "@/lib/store/player";
import type { AiDjEngineController } from "./useAiDjEngine";

export function AiDjTransportControls({ engine }: { engine: AiDjEngineController }) {
  const isPlaying = useAiDjStore((s) => s.isPlaying);
  const isLoading = useAiDjStore((s) => s.isLoading);
  const deviceInfo = useAiDjStore((s) => s.deviceInfo);
  const order = useAiDjStore((s) => s.order);
  const currentIndex = useAiDjStore((s) => s.currentIndex);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);

  const hasNext = currentIndex < order.length - 1;

  return (
    <div className="lf-top mx-8 mb-6 flex items-center gap-5 rounded-xl border border-line bg-surf px-6 py-4">
      <button
        type="button"
        onClick={() => engine.togglePlayPause()}
        disabled={isLoading}
        aria-label={isPlaying ? "Pause" : "Play"}
        className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-acc text-on-acc disabled:opacity-50"
      >
        {isLoading ? <span className="lf-index-spin h-4 w-4 rounded-full border-2 border-on-acc/40 border-t-on-acc" /> : isPlaying ? "❚❚" : "▶"}
      </button>
      <button
        type="button"
        onClick={() => engine.skipNext()}
        disabled={!hasNext || isLoading}
        aria-label="Skip to next track"
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-line text-t2 hover:border-acc hover:text-t1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ⏭
      </button>

      <div className="h-8 w-px flex-none bg-line" />

      <div className="flex flex-none items-center gap-2" title="Volume">
        <span aria-hidden className="text-[13px] text-t3">
          🔊
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="AI DJ volume"
          className="h-2 w-24 accent-acc"
        />
      </div>

      <div className="flex-1" />

      {deviceInfo && (
        <span className="font-mono text-[11px] text-t3" title={deviceInfo.cudaDeviceName ?? undefined}>
          {deviceInfo.device === "cuda" ? `⚡ GPU · ${deviceInfo.cudaDeviceName ?? "CUDA"}` : deviceInfo.available ? "CPU" : "stems unavailable"}
        </span>
      )}
    </div>
  );
}
