"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generateKeyBetween } from "fractional-indexing";
import { formatDate, formatDuration, formatRate } from "@/lib/format/track";
import { reorderPlaylistEntry, removePlaylistEntry, type PlaylistDetail, type PlaylistTrackItem } from "@/lib/api/playlistsClient";
import { usePlayerStore } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";
import { PlayingIcon } from "@/components/shell/PlayerIcons";
import { TrackCoverThumb } from "@/components/library/TrackCoverThumb";
import { AddTracksModal } from "./AddTracksModal";

export function ManualCrateTracklist({ playlist }: { playlist: PlaylistDetail }) {
  const queryClient = useQueryClient();
  const queryKey = ["playlist", playlist.id];

  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const showFormatBadges = useSettingsStore((s) => s.showFormatBadges);
  const columns = showFormatBadges
    ? "grid-cols-[24px_32px_1fr_200px_100px_120px_84px_64px_32px]"
    : "grid-cols-[24px_32px_1fr_200px_100px_84px_64px_32px]";

  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const reorderMutation = useMutation({
    mutationFn: ({ entryId, position }: { entryId: number; position: string }) => reorderPlaylistEntry(playlist.id, entryId, position),
    onError: () => queryClient.invalidateQueries({ queryKey }),
  });

  const removeMutation = useMutation({
    mutationFn: (entryId: number) => removePlaylistEntry(playlist.id, entryId),
    onError: () => queryClient.invalidateQueries({ queryKey }),
  });

  // Fractional reorder: compute one new key between the moved entry's new neighbors
  // (§3.4's scheme) and write it optimistically so the drag feels instant, then persist.
  const handleDrop = (dropIndex: number) => {
    const fromIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (fromIndex == null || fromIndex === dropIndex) return;

    const reordered = playlist.tracks.slice();
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    if (moved.entryId == null) return;

    const idx = reordered.indexOf(moved);
    const prevPos = reordered[idx - 1]?.position ?? null;
    const nextPos = reordered[idx + 1]?.position ?? null;
    const newPosition = generateKeyBetween(prevPos, nextPos);

    const nextTracks = reordered.map((t) => (t.entryId === moved.entryId ? { ...t, position: newPosition } : t));
    queryClient.setQueryData<PlaylistDetail>(queryKey, (old) => (old ? { ...old, tracks: nextTracks } : old));

    reorderMutation.mutate({ entryId: moved.entryId, position: newPosition });
  };

  const handleRemove = (entry: PlaylistTrackItem) => {
    if (entry.entryId == null) return;
    queryClient.setQueryData<PlaylistDetail>(queryKey, (old) =>
      old ? { ...old, tracks: old.tracks.filter((t) => t.entryId !== entry.entryId) } : old
    );
    removeMutation.mutate(entry.entryId);
  };

  const source = { type: "crate" as const, crateId: playlist.id };

  const isFiltering = searchQuery.trim().length > 0;
  const filteredTracks = isFiltering
    ? playlist.tracks.filter((track) => {
        const q = searchQuery.trim().toLowerCase();
        return (track.title ?? "").toLowerCase().includes(q) || (track.artistName ?? "").toLowerCase().includes(q);
      })
    : playlist.tracks;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-t3">Tracks</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-t3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search this crate…"
              aria-label="Search tracks in this crate by title or artist"
              className="w-44 rounded-md border border-line bg-surf py-1.5 pl-8 pr-2 text-xs text-t1 placeholder:text-t3 focus:border-acc focus:outline-none sm:w-56"
            />
          </div>
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-t1 hover:bg-surf-2"
          >
            + Add tracks
          </button>
        </div>
      </div>

      {playlist.tracks.length === 0 ? (
        <p className="text-sm text-t3">No tracks yet — add some to get started.</p>
      ) : filteredTracks.length === 0 ? (
        <p className="text-sm text-t3">No tracks match &ldquo;{searchQuery.trim()}&rdquo;.</p>
      ) : (
        <>
          <div className="flex flex-col md:hidden">
            {filteredTracks.map((track) => {
              const isCurrent = track.id === currentTrackId;
              return (
                <div key={track.entryId ?? track.id} className="group relative -mx-10 overflow-hidden">
                  <div
                    onClick={() => !track.missing && playTrack(track, playlist.tracks, source)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && !track.missing) {
                        e.preventDefault();
                        playTrack(track, playlist.tracks, source);
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
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <TrackCoverThumb coverArtUrl={track.coverArtUrl} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm ${isCurrent ? "text-playing" : "text-t1"}`}>{track.title ?? "Untitled"}</p>
                        <p className="truncate font-mono text-xs text-t3">{track.artistName}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(track);
                      }}
                      aria-label="Remove from crate"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-t3 hover:bg-surf hover:text-err"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden md:block">
            <div
              className={`mb-2 grid ${columns} gap-3 border-b border-line px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-t3`}
            >
              <span aria-hidden />
              <span>#</span>
              <span>Title</span>
              <span>Album</span>
              <span>Date Added</span>
              {showFormatBadges ? <span>Format</span> : null}
              <span>Rate</span>
              <span className="flex justify-end">Time</span>
              <span aria-hidden />
            </div>
            {filteredTracks.map((track, i) => {
              const isCurrent = track.id === currentTrackId;
              const isDragOver = dragOverIndex === i;
              return (
                <div
                  key={track.entryId ?? track.id}
                  draggable={!isFiltering}
                  onDragStart={() => {
                    if (isFiltering) return;
                    dragIndexRef.current = i;
                  }}
                  onDragOver={(e) => {
                    if (isFiltering) return;
                    e.preventDefault();
                    setDragOverIndex(i);
                  }}
                  onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
                  onDrop={(e) => {
                    if (isFiltering) return;
                    e.preventDefault();
                    handleDrop(i);
                  }}
                  onDragEnd={() => {
                    dragIndexRef.current = null;
                    setDragOverIndex(null);
                  }}
                  onClick={() => !track.missing && playTrack(track, playlist.tracks, source)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && !track.missing) {
                      e.preventDefault();
                      playTrack(track, playlist.tracks, source);
                    }
                  }}
                  role="button"
                  tabIndex={track.missing ? -1 : 0}
                  aria-label={`Play ${track.title ?? "Untitled"}`}
                  className={`lf-track-row group grid ${columns} items-center gap-3 rounded-lg border border-transparent px-3 ${
                    track.missing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:border-line hover:bg-surf-2"
                  } ${isCurrent || isDragOver ? "bg-[var(--lf-tint)]" : ""}`}
                  title={track.missing ? "File missing on disk" : undefined}
                >
                  <span
                    className="cursor-grab text-t3 active:cursor-grabbing"
                    aria-hidden
                    onClick={(e) => e.stopPropagation()}
                  >
                    ⠿
                  </span>
                  <span className={`font-mono text-xs ${isCurrent ? "text-playing" : "text-t3"}`}>
                    {isCurrent && isPlaying ? <PlayingIcon /> : String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex min-w-0 items-center gap-3">
                    <TrackCoverThumb coverArtUrl={track.coverArtUrl} className="lf-track-cover" />
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(track);
                    }}
                    aria-label="Remove from crate"
                    className="flex h-5 w-5 items-center justify-center rounded text-t3 opacity-0 hover:bg-surf hover:text-err group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {isAdding && (
        <AddTracksModal playlistId={playlist.id} existingTrackIds={playlist.tracks.map((t) => t.id)} onClose={() => setIsAdding(false)} />
      )}
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
