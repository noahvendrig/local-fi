"use client";

import Link from "next/link";
import { formatDuration, formatRate } from "@/lib/format/track";
import type { TrackSummary } from "@/lib/api-client";
import { usePlayerStore } from "@/lib/store/player";
import { useTagEditorStore } from "@/lib/store/tagEditor";
import { PlayingIcon } from "@/components/shell/PlayerIcons";

export function TrackList({ tracks }: { tracks: TrackSummary[] }) {
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const openTagEditor = useTagEditorStore((s) => s.open);

  return (
    <div>
      <div className="mb-2 grid grid-cols-[32px_1fr_200px_120px_84px_64px_32px] gap-3 border-b border-line px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-t3">
        <span>#</span>
        <span>Title</span>
        <span>Album</span>
        <span>Format</span>
        <span>Rate</span>
        <span className="text-right">Time</span>
        <span aria-hidden />
      </div>
      {tracks.map((track, i) => {
        const isCurrent = track.id === currentTrackId;
        return (
          <div
            key={track.id}
            onClick={() => !track.missing && playTrack(track, tracks)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !track.missing) {
                e.preventDefault();
                playTrack(track, tracks);
              }
            }}
            role="button"
            tabIndex={track.missing ? -1 : 0}
            aria-label={`Play ${track.title ?? "Untitled"}`}
            className={`group grid grid-cols-[32px_1fr_200px_120px_84px_64px_32px] items-center gap-3 rounded-lg border border-transparent px-3 py-3 ${
              track.missing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:border-line hover:bg-surf-2"
            } ${isCurrent ? "bg-[var(--lf-tint)]" : ""}`}
            title={track.missing ? "File missing on disk" : undefined}
          >
            <span className={`font-mono text-xs ${isCurrent ? "text-playing" : "text-t3"}`}>
              {isCurrent && isPlaying ? <PlayingIcon /> : String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <p className={`truncate text-sm leading-[1.5] ${isCurrent ? "text-playing" : "text-t1"}`}>
                {track.title ?? "Untitled"}
              </p>
              {track.artistId ? (
                <Link
                  href={`/artists/${track.artistId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="block truncate font-mono text-xs text-t3 hover:text-acc-text"
                >
                  {track.artistName}
                </Link>
              ) : (
                <span className="block truncate font-mono text-xs text-t3">{track.artistName}</span>
              )}
            </div>
            <span className="min-w-0 truncate text-sm text-t2">
              {track.albumId ? (
                <Link href={`/albums/${track.albumId}`} onClick={(e) => e.stopPropagation()} className="hover:text-acc-text">
                  {track.albumTitle ?? "—"}
                </Link>
              ) : (
                (track.albumTitle ?? "—")
              )}
            </span>
            <span className={`truncate font-mono text-xs ${track.lossless ? "text-ok" : "text-warn"}`}>
              {track.format.toUpperCase()}
            </span>
            <span className="font-mono text-xs text-t3">{formatRate(track)}</span>
            <span className="text-right font-mono text-xs text-t2">{formatDuration(track.durationSeconds)}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openTagEditor(track.id);
              }}
              aria-label="Edit tags"
              title="Edit tags"
              className="rounded-md p-1 text-t3 opacity-0 hover:bg-surf hover:text-t1 group-hover:opacity-100 focus:opacity-100"
            >
              <EditIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
