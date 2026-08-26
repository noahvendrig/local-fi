"use client";

import Link from "next/link";
import { formatDuration, formatRate } from "@/lib/format/track";
import type { TrackSummary } from "@/lib/api-client";
import { usePlayerStore } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";
import { PlayingIcon } from "@/components/shell/PlayerIcons";
import { TrackRowActions } from "./TrackRowActions";

export function TrackList({ tracks }: { tracks: TrackSummary[] }) {
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const showFormatBadges = useSettingsStore((s) => s.showFormatBadges);
  const columns = showFormatBadges
    ? "grid-cols-[32px_1fr_200px_120px_84px_64px_32px]"
    : "grid-cols-[32px_1fr_200px_84px_64px_32px]";

  return (
    <div>
      <div className={`mb-2 grid ${columns} gap-3 border-b border-line px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-t3`}>
        <span>#</span>
        <span>Title</span>
        <span>Album</span>
        {showFormatBadges ? <span>Format</span> : null}
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
            className={`lf-track-row group grid ${columns} items-center gap-3 rounded-lg border border-transparent px-3 py-3 ${
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
                  className="inline-block max-w-full truncate font-mono text-xs text-t3 hover:text-acc-text max-md:pointer-events-none"
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
            {showFormatBadges ? (
              <span className={`truncate font-mono text-xs ${track.lossless ? "text-ok" : "text-warn"}`}>
                {track.format.toUpperCase()}
              </span>
            ) : null}
            <span className="font-mono text-xs text-t3">{formatRate(track)}</span>
            <span className="text-right font-mono text-xs text-t2">{formatDuration(track.durationSeconds)}</span>
            <TrackRowActions track={track} />
          </div>
        );
      })}
    </div>
  );
}
