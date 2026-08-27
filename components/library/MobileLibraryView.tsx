"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchArtists, fetchTracks, type TrackSummary } from "@/lib/api-client";
import { fetchPlaylists } from "@/lib/api/playlistsClient";
import { useHasCredentials, withAuthQuery } from "@/lib/api/http";
import { usePlayerStore } from "@/lib/store/player";
import { NewCrateModal } from "@/components/crates/NewCrateModal";
import { TrackRowActions } from "@/components/library/TrackRowActions";
import { getAllOfflineCrates, getAllOfflineTracks, type OfflineCrate, type OfflineTrack } from "@/lib/offline/db";
import { removeCrateOffline } from "@/lib/offline/copyToPhone";
import { offlineTrackToSummary } from "@/lib/offline/trackSummary";
import { removeLocalTrack, uploadLocalTrackToPc } from "@/lib/offline/uploadToPc";
import { useDeviceStore } from "@/lib/store/device";
import { PlayIcon } from "@/components/shell/PlayerIcons";

// Swipe-right-to-queue tuning for MobileSongsList rows: how far (px) the row can be
// dragged before it clamps, and how far it must travel to commit the "add to queue" action.
const SWIPE_MAX_PX = 96;
const SWIPE_QUEUE_THRESHOLD_PX = 64;
// Below this, a touchmove is treated as an imprecise tap rather than the start of a swipe.
const SWIPE_INTENT_PX = 8;

type Segment = "crates" | "songs" | "artists" | "folders";

// There is no separate "Downloaded" segment: on-device content (files imported on this phone,
// plus crates copied from a PC for offline playback) is merged straight into "All songs",
// "Artists", and "Crates" so a song shows in one place regardless of where it came from or
// whether this device is paired. The standalone PWA has no watched-folder concept (desktop-only)
// and starts with zero PC connection ever, so it leads with "All songs" (the only segment
// guaranteed to have content with zero pairing, once anything's been imported) and drops
// "Folders". The existing LAN mobile view always has a same-origin connection, so "Crates"
// leading and "Folders" being present stays unchanged there.
const STANDALONE = process.env.NEXT_PUBLIC_STANDALONE === "true";

const SEGMENTS: { id: Segment; label: string }[] = STANDALONE
  ? [
      { id: "songs", label: "All songs" },
      { id: "crates", label: "Crates" },
      { id: "artists", label: "Artists" },
    ]
  : [
      { id: "crates", label: "Crates" },
      { id: "songs", label: "All songs" },
      { id: "artists", label: "Artists" },
      { id: "folders", label: "Folders" },
    ];

