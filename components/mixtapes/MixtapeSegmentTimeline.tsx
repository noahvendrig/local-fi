"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MixtapeSegment } from "@/lib/api/mixtapesClient";
import { mixtapeWaveformUrl } from "@/lib/api/mixtapesClient";
import { formatDuration } from "@/lib/format/track";
import { drawWaveformPeaks } from "@/lib/waveform/drawWaveform";
import { fetchWaveform, type WaveformData } from "@/lib/waveform/parse";

const HIGH_CONFIDENCE = 0.6;
const LANE_HEIGHT = 28;

interface Lane {
  segment: MixtapeSegment;
  lane: number;
}

/** Greedy interval-scheduling lane assignment — the minimum number of stacked rows needed so no
 *  two segments in the same row overlap in time. A crossfade's outgoing/incoming pair lands in
 *  two different lanes, rendered as visibly overlapping blocks rather than one clipping the other. */
function assignLanes(segments: MixtapeSegment[]): Lane[] {
  const sorted = [...segments].sort((a, b) => a.startSeconds - b.startSeconds);
  const laneEnds: number[] = [];
  const result: Lane[] = [];
  for (const segment of sorted) {
    let lane = laneEnds.findIndex((end) => end <= segment.startSeconds);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(segment.endSeconds);
    } else {
      laneEnds[lane] = segment.endSeconds;
    }
    result.push({ segment, lane });
  }
  return result;
}

function segmentColor(segment: MixtapeSegment): string {
  switch (segment.matchStatus) {
    case "manual":
      return "var(--lf-ok)";
    case "auto_matched":
      return (segment.confidenceScore ?? 0) >= HIGH_CONFIDENCE ? "var(--lf-acc)" : "var(--lf-warn, #C9A34D)";
    case "unrecognized":
    case "rejected":
    default:
      return "var(--lf-t3)";
  }
}

function segmentLabel(segment: MixtapeSegment): string {
  const range = `${formatDuration(segment.startSeconds)}–${formatDuration(segment.endSeconds)}`;
  if (segment.matchedTrack) {
    const confidence = segment.confidenceScore != null ? ` (${Math.round(segment.confidenceScore * 100)}%)` : "";
    return `${segment.matchedTrack.title ?? "Untitled"} — ${segment.matchedTrack.artistName ?? "Unknown artist"}${confidence} · ${range}`;
  }
  return `Unrecognized · ${range}`;
}

export function MixtapeSegmentTimeline({
  mixtapeId,
  durationSeconds,
  segments,
  currentTime,
  onSeek,
  onSegmentSeek,
}: {
  mixtapeId: number;
  durationSeconds: number;
  segments: MixtapeSegment[];
  currentTime: number;
  onSeek: (seconds: number) => void;
  /** Clicking a segment block skips playback to that segment (its start), rather than opening it for reassignment. */
  onSegmentSeek: (segment: MixtapeSegment) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveform, setWaveform] = useState<WaveformData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWaveform(mixtapeWaveformUrl(mixtapeId))
      .then((data) => {
        if (!cancelled) setWaveform(data);
      })
      .catch(() => {
        /* no waveform yet — draw the idle bar below */
      });
    return () => {
      cancelled = true;
    };
  }, [mixtapeId]);

  const lanes = useMemo(() => assignLanes(segments), [segments]);
  const laneCount = Math.max(1, lanes.reduce((max, l) => Math.max(max, l.lane + 1), 0));

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const style = getComputedStyle(container);
    const waveColor = style.getPropertyValue("--lf-t2").trim() || "#9A93A8";
    const idleColor = style.getPropertyValue("--lf-surf-2").trim() || "#221E2A";

    if (!waveform || waveform.peakCount === 0) {
      ctx.fillStyle = idleColor;
      ctx.fillRect(0, height / 2 - 1, width, 2);
      return;
    }

    drawWaveformPeaks(ctx, {
      width,
      height,
      peakCount: waveform.peakCount,
      mins: waveform.mins,
      maxs: waveform.maxs,
      playedRatio: 1,
      playedColor: waveColor,
      unplayedColor: waveColor,
    });
  }, [waveform]);

  const ratioFromClientX = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (durationSeconds <= 0) return;
    onSeek(ratioFromClientX(e.clientX) * durationSeconds);
  };

  const playedRatio = durationSeconds > 0 ? Math.min(1, currentTime / durationSeconds) : 0;

  return (
    <div className="w-full">
      <div ref={containerRef} className="relative w-full cursor-pointer" onClick={handleSeekClick}>
        <canvas ref={canvasRef} className="block h-20 w-full" />
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-acc-2"
          style={{ left: `${playedRatio * 100}%` }}
        />
      </div>
      <div className="relative mt-1 w-full" style={{ height: laneCount * LANE_HEIGHT }}>
        {lanes.map(({ segment, lane }) => {
          const left = durationSeconds > 0 ? (segment.startSeconds / durationSeconds) * 100 : 0;
          const width = durationSeconds > 0 ? ((segment.endSeconds - segment.startSeconds) / durationSeconds) * 100 : 0;
          return (
            <button
              key={segment.id}
              type="button"
              title={segmentLabel(segment)}
              onClick={(e) => {
                e.stopPropagation();
                onSegmentSeek(segment);
              }}
              className="absolute overflow-hidden rounded-[3px] border border-bg/40 px-1 text-left text-[10px] font-medium text-on-acc opacity-90 transition-opacity hover:opacity-100"
              style={{
                left: `${left}%`,
                width: `max(6px, ${width}%)`,
                top: lane * LANE_HEIGHT,
                height: LANE_HEIGHT - 4,
                background: segmentColor(segment),
              }}
            >
              <span className="truncate">{segment.matchedTrack?.title ?? "Unrecognized"}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-t3">
        <Legend color="var(--lf-acc)" label="Matched" />
        <Legend color="var(--lf-warn, #C9A34D)" label="Low confidence" />
        <Legend color="var(--lf-ok)" label="Manually assigned" />
        <Legend color="var(--lf-t3)" label="Unrecognized" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}
