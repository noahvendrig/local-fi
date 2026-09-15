"use client";

import type { PlaylistTrackItem } from "@/lib/api/playlistsClient";
import { formatDuration } from "@/lib/format/track";
import { useAiDjStore } from "@/lib/store/aiDj";
import { FormatBadge } from "@/components/library/FormatBadge";
import { PlayingIcon } from "@/components/shell/PlayerIcons";
import { CamelotKeyBadge } from "../dj/CamelotKeyBadge";
import { PrepStatusBadge } from "./PrepStatusBadge";

const GRID_COLS = "20px 1fr 84px 52px 96px 62px 140px";

export function AiDjTracklist({ order, skippedCount }: { order: PlaylistTrackItem[]; skippedCount: number }) {
  const currentIndex = useAiDjStore((s) => s.currentIndex);
  const isPlaying = useAiDjStore((s) => s.isPlaying);

  return (
    <div className="px-8 pb-8">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-t3">Set order</span>
        <span className="font-mono text-[11px] text-t3">
          sequenced by tempo/key compatibility
          {skippedCount > 0 ? ` · ${skippedCount} track${skippedCount === 1 ? "" : "s"} skipped (no BPM)` : ""}
        </span>
      </div>

      <div
        className="grid gap-3.5 border-b border-line px-3 pb-2 text-[10.5px] font-medium uppercase tracking-wide text-t3"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        <span>#</span>
        <span>Title</span>
        <span>Format</span>
        <span className="text-right">Time</span>
        <span>BPM</span>
        <span>Key</span>
        <span>Prep</span>
      </div>

      {order.map((track, i) => (
        <AiDjTrackRow key={track.entryId ?? track.id} track={track} index={i} isCurrent={i === currentIndex} isPlaying={isPlaying} />
      ))}
    </div>
  );
}

function AiDjTrackRow({ track, index, isCurrent, isPlaying }: { track: PlaylistTrackItem; index: number; isCurrent: boolean; isPlaying: boolean }) {
  const prepStatus = useAiDjStore((s) => s.prepStatus[track.id]);

  return (
    <div
      className={`grid items-center gap-3.5 border-b border-line px-3 py-[11px] last:border-b-0 ${isCurrent ? "bg-[var(--lf-tint)]" : ""}`}
      style={{ gridTemplateColumns: GRID_COLS }}
    >
      <span className="font-mono text-xs text-t3">{isCurrent && isPlaying ? <PlayingIcon /> : String(index + 1).padStart(2, "0")}</span>

      <div className="min-w-0">
        <div className={`truncate text-sm ${isCurrent ? "text-playing" : "text-t1"}`}>{track.title ?? "Untitled"}</div>
        <div className="truncate font-mono text-xs text-t3">{track.artistName}</div>
      </div>

      <span>
        <FormatBadge format={track.format} lossless={track.lossless} />
      </span>
      <span className="text-right font-mono text-xs text-t2">{formatDuration(track.durationSeconds)}</span>
      <span className="font-mono text-sm font-medium text-t1">{track.bpm ?? "—"}</span>
      <span>{track.key ? <CamelotKeyBadge camelotKey={track.key} /> : <span className="font-mono text-xs text-t3">—</span>}</span>
      <PrepStatusBadge status={prepStatus} />
    </div>
  );
}