// Mobile "Your Library" screen (design board 1c, "m2 library" frame): a segmented control
// over Crates/All songs/Artists/Folders, distinct from the desktop grid/list toggle
// (useLibraryStore) so switching this segment never affects the desktop view's own state.
export function MobileLibraryView() {
  const [segment, setSegment] = useState<Segment>(STANDALONE ? "songs" : "crates");
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

// On-device tracks — files imported on this phone (source: "local", negative id, no server row
// at all) and tracks pulled down inside a copied crate (source: "synced", real positive id) —
// live only in IndexedDB. They're merged into every library list so a song shows in one place
// regardless of where it came from or whether this device is paired. A negative id is what tells
// the rows below to show on-device actions instead of the server-backed TrackRowActions, and
// what routes playback through the offline cache seam (lib/offline/playback.ts).
function useOfflineTrackSummaries(): TrackSummary[] {
  const offlineTracksQuery = useQuery({ queryKey: ["offline", "tracks"], queryFn: getAllOfflineTracks });
  return (offlineTracksQuery.data ?? []).map(offlineTrackToSummary);
}

const byDateAddedDesc = (a: TrackSummary, b: TrackSummary) => b.dateAdded.localeCompare(a.dateAdded);

function MobileSongsList() {
  const hasCredentials = useHasCredentials();
  const tracksQuery = useInfiniteQuery({
    queryKey: ["tracks", { sort: "date_added_desc" as const }],
    queryFn: ({ pageParam }) => fetchTracks({ sort: "date_added_desc", cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: hasCredentials,
  });
  const offlineTracks = useOfflineTrackSummaries();
  const serverTracks = tracksQuery.data?.pages.flatMap((p) => p.items) ?? [];
  // A copied-crate track is also a real server row — when paired it comes back from both places,
  // so the server copy (richer metadata) wins and the offline duplicate is dropped.
  const serverIds = new Set(serverTracks.map((t) => t.id));
  const tracks = [...offlineTracks.filter((t) => !serverIds.has(t.id)), ...serverTracks].sort(byDateAddedDesc);
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

  if (tracksQuery.isLoading && tracks.length === 0) return null;
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
              {track.id < 0 ? (
                <LocalTrackRowActions track={track} />
              ) : hasCredentials ? (
                <TrackRowActions track={track} alwaysVisible />
              ) : null}
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

function NotPairedMessage() {
  return (
    <p className="py-10 text-center text-sm text-t3">
      Not paired to a PC yet — go to Settings to pair. Songs you import on this phone show up in
      &ldquo;All songs&rdquo; either way.
    </p>
  );
}

// On-device track actions, standing in for the server-backed TrackRowActions on rows whose track
// has no server row (negative id). "Upload to PC" hands the audio blob to the same import
// pipeline the desktop folder-import uses (lib/offline/uploadToPc.ts); it doesn't auto-remove the
// local copy, so "Remove from this phone" stays available for after the PC has re-scanned it.
function LocalTrackRowActions({ track }: { track: TrackSummary }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const queryClient = useQueryClient();
  const isPaired = useDeviceStore((s) => s.device !== null);
  const removeTrackById = usePlayerStore((s) => s.removeTrackById);

  const uploadMutation = useMutation({ mutationFn: () => uploadLocalTrackToPc(track.id) });
  const removeMutation = useMutation({
    mutationFn: async () => {
      removeTrackById(track.id);
      await removeLocalTrack(track.id);
    },
    onSuccess: () => {
      setMenuOpen(false);
      queryClient.invalidateQueries({ queryKey: ["offline"] });
    },
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        aria-label={`Actions for ${track.title ?? "Untitled"}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Track actions"
        className="rounded-md p-1 text-t3 hover:bg-surf hover:text-t1"
      >
        <MoreDotsIcon />
      </button>

      {menuOpen ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
            }}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-xl border border-line bg-surf py-1 shadow-[var(--lf-shadow)]"
            onClick={(e) => e.stopPropagation()}
          >
            {isPaired ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending || uploadMutation.isSuccess}
                className="flex w-full items-center px-3 py-2 text-left text-sm text-t1 hover:bg-surf-2 disabled:opacity-50"
              >
                {uploadMutation.isPending ? "Uploading…" : uploadMutation.isSuccess ? "Uploaded to PC" : "Upload to PC"}
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-err hover:bg-surf-2 disabled:opacity-50"
            >
              Remove from this phone
            </button>
          </div>
          {uploadMutation.isError ? (
            <p className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-err bg-surf px-2 py-1.5 text-xs text-err">
              {(uploadMutation.error as Error).message}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MoreDotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

// The standalone PWA has no /artists/:id or /crates/:id page of its own (static export can't
// enumerate every possible id at build time — they only exist once paired to a specific PC), so
// a tap there opens the paired PC's own already-working page in a new tab instead of an internal
// Link. The existing LAN mobile view is unaffected — it still has those routes, so it keeps the
// original internal Link.
function ArtistOrCrateLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  const device = useDeviceStore((s) => s.device);
  if (STANDALONE) {
    if (!device) return null; // unreachable in practice: this list is gated behind hasCredentials
    return (
      <a href={`${device.serverUrl}${href}`} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function MobileArtistsList() {
  const hasCredentials = useHasCredentials();
  const artistsQuery = useInfiniteQuery({
    queryKey: ["artists", { sort: "name_asc" as const }],
    queryFn: ({ pageParam }) => fetchArtists({ sort: "name_asc", cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: hasCredentials,
  });
  const serverArtists = artistsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const offlineTracks = useOfflineTrackSummaries();
  const playContext = usePlayerStore((s) => s.playContext);

  // Artists that exist only because of on-device songs have no server row, so no /artists/:id
  // detail page — tapping one just plays that artist's on-device tracks. An artist the server
  // already knows about is left to its server row (whose detail view is the fuller one).
  const serverNames = new Set(serverArtists.map((a) => a.name.toLowerCase()));
  const localByArtist = new Map<string, TrackSummary[]>();
  for (const track of offlineTracks) {
    const name = track.artistName ?? "Unknown artist";
    if (serverNames.has(name.toLowerCase())) continue;
    const list = localByArtist.get(name) ?? [];
    list.push(track);
    localByArtist.set(name, list);
  }
  const localArtists = [...localByArtist.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  if (artistsQuery.isLoading && serverArtists.length === 0 && localArtists.length === 0) return null;
  if (serverArtists.length === 0 && localArtists.length === 0) {
    return hasCredentials ? (
      <p className="py-10 text-center text-sm text-t3">No artists yet.</p>
    ) : (
      <NotPairedMessage />
    );
  }

  return (
    <div className="flex flex-col">
      {serverArtists.map((artist) => (
        <ArtistOrCrateLink
          key={`s-${artist.id}`}
          href={`/artists/${artist.id}`}
          className="flex items-center justify-between border-b border-line py-3"
        >
          <span className="min-w-0 truncate text-sm text-t1">{artist.name}</span>
          <span className="shrink-0 pl-2 font-mono text-xs text-t3">{artist.albumCount} albums</span>
        </ArtistOrCrateLink>
      ))}
      {localArtists.map(([name, tracks]) => (
        <button
          key={`l-${name}`}
          type="button"
          onClick={() => playContext(tracks)}
          className="flex items-center justify-between border-b border-line py-3 text-left"
        >
          <span className="min-w-0 truncate text-sm text-t1">{name}</span>
          <span className="shrink-0 pl-2 font-mono text-xs text-ok">{tracks.length} on this phone</span>
        </button>
      ))}
    </div>
  );
}

function MobileCratesList() {
  const hasCredentials = useHasCredentials();
  const queryClient = useQueryClient();
  const serverCratesQuery = useQuery({
    queryKey: ["playlists"],
    queryFn: () => fetchPlaylists(),
    enabled: hasCredentials,
  });
  const offlineCratesQuery = useQuery({ queryKey: ["offline", "crates"], queryFn: getAllOfflineCrates });
  const offlineTracksQuery = useQuery({ queryKey: ["offline", "tracks"], queryFn: getAllOfflineTracks });
  const playContext = usePlayerStore((s) => s.playContext);

  const serverCrates = serverCratesQuery.data?.items ?? [];
  const offlineCrates = offlineCratesQuery.data ?? [];
  const offlineCrateById = new Map(offlineCrates.map((c) => [c.id, c]));
  const offlineTracksById = new Map((offlineTracksQuery.data ?? []).map((t) => [t.id, t]));
  // A copied crate carries the real server playlist id, so when paired it shows up in both
  // lists — its server row is the one rendered (with an offline marker); the extras below are
  // crates whose PC is currently unreachable, so there's no detail page to link them to.
  const offlineOnlyCrates = offlineCrates.filter((c) => !serverCrates.some((s) => s.id === c.id));

  const removeDownloadMutation = useMutation({
    mutationFn: (crateId: number) => removeCrateOffline(crateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["offline"] }),
  });

  function playOfflineCrate(crate: OfflineCrate) {
    const tracks = crate.trackIds
      .map((id) => offlineTracksById.get(id))
      .filter((t): t is OfflineTrack => t != null);
    if (tracks.length > 0) playContext(tracks.map(offlineTrackToSummary));
  }

  const loading = (hasCredentials && serverCratesQuery.isLoading) || offlineCratesQuery.isLoading;
  if (loading && serverCrates.length === 0 && offlineCrates.length === 0) return null;
  if (serverCrates.length === 0 && offlineOnlyCrates.length === 0) {
    return hasCredentials ? (
      <p className="py-10 text-center text-sm text-t3">No crates yet.</p>
    ) : (
      <NotPairedMessage />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {serverCrates.map((crate) => {
        const offline = offlineCrateById.get(crate.id);
        return (
          <CrateCard
            key={`s-${crate.id}`}
            name={crate.name}
            trackCount={crate.trackCount}
            coverArtUrl={crate.coverArtUrl}
            href={`/crates/${crate.id}`}
            offline={offline != null}
            onPlayOffline={offline ? () => playOfflineCrate(offline) : undefined}
            onRemoveDownload={offline ? () => removeDownloadMutation.mutate(crate.id) : undefined}
            removing={removeDownloadMutation.isPending && removeDownloadMutation.variables === crate.id}
          />
        );
      })}
      {offlineOnlyCrates.map((crate) => (
        <CrateCard
          key={`o-${crate.id}`}
          name={crate.name}
          trackCount={crate.trackIds.length}
          coverArtUrl={null}
          href={null}
          offline
          onPlayOffline={() => playOfflineCrate(crate)}
          onRemoveDownload={() => removeDownloadMutation.mutate(crate.id)}
          removing={removeDownloadMutation.isPending && removeDownloadMutation.variables === crate.id}
        />
      ))}
    </div>
  );
}

// One crate row. A crate that's been copied to this phone gets a play-from-cache button and a
// "Remove download" action; `href` is null for a crate whose PC we can't currently reach (no
// detail page to link to), leaving offline playback as the only affordance.
function CrateCard({
  name,
  trackCount,
  coverArtUrl,
  href,
  offline,
  onPlayOffline,
  onRemoveDownload,
  removing,
}: {
  name: string;
  trackCount: number;
  coverArtUrl: string | null;
  href: string | null;
  offline: boolean;
  onPlayOffline?: () => void;
  onRemoveDownload?: () => void;
  removing?: boolean;
}) {
  const body = (
    <>
      <div className="lf-hatch h-11 w-11 shrink-0 overflow-hidden rounded-[10px]">
        {coverArtUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local-only images
          <img src={withAuthQuery(coverArtUrl)} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-t1">{name}</p>
        <p className={`font-mono text-xs ${offline ? "text-ok" : "text-t3"}`}>
          {trackCount} tracks{offline ? " · offline" : ""}
        </p>
      </div>
    </>
  );

  return (
    <div className="lf-card flex items-center gap-3 rounded-2xl px-3 py-2.5">
      {offline && onPlayOffline ? (
        <button type="button" onClick={onPlayOffline} aria-label={`Play ${name}`} className="shrink-0 text-t1">
          <PlayIcon size={18} />
        </button>
      ) : null}
      {href ? (
        <ArtistOrCrateLink href={href} className="flex min-w-0 flex-1 items-center gap-3">
          {body}
        </ArtistOrCrateLink>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {offline && onRemoveDownload ? (
        <button
          type="button"
          onClick={onRemoveDownload}
          disabled={removing}
          className="shrink-0 text-xs font-medium text-t3 hover:text-err disabled:opacity-50"
        >
          Remove download
        </button>
      ) : null}
    </div>
  );
}
