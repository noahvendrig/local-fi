"use client";

import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchArtist, fetchTracks } from "@/lib/api-client";
import { usePlayerStore } from "@/lib/store/player";
import { PlayIcon } from "@/components/shell/PlayerIcons";
import { TrackList } from "./TrackList";

export function ArtistDetailView({ artistId }: { artistId: number }) {
  const {
    data: artist,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["artist", artistId],
    queryFn: () => fetchArtist(artistId),
  });

  const tracksQuery = useInfiniteQuery({
    queryKey: ["tracks", { artistId }],
    queryFn: ({ pageParam }) => fetchTracks({ artistId, sort: "date_added_desc", cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const playContext = usePlayerStore((s) => s.playContext);
  const enqueue = usePlayerStore((s) => s.enqueue);

  if (isLoading) return null;

  if (error || !artist) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <h1 className="font-serif text-2xl text-t1">Artist not found</h1>
        <Link href="/library" className="text-sm font-medium text-acc-text hover:underline">
          Back to library
        </Link>
      </div>
    );
  }

  const tracks = tracksQuery.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex h-full flex-col overflow-y-auto px-10 py-8">
      <Link href="/library" className="w-fit text-xs font-medium text-t3 hover:text-t1">
        ← Library
      </Link>

      <h1 className="mt-4 font-serif text-[40px] font-medium leading-[1.1] text-t1">{artist.name}</h1>
      <p className="mt-2 flex items-center gap-3 font-mono text-xs text-t3">
        <span>
          {tracks.length} song{tracks.length === 1 ? "" : "s"}
        </span>
        {artist.topRank ? (
          <span className="rounded-full border border-line px-2 py-0.5 text-acc-text">Your #{artist.topRank} artist</span>
        ) : null}
      </p>

      {tracks.length > 0 && (
        <div className="mt-5 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => playContext(tracks)}
            className="lf-top flex items-center gap-2 rounded-lg border border-acc bg-acc px-5 py-2.5 text-[13px] font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2"
          >
            <PlayIcon /> Play all
          </button>
          <button
            type="button"
            onClick={() => enqueue(tracks)}
            className="rounded-lg border border-line px-4 py-2.5 text-[13px] font-medium text-t1 hover:border-acc hover:bg-surf-2"
          >
            Add to queue
          </button>
        </div>
      )}

      <div className="mt-6">
        {tracks.length === 0 && !tracksQuery.isLoading ? (
          <p className="text-sm text-t3">No songs yet.</p>
        ) : (
          <TrackList tracks={tracks} />
        )}

        {tracksQuery.hasNextPage && (
          <div className="flex justify-center pt-6">
            <button
              type="button"
              onClick={() => tracksQuery.fetchNextPage()}
              disabled={tracksQuery.isFetchingNextPage}
              className="rounded-md border border-line px-4 py-1.5 text-xs text-t2 hover:bg-surf-2 disabled:opacity-50"
            >
              {tracksQuery.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
