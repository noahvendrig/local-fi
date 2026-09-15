"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTracks } from "@/lib/api-client";
import { assignMixtapeSegment, type MixtapeSegment } from "@/lib/api/mixtapesClient";
import { formatDuration } from "@/lib/format/track";

export function AssignSegmentModal({
  mixtapeId,
  segment,
  onClose,
}: {
  mixtapeId: number;
  segment: MixtapeSegment;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["tracks", "picker", query],
    queryFn: () => fetchTracks({ q: query || undefined, limit: 50 }),
  });

  const assignMutation = useMutation({
    mutationFn: (trackId: number | null) => assignMixtapeSegment(mixtapeId, segment.id, trackId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mixtape", mixtapeId] });
      onClose();
    },
  });

  const tracks = data?.items ?? [];
  const segmentLabel = `${formatDuration(segment.startSeconds)}–${formatDuration(segment.endSeconds)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Assign segment"
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "var(--lf-glass, rgba(18,16,22,.6))" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl border border-line bg-surf p-6 shadow-[var(--lf-shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-t1">Assign track</h2>
            <p className="text-xs text-t3">{segmentLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-t3 hover:bg-surf-2 hover:text-t1"
          >
            ×
          </button>
        </div>

        {segment.matchedTrackId != null ? (
          <button
            type="button"
            onClick={() => assignMutation.mutate(null)}
            disabled={assignMutation.isPending}
            className="mt-4 rounded-md border border-line px-3 py-2 text-left text-sm text-t2 hover:bg-surf-2 disabled:opacity-40"
          >
            Clear assignment — mark unrecognized
          </button>
        ) : null}

        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your library…"
          className="mt-4 rounded-md border border-line bg-surf-2 px-3 py-2 text-sm text-t1"
        />

        <div className="mt-3 flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="py-4 text-center text-sm text-t3">Loading…</p>
          ) : tracks.length === 0 ? (
            <p className="py-4 text-center text-sm text-t3">No tracks found.</p>
          ) : (
            <ul className="divide-y divide-line">
              {tracks.map((track) => {
                const isCurrent = track.id === segment.matchedTrackId;
                return (
                  <li key={track.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-t1">{track.title ?? "Untitled"}</p>
                      <p className="truncate text-xs text-t2">{track.artistName ?? "Unknown artist"}</p>
                    </div>
                    <span className="font-mono text-xs text-t3">{formatDuration(track.durationSeconds)}</span>
                    <button
                      type="button"
                      onClick={() => assignMutation.mutate(track.id)}
                      disabled={isCurrent || assignMutation.isPending}
                      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-t1 hover:bg-surf-2 disabled:opacity-40"
                    >
                      {isCurrent ? "Assigned" : "Assign"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
