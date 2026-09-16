"use client";

import type { PlaylistTrackItem } from "@/lib/api/playlistsClient";
import { formatDuration } from "@/lib/format/track";
import { useAiDjStore } from "@/lib/store/aiDj";
import { FormatBadge } from "@/components/library/FormatBadge";
import { PlayingIcon } from "@/components/shell/PlayerIcons";
import { CamelotKeyBadge } from "../dj/CamelotKeyBadge";
import { PrepStatusBadge } from "./PrepStatusBadge";

const GRID_COLS = "20px 1fr 84px 52px 96px 62px 120px 110px";

/**
 * Browses this crate's whole BPM-known pool (not the live play order — see useAiDjStore.order for
 * that), so the user can pick what plays next at any point: "Play next" writes suggestedNextId,
 * which useAiDjEngine's decideNextTrack/applySuggestedNext picks up in preference to Smart Shuffle.
 * A track already played (or already locked in as next) can't be re-suggested.
 */
export function AiDjTracklist({ pool, skippedCount }: { pool: PlaylistTrackItem[]; skippedCount: number }) {
  const order = useAiDjStore((s) => s.order);
  const currentIndex = useAiDjStore((s) => s.currentIndex);
  const isPlaying = useAiDjStore((s) => s.isPlaying);
  const suggestedNextId = useAiDjStore((s) => s.suggestedNextId);

  const current = order[currentIndex];
  const decidedNext = order[currentIndex + 1];
  // Everything up to and including "current" has played (or is playing) — not eligible to be
  // suggested again. The decided-next track is deliberately left out of this set so it can still
  // be overridden by a fresh suggestion (see AiDjEngineController.applySuggestedNext).
  const playedIds = new Set(order.slice(0, currentIndex + 1).map((t) => t.id));

  return (
    <div className="px-8 pb-8">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-t3">Crate pool</span>
        <span className="font-mono text-[11px] text-t3">
          pick what plays next, or leave it to Smart Shuffle
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
        <span />
      </div>

      {pool.map((track, i) => (
        <AiDjTrackRow
          key={track.entryId ?? track.id}
          track={track}
          index={i}
          isCurrent={track.id === current?.id}
          isPlaying={isPlaying}
          isDecidedNext={track.id === decidedNext?.id}
          isPlayed={playedIds.has(track.id) && track.id !== current?.id}
          isSuggested={track.id === suggestedNextId}
          canSuggest={track.id !== current?.id && !playedIds.has(track.id)}
        />
      ))}
    </div>
  );
}

function AiDjTrackRow({
  track,
  index,
  isCurrent,
  isPlaying,
  isDecidedNext,
  isPlayed,
  isSuggested,
  canSuggest,
}: {
  track: PlaylistTrackItem;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  isDecidedNext: boolean;
  isPlayed: boolean;
  isSuggested: boolean;
  canSuggest: boolean;
}) {
  const prepStatus = useAiDjStore((s) => s.prepStatus[track.id]);

  return (
    <div
      className={`grid items-center gap-3.5 border-b border-line px-3 py-[11px] last:border-b-0 ${isCurrent ? "bg-[var(--lf-tint)]" : ""} ${isPlayed ? "opacity-50" : ""}`}
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

      {isDecidedNext ? (
        <span className="justify-self-start rounded-full border border-line px-2.5 py-1 font-mono text-[10.5px] text-t3">up next</span>
      ) : canSuggest ? (
        <button
          type="button"
          onClick={() => useAiDjStore.getState().setSuggestedNext(track.id)}
          disabled={isSuggested}
          className="justify-self-start rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-t2 hover:border-acc hover:text-t1 disabled:cursor-default disabled:opacity-60"
        >
          {isSuggested ? "queued…" : "▶ Play next"}
        </button>
      ) : null}
    </div>
  );
}
