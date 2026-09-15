"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addTrackToPlaylist, fetchPlaylistSuggestions } from "@/lib/api/playlistsClient";
import { formatDuration } from "@/lib/format/track";

/** Suggestions strip at the bottom of a manual crate: tracks from elsewhere in the library whose
 *  audio embeddings are closest to the crate's own tracks (centroid similarity search, see
 *  app/api/v1/playlists/[id]/suggestions/route.ts), with a one-click add. Renders nothing while
 *  loading or if there's nothing to suggest yet (e.g. crate has no analyzed tracks) -- this is a
 *  bonus strip, not a load-bearing part of the page. */
export function CrateSuggestions({ playlistId }: { playlistId: number }) {
  const queryClient = useQueryClient();
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["playlist-suggestions", playlistId],
    queryFn: () => fetchPlaylistSuggestions(playlistId),
  });

  const addMutation = useMutation({
    mutationFn: (trackId: number) => addTrackToPlaylist(playlistId, trackId),
    onSuccess: (_entry, trackId) => {
      setAddedIds((prev) => new Set(prev).add(trackId));
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlist-suggestions", playlistId] });
    },
  });

  const suggestions = data?.suggestions ?? [];
  if (isLoading || suggestions.length === 0) return null;

  return (
    <div className="mt-10 border-t border-line pt-6">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-t3">Suggested for this crate</p>
      <ul className="divide-y divide-line">
        {suggestions.map((track) => {
          const isAdded = addedIds.has(track.id);
          return (
            <li key={track.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-t1">{track.title ?? "Untitled"}</p>
                {track.artistId ? (
                  <Link href={`/artists/${track.artistId}`} className="inline-block max-w-full truncate text-xs text-t3 hover:text-acc-text">
                    {track.artistName ?? "Unknown artist"}
                  </Link>
                ) : (
                  <p className="truncate text-xs text-t3">{track.artistName ?? "Unknown artist"}</p>
                )}
              </div>
              <span className="font-mono text-xs text-t3">{formatDuration(track.durationSeconds)}</span>
              <button
                type="button"
                onClick={() => addMutation.mutate(track.id)}
                disabled={isAdded || (addMutation.isPending && addMutation.variables === track.id)}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-t1 hover:bg-surf-2 disabled:opacity-40"
              >
                {isAdded ? "Added" : "+ Add"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
