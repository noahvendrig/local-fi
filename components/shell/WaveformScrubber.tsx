"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format/track";
import { getPlaybackEqualizer } from "@/lib/audio/equalizer";
import { useSettingsStore } from "@/lib/store/settings";
import type { WaveformData } from "@/lib/waveform/parse";

interface WaveformScrubberProps {
  waveform: WaveformData | null;
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  disabled: boolean;
}

// Seek scrubber shared by the transport bar and Now Playing overlay. Style (waveform vs
// thin bar vs live spectrum) and the right-hand time (duration vs remaining) come from settings.
export function WaveformScrubber({ waveform, currentTime, duration, onSeek, disabled }: WaveformScrubberProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const progressStyle = useSettingsStore((s) => s.progressStyle);
  const timeDisplay = useSettingsStore((s) => s.timeDisplay);
  const palette = useSettingsStore((s) => s.palette);
  const theme = useSettingsStore((s) => s.theme);

  const playedRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const remaining = Math.max(0, duration - currentTime);
  const endLabel = timeDisplay === "remaining" ? `-${formatDuration(remaining)}` : formatDuration(duration);

  useEffect(() => {
    if (progressStyle !== "waveform") return;
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const style = getComputedStyle(container);
    const playedColor = style.getPropertyValue("--lf-playing").trim() || "#C9A6FF";
    const unplayedColor = style.getPropertyValue("--lf-t3").trim() || "#6A6478";
    const idleColor = style.getPropertyValue("--lf-surf-2").trim() || "#221E2A";

    if (!waveform || waveform.peakCount === 0) {
      ctx.fillStyle = idleColor;
      ctx.fillRect(0, height / 2 - 1, width, 2);
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
  }, [waveform, playedRatio, progressStyle, palette, theme]);

  useEffect(() => {
    if (progressStyle !== "spectrum") return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const bins = new Uint8Array(128);
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const style = getComputedStyle(container);
      const playedColor = style.getPropertyValue("--lf-playing").trim() || "#C9A6FF";
      const idleColor = style.getPropertyValue("--lf-line").trim() || "#2E2939";
      const analyser = getPlaybackEqualizer().getAnalyser();
      if (analyser && analyser.frequencyBinCount === bins.length) {
        analyser.getByteFrequencyData(bins);
      } else {
        bins.fill(0);
      }

      const barCount = Math.max(24, Math.floor(width / 4));
      const gap = 1;
      const barWidth = Math.max(1, (width - gap * (barCount - 1)) / barCount);
      const usableBins = Math.floor(bins.length * 0.72);

      for (let i = 0; i < barCount; i++) {
        const binIndex = Math.min(usableBins - 1, Math.floor((i / barCount) * usableBins));
        const value = (bins[binIndex] ?? 0) / 255;
        const barHeight = Math.max(2, value * (height - 4));
        const x = i * (barWidth + gap);
        ctx.globalAlpha = 0.28 + value * 0.72;
        ctx.fillStyle = playedColor;
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = idleColor;
      ctx.fillRect(0, height - 2, width, 2);
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [progressStyle, palette, theme]);

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
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-disabled={disabled}
      >
        {progressStyle === "bar" ? (
          <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-playing" style={{ width: `${playedRatio * 100}%` }} />
          </div>
        ) : (
          <>
            <canvas ref={canvasRef} className="h-full w-full" />
            {progressStyle === "spectrum" ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-playing" style={{ width: `${playedRatio * 100}%` }} />
              </div>
            ) : null}
          </>
        )}
        {hoverRatio !== null && duration > 0 && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-acc-2"
              style={{ left: `${hoverRatio * 100}%` }}
            />
            <div
              className="pointer-events-none absolute bottom-[46px] -translate-x-1/2 rounded border border-line bg-bg px-2 py-1 font-mono text-[11px] text-t1 shadow-[var(--lf-shadow)]"
              style={{ left: `${hoverRatio * 100}%` }}
            >
              {formatDuration(hoverRatio * duration)}
            </div>
          </>
        )}
      </div>
      <span className="w-14 shrink-0 font-mono text-sm text-t3">{endLabel}</span>
    </div>
  );
}
