"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteTrack, restoreTrack } from "@/lib/api/tracksClient";
import { emptyTrash, fetchTrash, type TrashedTrack } from "@/lib/api/trashClient";
import { formatDuration } from "@/lib/format/track";
import { invalidateLibraryQueries } from "@/lib/query/invalidateLibrary";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { FormatBadge } from "@/components/library/FormatBadge";

export function TrashView() {
  const queryClient = useQueryClient();
  const [emptyConfirmOpen, setEmptyConfirmOpen] = useState(false);
  const [purgeTrack, setPurgeTrack] = useState<TrashedTrack | null>(null);

  const trashQuery = useInfiniteQuery({
    queryKey: ["trash", "list"],
    queryFn: ({ pageParam }) => fetchTrash({ cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = trashQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const total = trashQuery.data?.pages[0]?.total ?? 0;
  const graceDays = trashQuery.data?.pages[0]?.graceDays ?? 14;

  const restoreMutation = useMutation({
    mutationFn: (id: number) => restoreTrack(id),
    onSuccess: () => invalidateLibraryQueries(queryClient),
  });

  const purgeMutation = useMutation({
    mutationFn: (id: number) => deleteTrack(id, true),
    onSuccess: () => {
      setPurgeTrack(null);
      invalidateLibraryQueries(queryClient);
    },
  });

  const emptyMutation = useMutation({
    mutationFn: emptyTrash,
    onSuccess: () => {
      setEmptyConfirmOpen(false);
      invalidateLibraryQueries(queryClient);
    },
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto px-10 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-[1.2] text-t1">Trash</h1>
          <p className="mt-1 text-sm text-t2">
            Removed tracks stay here for {graceDays} days, then they&apos;re deleted for good.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEmptyConfirmOpen(true)}
          disabled={items.length === 0 || emptyMutation.isPending}
          className="shrink-0 rounded-lg border border-line px-4 py-2.5 text-[13px] font-medium text-err hover:border-err hover:bg-surf-2 disabled:opacity-40"
        >
          Empty trash
        </button>
      </div>

      {restoreMutation.isError && (
        <p className="mt-3 text-xs text-err">{(restoreMutation.error as Error).message}</p>
      )}
      {purgeMutation.isError && <p className="mt-3 text-xs text-err">{(purgeMutation.error as Error).message}</p>}
      {emptyMutation.isError && <p className="mt-3 text-xs text-err">{(emptyMutation.error as Error).message}</p>}

      {trashQuery.isLoading ? (
        <p className="mt-8 text-sm text-t3">Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-2 text-center">
          <p className="font-serif text-2xl text-t1">Trash is empty</p>
          <p className="max-w-sm text-sm text-t2">
            Tracks you remove from the library land here so you can restore them.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2.5">
          {items.map((track) => (
            <li key={track.id} className="lf-card flex items-center gap-3.5 rounded-lg px-3.5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-t1">{track.title ?? "Untitled"}</p>
                <p className="truncate font-mono text-xs text-t3">
                  {track.artistName ?? "Unknown artist"}
                  {track.albumTitle ? ` · ${track.albumTitle}` : ""}
                </p>
              </div>
              <FormatBadge format={track.format} lossless={track.lossless} />
              <span className="shrink-0 font-mono text-xs text-t3">{formatDuration(track.durationSeconds)}</span>
              <span className="shrink-0 font-mono text-xs text-t3">{daysLeftLabel(track.daysRemaining)}</span>
              <button
                type="button"
                onClick={() => restoreMutation.mutate(track.id)}
                disabled={restoreMutation.isPending}
                className="shrink-0 rounded-lg border border-acc bg-acc px-3 py-2 text-xs font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2 disabled:opacity-50"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() => setPurgeTrack(track)}
                disabled={purgeMutation.isPending}
                className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-err hover:border-err hover:bg-surf-2 disabled:opacity-50"
              >
                Delete forever
              </button>
            </li>
          ))}
        </ul>
      )}

      {trashQuery.hasNextPage && (
        <div className="flex justify-center pt-6">
          <button
            type="button"
            onClick={() => trashQuery.fetchNextPage()}
            disabled={trashQuery.isFetchingNextPage}
            className="rounded-md border border-line px-4 py-1.5 text-xs text-t2 hover:bg-surf-2 disabled:opacity-50"
          >
            {trashQuery.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {emptyConfirmOpen ? (
        <ConfirmDialog
          title="Empty trash"
          message={`Permanently delete ${total} track${total === 1 ? "" : "s"}? This can't be undone.`}
          confirmLabel="Empty trash"
          danger
          isPending={emptyMutation.isPending}
          onConfirm={() => emptyMutation.mutate()}
          onClose={() => setEmptyConfirmOpen(false)}
        />
      ) : null}

      {purgeTrack ? (
        <ConfirmDialog
          title="Delete forever"
          message={`Permanently delete “${purgeTrack.title ?? "Untitled"}”? This can't be undone.`}
          confirmLabel="Delete forever"
          danger
          isPending={purgeMutation.isPending}
          onConfirm={() => purgeMutation.mutate(purgeTrack.id)}
          onClose={() => setPurgeTrack(null)}
        />
      ) : null}
    </div>
  );
}

function daysLeftLabel(daysRemaining: number): string {
  if (daysRemaining <= 0) return "Last day";
  if (daysRemaining === 1) return "1 day left";
  return `${daysRemaining} days left`;
}
