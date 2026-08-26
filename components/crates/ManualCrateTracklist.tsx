"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generateKeyBetween } from "fractional-indexing";
import { formatDuration, formatRate } from "@/lib/format/track";
import { reorderPlaylistEntry, removePlaylistEntry, type PlaylistDetail, type PlaylistTrackItem } from "@/lib/api/playlistsClient";
import { usePlayerStore } from "@/lib/store/player";
import { PlayingIcon } from "@/components/shell/PlayerIcons";
import { FormatBadge } from "@/components/library/FormatBadge";
import { AddTracksModal } from "./AddTracksModal";

export function ManualCrateTracklist({ playlist }: { playlist: PlaylistDetail }) {
  const queryClient = useQueryClient();
  const queryKey = ["playlist", playlist.id];

  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const [isAdding, setIsAdding] = useState(false);
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

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-t3">Tracks</p>
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-t1 hover:bg-surf-2"
        >
          + Add tracks
        </button>
      </div>

      {playlist.tracks.length === 0 ? (
        <p className="text-sm text-t3">No tracks yet — add some to get started.</p>
      ) : (
        <>
          <div className="flex flex-col md:hidden">
          {playlist.tracks.map((track) => {
            const isCurrent = track.id === currentTrackId;
            return (
              <div key={track.entryId ?? track.id} className="relative -mx-10 overflow-hidden">
                <div
                  onClick={() => !track.missing && playTrack(track, playlist.tracks)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && !track.missing) {
                      e.preventDefault();
                      playTrack(track, playlist.tracks);
                    }
                  }}
                  role="button"
                  tabIndex={track.missing ? -1 : 0}
                  aria-label={`Play ${track.title ?? "Untitled"}`}
                  className={`flex items-center justify-between gap-3 border-b border-line bg-bg px-10 py-3 ${
                    track.missing ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                  } ${isCurrent ? "bg-[var(--lf-tint)]" : ""}`}
                  title={track.missing ? "File missing on disk" : undefined}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${isCurrent ? "text-playing" : "text-t1"}`}>{track.title ?? "Untitled"}</p>
                    <p className="truncate font-mono text-xs text-t3">{track.artistName}</p>
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
        <table className="hidden w-full border-collapse text-sm md:table">
          <thead>
            <tr className="border-b border-line text-left text-xs text-t3">
              <th className="hidden w-6 py-2 font-normal sm:table-cell" />
              <th className="hidden w-10 py-2 pr-2 font-normal sm:table-cell">#</th>
              <th className="py-2 pr-4 font-normal">Title</th>
              <th className="hidden w-20 py-2 pr-4 font-normal sm:table-cell">Format</th>
              <th className="hidden w-24 py-2 pr-4 font-normal sm:table-cell">Rate</th>
              <th className="hidden w-16 py-2 pr-2 text-right font-normal sm:table-cell">Time</th>
              <th className="w-6 py-2" />
            </tr>
          </thead>
          <tbody>
            {playlist.tracks.map((track, i) => {
              const isCurrent = track.id === currentTrackId;
              return (
                <tr
                  key={track.entryId ?? track.id}
                  draggable
                  onDragStart={() => {
                    dragIndexRef.current = i;
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIndex(i);
                  }}
                  onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(i);
                  }}
                  onDragEnd={() => {
                    dragIndexRef.current = null;
                    setDragOverIndex(null);
                  }}
                  onClick={() => !track.missing && playTrack(track, playlist.tracks)}
                  className={`cursor-pointer border-b border-line last:border-b-0 hover:bg-surf-2 ${dragOverIndex === i ? "bg-[var(--lf-tint)]" : ""} ${isCurrent ? "bg-[var(--lf-tint)]" : ""} ${track.missing ? "opacity-40" : ""}`}
                  title={track.missing ? "File missing on disk" : undefined}
                >
                  <td className="hidden cursor-grab py-2 text-t3 sm:table-cell" aria-hidden onClick={(e) => e.stopPropagation()}>
                    ⠿
                  </td>
                  <td className="hidden py-2 pr-2 font-mono text-xs text-t3 sm:table-cell">{isCurrent && isPlaying ? <PlayingIcon /> : i + 1}</td>
                  <td className={`min-w-0 max-w-0 truncate py-2 pr-4 ${isCurrent ? "text-playing" : "text-t1"}`}>
                    <span className="block truncate">{track.title ?? "Untitled"}</span>
                    {track.artistId ? (
                      <Link
                        href={`/artists/${track.artistId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-block max-w-full truncate text-xs text-t3 hover:text-acc-text max-md:pointer-events-none"
                      >
                        {track.artistName}
                      </Link>
                    ) : (
                      <span className="block truncate text-xs text-t3">{track.artistName}</span>
                    )}
                  </td>
                  <td className="hidden py-2 pr-4 sm:table-cell">
                    <FormatBadge format={track.format} lossless={track.lossless} />
                  </td>
                  <td className="hidden py-2 pr-4 font-mono text-xs text-t2 sm:table-cell">{formatRate(track)}</td>
                  <td className="hidden py-2 pr-2 text-right font-mono text-xs text-t2 sm:table-cell">{formatDuration(track.durationSeconds)}</td>
                  <td className="py-2 pr-2 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(track);
                      }}
                      aria-label="Remove from crate"
                      className="flex h-5 w-5 items-center justify-center rounded text-t3 hover:bg-surf hover:text-err"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </>
      )}

      {isAdding && (
        <AddTracksModal playlistId={playlist.id} existingTrackIds={playlist.tracks.map((t) => t.id)} onClose={() => setIsAdding(false)} />
      )}
    </div>
  );
}
