"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format/track";
import type { WaveformData } from "@/lib/waveform/parse";

interface WaveformScrubberProps {
  waveform: WaveformData | null;
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  disabled: boolean;
}

/** Waveform-bar seek scrubber rendered from .lfpk peak data (ARCHITECTURE.md M4) — canvas-drawn, not a flat progress bar. */
export function WaveformScrubber({ waveform, currentTime, duration, onSeek, disabled }: WaveformScrubberProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);

  const playedRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const style = getComputedStyle(container);
    const playedColor = style.getPropertyValue("--lf-playing").trim() || "#8A5CF0";
    const unplayedColor = style.getPropertyValue("--lf-t3").trim() || "#6A6478";

    if (!waveform || waveform.peakCount === 0) {
      ctx.fillStyle = unplayedColor;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(0, height / 2 - 1, width, 2);
      ctx.globalAlpha = 1;
      return;
    }

    const centerY = height / 2;
    const { peakCount, mins, maxs } = waveform;
    const playedCount = Math.floor(playedRatio * peakCount);

    for (let x = 0; x < width; x++) {
      const peakIndex = Math.min(peakCount - 1, Math.floor((x / width) * peakCount));
      const min = mins[peakIndex];
      const max = maxs[peakIndex];
      const top = centerY - Math.max(max, 0.04) * centerY;
      const bottom = centerY - Math.min(min, -0.04) * centerY;
      ctx.fillStyle = peakIndex < playedCount ? playedColor : unplayedColor;
      ctx.globalAlpha = peakIndex < playedCount ? 1 : 0.55;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
    ctx.globalAlpha = 1;
  }, [waveform, playedRatio]);

  const ratioFromClientX = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ratio = ratioFromClientX(e.clientX);
    setHoverRatio(ratio);
    onSeek(ratio * duration);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    const ratio = ratioFromClientX(e.clientX);
    setHoverRatio(ratio);
    if (draggingRef.current) onSeek(ratio * duration);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="flex flex-1 items-center gap-3">
      <span className="w-12 shrink-0 text-right font-mono text-sm text-t3">{formatDuration(currentTime)}</span>
      <div
        ref={containerRef}
        className={`relative h-10 flex-1 ${disabled ? "cursor-default" : "cursor-pointer"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => !draggingRef.current && setHoverRatio(null)}
      >
        <canvas ref={canvasRef} className="h-full w-full" />
        {hoverRatio !== null && duration > 0 && (
          <div
            className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-md border border-line bg-surf-2 px-1.5 py-0.5 font-mono text-[11px] text-t1 shadow-[var(--lf-shadow)]"
            style={{ left: `${hoverRatio * 100}%` }}
          >
            {formatDuration(hoverRatio * duration)}
          </div>
        )}
      </div>
      <span className="w-12 shrink-0 font-mono text-sm text-t3">{formatDuration(duration)}</span>
    </div>
  );
}
