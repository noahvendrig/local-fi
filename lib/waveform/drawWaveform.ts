// Shared canvas peak-drawing routine — extracted from components/shell/WaveformScrubber.tsx so
// components/mixtapes/MixtapeSegmentTimeline.tsx can draw the same min/max bars without coupling
// to WaveformScrubber's playback-engine/settings-store wiring.

export interface WaveformDrawOptions {
  width: number;
  height: number;
  peakCount: number;
  mins: ArrayLike<number>;
  maxs: ArrayLike<number>;
  /** Peaks before this ratio (0..1) of the track are drawn in `playedColor`; the rest in `unplayedColor`. */
  playedRatio: number;
  playedColor: string;
  unplayedColor: string;
}

export function drawWaveformPeaks(ctx: CanvasRenderingContext2D, opts: WaveformDrawOptions): void {
  const { width, height, peakCount, mins, maxs, playedRatio, playedColor, unplayedColor } = opts;
  if (peakCount === 0) return;

  const centerY = height / 2;
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
}
