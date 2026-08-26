"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchArtists, fetchTracks } from "@/lib/api-client";
import { fetchPlaylists } from "@/lib/api/playlistsClient";
import { withAuthQuery } from "@/lib/api/http";
import { formatDuration } from "@/lib/format/track";
import { usePlayerStore } from "@/lib/store/player";

type Segment = "crates" | "songs" | "artists" | "folders";

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "crates", label: "Crates" },
  { id: "songs", label: "All songs" },
  { id: "artists", label: "Artists" },
  { id: "folders", label: "Folders" },
];

// Mobile "Your Library" screen (design board 1c, "m2 library" frame): a segmented control
// over Crates/All songs/Artists/Folders, distinct from the desktop grid/list toggle
// (useLibraryStore) so switching this segment never affects the desktop view's own state.
export function MobileLibraryView() {
  const [segment, setSegment] = useState<Segment>("crates");

  return (
    <div className="flex h-full flex-col pb-36 md:hidden">
      <div className="shrink-0 px-4 pt-4">
        <h1 className="text-2xl font-bold leading-[1.2] text-t1">Your Library</h1>
        <div className="mt-3.5 flex gap-1.5 overflow-x-auto pb-1">
          {SEGMENTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSegment(s.id)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium tracking-[0.04em] uppercase ${
                segment === s.id ? "bg-acc text-on-acc" : "border border-line text-t2"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        {segment === "crates" ? <MobileCratesList /> : null}
        {segment === "songs" ? <MobileSongsList /> : null}
        {segment === "artists" ? <MobileArtistsList /> : null}
        {segment === "folders" ? (
          <p className="py-10 text-center text-sm text-t3">Manage watched folders from the desktop app.</p>
        ) : null}
      </div>
    </div>
  );
}

function MobileSongsList() {
  const tracksQuery = useInfiniteQuery({
    queryKey: ["tracks", { sort: "date_added_desc" as const }],
    queryFn: ({ pageParam }) => fetchTracks({ sort: "date_added_desc", cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const tracks = tracksQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const playTrack = usePlayerStore((s) => s.playTrack);

  if (tracksQuery.isLoading) return null;
  if (tracks.length === 0) return <p className="py-10 text-center text-sm text-t3">No songs yet.</p>;

  return (
    <div className="flex flex-col">
      {tracks.map((track) => {
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
            className={`flex items-center justify-between gap-3 border-b border-line px-4 py-3 -mx-4 ${
              track.missing ? "cursor-not-allowed opacity-40" : "cursor-pointer"
            } ${isCurrent ? "bg-[var(--lf-tint)]" : ""}`}
            title={track.missing ? "File missing on disk" : undefined}
          >
            <div className="min-w-0">
              <p className={`truncate text-sm ${isCurrent ? "text-playing" : "text-t1"}`}>{track.title ?? "Untitled"}</p>
              <p className="truncate font-mono text-xs text-t3">{track.artistName}</p>
            </div>
            <span className="shrink-0 pl-2 font-mono text-xs text-t3">{formatDuration(track.durationSeconds)}</span>
          </div>
        );
      })}
    </div>
  );
}

function MobileArtistsList() {
  const artistsQuery = useInfiniteQuery({
    queryKey: ["artists", { sort: "name_asc" as const }],
    queryFn: ({ pageParam }) => fetchArtists({ sort: "name_asc", cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const artists = artistsQuery.data?.pages.flatMap((p) => p.items) ?? [];

  if (artistsQuery.isLoading) return null;
  if (artists.length === 0) return <p className="py-10 text-center text-sm text-t3">No artists yet.</p>;

  return (
    <div className="flex flex-col">
      {artists.map((artist) => (
        <Link key={artist.id} href={`/artists/${artist.id}`} className="flex items-center justify-between border-b border-line py-3">
          <span className="min-w-0 truncate text-sm text-t1">{artist.name}</span>
          <span className="shrink-0 pl-2 font-mono text-xs text-t3">{artist.albumCount} albums</span>
        </Link>
      ))}
    </div>
  );
}

function MobileCratesList() {
  const cratesQuery = useQuery({ queryKey: ["playlists"], queryFn: () => fetchPlaylists() });
  const crates = cratesQuery.data?.items ?? [];

  if (cratesQuery.isLoading) return null;
  if (crates.length === 0) return <p className="py-10 text-center text-sm text-t3">No crates yet.</p>;

  return (
    <div className="flex flex-col gap-2.5">
      {crates.map((crate) => (
        <Link key={crate.id} href={`/crates/${crate.id}`} className="lf-card flex items-center gap-3 rounded-2xl px-3 py-2.5">
          <div className="lf-hatch h-11 w-11 shrink-0 overflow-hidden rounded-[10px]">
            {crate.coverArtUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local-only images
              <img src={withAuthQuery(crate.coverArtUrl)} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-t1">{crate.name}</p>
            <p className="font-mono text-xs text-t3">{crate.trackCount} tracks</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
