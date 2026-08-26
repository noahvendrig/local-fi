"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchArtists, fetchTracks } from "@/lib/api-client";
import { fetchPlaylists } from "@/lib/api/playlistsClient";
import { withAuthQuery } from "@/lib/api/http";
import { usePlayerStore } from "@/lib/store/player";
import { NewCrateModal } from "@/components/crates/NewCrateModal";
import { TrackRowActions } from "@/components/library/TrackRowActions";

// Swipe-right-to-queue tuning for MobileSongsList rows: how far (px) the row can be
// dragged before it clamps, and how far it must travel to commit the "add to queue" action.
const SWIPE_MAX_PX = 96;
const SWIPE_QUEUE_THRESHOLD_PX = 64;
// Below this, a touchmove is treated as an imprecise tap rather than the start of a swipe.
const SWIPE_INTENT_PX = 8;

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
  const [isCreatingCrate, setIsCreatingCrate] = useState(false);
  const hasMiniPlayer = usePlayerStore((s) => Boolean(s.currentTrack));

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

      {segment === "crates" ? (
        <button
          type="button"
          onClick={() => setIsCreatingCrate(true)}
          aria-label="New crate"
          className={`fixed right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-acc text-on-acc shadow-[var(--lf-shadow)] hover:bg-acc-2 md:hidden ${
            hasMiniPlayer ? "bottom-[172px]" : "bottom-[100px]"
          }`}
        >
          <PlusIcon />
        </button>
      ) : null}

      {isCreatingCrate && <NewCrateModal onClose={() => setIsCreatingCrate(false)} />}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
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
  const enqueue = usePlayerStore((s) => s.enqueue);

  // Only one row can be dragged at a time; touchOriginRef/suppressClickRef don't need to
  // trigger re-renders themselves, so they stay in refs alongside the drag state.
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [justQueuedId, setJustQueuedId] = useState<number | null>(null);
  const touchOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  if (tracksQuery.isLoading) return null;
  if (tracks.length === 0) return <p className="py-10 text-center text-sm text-t3">No songs yet.</p>;

  function handleTouchStart(track: (typeof tracks)[number], e: React.TouchEvent) {
    if (track.missing) return;
    const touch = e.touches[0];
    touchOriginRef.current = { x: touch.clientX, y: touch.clientY };
    suppressClickRef.current = false;
    setDragId(track.id);
    setDragOffset(0);
  }

  function handleTouchMove(track: (typeof tracks)[number], e: React.TouchEvent) {
    const origin = touchOriginRef.current;
    if (!origin || dragId !== track.id) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - origin.x;
    const deltaY = touch.clientY - origin.y;
    if (Math.abs(deltaX) > SWIPE_INTENT_PX) suppressClickRef.current = true;
    // Once it's clearly a vertical scroll gesture, stop following it horizontally.
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;
    setDragOffset(Math.max(0, Math.min(deltaX, SWIPE_MAX_PX)));
  }

  function handleTouchEnd(track: (typeof tracks)[number]) {
    touchOriginRef.current = null;
    if (dragId !== track.id) return;
    if (dragOffset >= SWIPE_QUEUE_THRESHOLD_PX) {
      enqueue([track]);
      setJustQueuedId(track.id);
      setTimeout(() => setJustQueuedId((id) => (id === track.id ? null : id)), 900);
    }
    setDragId(null);
    setDragOffset(0);
  }

  function handlePlay(track: (typeof tracks)[number]) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!track.missing) playTrack(track, tracks);
  }

  return (
    <div className="flex flex-col">
      {tracks.map((track) => {
        const isCurrent = track.id === currentTrackId;
        const isDragging = dragId === track.id;
        const offsetX = isDragging ? dragOffset : 0;
        return (
          <div key={track.id} className="relative -mx-4 overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 flex items-center gap-1.5 bg-acc pl-4 text-on-acc"
              style={{ width: offsetX }}
            >
              <QueueIcon />
              <span className="whitespace-nowrap text-xs font-medium">Queue</span>
            </div>
            <div
              onTouchStart={(e) => handleTouchStart(track, e)}
              onTouchMove={(e) => handleTouchMove(track, e)}
              onTouchEnd={() => handleTouchEnd(track)}
              onTouchCancel={() => handleTouchEnd(track)}
              onClick={() => handlePlay(track)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !track.missing) {
                  e.preventDefault();
                  playTrack(track, tracks);
                }
              }}
              role="button"
              tabIndex={track.missing ? -1 : 0}
              aria-label={`Play ${track.title ?? "Untitled"}`}
              style={{
                transform: `translateX(${offsetX}px)`,
                transition: isDragging ? "none" : "transform 200ms ease",
                touchAction: "pan-y",
              }}
              className={`flex items-center justify-between gap-3 border-b border-line bg-bg px-4 py-3 ${
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
            {justQueuedId === track.id ? (
              <span className="lf-queued-badge pointer-events-none absolute right-4 top-1/2 rounded-full bg-acc px-2 py-0.5 text-[10px] font-medium text-on-acc">
                Queued
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function QueueIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 6h10M4 12h10M4 18h6" />
      <path d="M18 10v8M14 14h8" />
    </svg>
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
