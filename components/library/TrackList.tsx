"use client";

import Link from "next/link";
import { formatDate, formatDuration, formatRate } from "@/lib/format/track";
import type { TrackSort, TrackSummary } from "@/lib/api-client";
import { usePlayerStore, type QueueSource } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";
import { PlayingIcon } from "@/components/shell/PlayerIcons";
import { TrackRowActions } from "./TrackRowActions";

interface TrackListProps {
  tracks: TrackSummary[];
  sort?: TrackSort;
  onSortChange?: (sort: TrackSort) => void;
  /** Where this list is being shown (crate/album/artist/allSongs) — passed through to
   *  playTrack so Smart Shuffle knows what scope to suggest within. */
  source?: QueueSource;
}

export function TrackList({ tracks, sort, onSortChange, source }: TrackListProps) {
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const showFormatBadges = useSettingsStore((s) => s.showFormatBadges);
  const columns = showFormatBadges
    ? "grid-cols-[32px_1fr_200px_100px_120px_84px_64px_32px]"
    : "grid-cols-[32px_1fr_200px_100px_84px_64px_32px]";

  return (
    <div>
      <div className="flex flex-col md:hidden">
        {tracks.map((track) => {
          const isCurrent = track.id === currentTrackId;
          return (
            <div key={track.id} className="group relative -mx-10 overflow-hidden">
              <div
                onClick={() => !track.missing && playTrack(track, tracks, source)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !track.missing) {
                    e.preventDefault();
                    playTrack(track, tracks, source);
                  }
                }}
                role="button"
                tabIndex={track.missing ? -1 : 0}
                aria-label={`Play ${track.title ?? "Untitled"}`}
                className={`flex items-center justify-between gap-3 bg-bg px-10 py-3 ${
                  track.missing ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                } ${isCurrent ? "bg-[var(--lf-tint)]" : ""}`}
                title={track.missing ? "File missing on disk" : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm ${isCurrent ? "text-playing" : "text-t1"}`}>{track.title ?? "Untitled"}</p>
                  <p className="truncate font-mono text-xs text-t3">{track.artistName}</p>
                </div>
                <TrackRowActions track={track} alwaysVisible />
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden md:block">
      <div className={`mb-2 grid ${columns} gap-3 border-b border-line px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-t3`}>
        <span>#</span>
        <SortHeader label="Title" ascKey="title_asc" descKey="title_desc" sort={sort} onSortChange={onSortChange} />
        <SortHeader label="Album" ascKey="album_asc" descKey="album_desc" sort={sort} onSortChange={onSortChange} />
        <SortHeader
          label="Date Added"
          ascKey="date_added_asc"
          descKey="date_added_desc"
          defaultDesc
          sort={sort}
          onSortChange={onSortChange}
        />
        {showFormatBadges ? <span>Format</span> : null}
        <span>Rate</span>
        <span className="flex justify-end">
          <SortHeader
            label="Time"
            ascKey="duration_asc"
            descKey="duration_desc"
            defaultDesc
            align="right"
            sort={sort}
            onSortChange={onSortChange}
          />
        </span>
        <span aria-hidden />
      </div>
      {tracks.map((track, i) => {
        const isCurrent = track.id === currentTrackId;
        return (
          <div
            key={track.id}
            onClick={() => !track.missing && playTrack(track, tracks, source)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !track.missing) {
                e.preventDefault();
                playTrack(track, tracks, source);
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
            <span className="truncate font-mono text-xs text-t3">{formatDate(track.dateAdded)}</span>
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
    </div>
  );
}

function SortHeader({
  label,
  ascKey,
  descKey,
  defaultDesc,
  align,
  sort,
  onSortChange,
}: {
  label: string;
  ascKey: TrackSort;
  descKey: TrackSort;
  defaultDesc?: boolean;
  align?: "right";
  sort?: TrackSort;
  onSortChange?: (sort: TrackSort) => void;
}) {
  if (!onSortChange) return <span>{label}</span>;

  const isAsc = sort === ascKey;
  const isDesc = sort === descKey;
  const isActive = isAsc || isDesc;

  return (
    <button
      type="button"
      onClick={() => onSortChange(isActive ? (isDesc ? ascKey : descKey) : defaultDesc ? descKey : ascKey)}
      className={`inline-flex items-center gap-1 hover:text-t1 ${isActive ? "text-t1" : ""} ${
        align === "right" ? "flex-row-reverse" : ""
      }`}
    >
      <span>{label}</span>
      <span aria-hidden className={isActive ? "" : "invisible"}>
        {isDesc ? "▾" : "▴"}
      </span>
    </button>
  );
}
