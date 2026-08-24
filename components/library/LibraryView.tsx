"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAlbums, fetchTracks } from "@/lib/api-client";
import type { AlbumSort, TrackSort } from "@/lib/api-client";
import { useLibraryStore } from "@/lib/store/library";
import { AlbumGrid } from "./AlbumGrid";
import { LibraryToolbar } from "./LibraryToolbar";
import { TrackList } from "./TrackList";

export function LibraryView() {
  const viewMode = useLibraryStore((s) => s.viewMode);
  const [losslessOnly, setLosslessOnly] = useState(false);
  const [trackSort, setTrackSort] = useState<TrackSort>("date_added_desc");
  const [albumSort, setAlbumSort] = useState<AlbumSort>("date_added_desc");

  // A cheap standalone probe (not the paginated view query) so the true "library has
  // zero tracks at all" empty state can be told apart from "no albums are tagged".
  const anyTracksQuery = useQuery({
    queryKey: ["tracks", "any"],
    queryFn: () => fetchTracks({ limit: 1 }),
  });

  const tracksQuery = useInfiniteQuery({
    queryKey: ["tracks", { sort: trackSort, losslessOnly }],
    queryFn: ({ pageParam }) => fetchTracks({ sort: trackSort, lossless: losslessOnly || undefined, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: viewMode === "list",
  });

  const albumsQuery = useInfiniteQuery({
    queryKey: ["albums", { sort: albumSort }],
    queryFn: ({ pageParam }) => fetchAlbums({ sort: albumSort, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: viewMode === "grid",
  });

  if (anyTracksQuery.isLoading) return null;

  if (anyTracksQuery.data?.items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <h1 className="font-serif text-3xl text-t1">Your library is empty</h1>
        <p className="max-w-sm text-sm text-t2">Import tracks to start building your collection.</p>
      </div>
    );
  }

  const tracks = tracksQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const albums = albumsQuery.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex h-full flex-col">
      <LibraryToolbar
        trackSort={trackSort}
        onTrackSortChange={setTrackSort}
        albumSort={albumSort}
        onAlbumSortChange={setAlbumSort}
        losslessOnly={losslessOnly}
        onLosslessOnlyChange={setLosslessOnly}
      />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {viewMode === "grid" ? (
          albums.length === 0 && !albumsQuery.isLoading ? (
            <EmptyAlbums />
          ) : (
            <AlbumGrid albums={albums} />
          )
        ) : (
          <TrackList tracks={tracks} />
        )}

        {viewMode === "grid" && albumsQuery.hasNextPage && (
          <LoadMoreButton onClick={() => albumsQuery.fetchNextPage()} loading={albumsQuery.isFetchingNextPage} />
        )}
        {viewMode === "list" && tracksQuery.hasNextPage && (
          <LoadMoreButton onClick={() => tracksQuery.fetchNextPage()} loading={tracksQuery.isFetchingNextPage} />
        )}
      </div>
    </div>
  );
}

function EmptyAlbums() {
  const setViewMode = useLibraryStore((s) => s.setViewMode);
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p className="text-sm text-t2">No albums to show — these tracks aren&apos;t tagged with an album.</p>
      <button type="button" onClick={() => setViewMode("list")} className="text-sm font-medium text-acc-text hover:underline">
        Switch to List view
      </button>
    </div>
  );
}

function LoadMoreButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <div className="flex justify-center pt-6">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="rounded-md border border-line px-4 py-1.5 text-xs text-t2 hover:bg-surf-2 disabled:opacity-50"
      >
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
