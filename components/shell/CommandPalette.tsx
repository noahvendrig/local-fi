"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchAlbums, fetchArtists, fetchTracks, type TrackSummary } from "@/lib/api-client";
import { fetchPlaylists } from "@/lib/api/playlistsClient";
import { revealTrackInFolder } from "@/lib/api/tracksClient";
import { useHasCredentials } from "@/lib/api/http";
import { getAllOfflineTracks } from "@/lib/offline/db";
import { offlineTrackToSummary } from "@/lib/offline/trackSummary";
import { formatDuration } from "@/lib/format/track";
import { useCommandPaletteStore } from "@/lib/store/commandPalette";
import { useDeviceStore } from "@/lib/store/device";
import { usePlayerStore } from "@/lib/store/player";
import { useTagEditorStore } from "@/lib/store/tagEditor";
import { PlayIcon } from "./PlayerIcons";

// The standalone PWA has no /albums/:id, /artists/:id, /crates/:id, or /trash page of its own
// (see MobileLibraryView.tsx's ArtistOrCrateLink for why) — search results for those groups
// link out to the paired PC's own page instead of an internal route. Unaffected in the existing
// LAN mobile/desktop view, which still has all of these routes.
const STANDALONE = process.env.NEXT_PUBLIC_STANDALONE === "true";

type ResultGroupName = "Tracks" | "Albums" | "Artists" | "Crates" | "Actions";

interface FlatResult {
  group: ResultGroupName;
  key: string;
  label: string;
  sublabel: string;
  track?: TrackSummary;
  href?: string;
}

const RESULT_LIMIT = 6;

// Global ⌘K/Ctrl+K command palette — search across the M3 browse endpoints (ARCHITECTURE.md M8).
// Always mounted (returns null while closed) so the shortcut works from anywhere in the shell.
export function CommandPalette() {
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  const openPalette = useCommandPaletteStore((s) => s.open);
  const closePalette = useCommandPaletteStore((s) => s.close);
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const openTagEditor = useTagEditorStore((s) => s.open);
  const device = useDeviceStore((s) => s.device);
  const hasCredentials = useHasCredentials();

  const trimmed = query.trim();
  const enabled = isOpen && trimmed.length > 0 && hasCredentials;

  const tracksQuery = useQuery({
    queryKey: ["search", "tracks", trimmed],
    queryFn: () => fetchTracks({ q: trimmed, limit: RESULT_LIMIT }),
    enabled,
  });
  const albumsQuery = useQuery({
    queryKey: ["search", "albums", trimmed],
    queryFn: () => fetchAlbums({ q: trimmed, limit: RESULT_LIMIT }),
    enabled,
  });
  const artistsQuery = useQuery({
    queryKey: ["search", "artists", trimmed],
    queryFn: () => fetchArtists({ q: trimmed, limit: RESULT_LIMIT }),
    enabled,
  });
  const cratesQuery = useQuery({
    queryKey: ["search", "crates", trimmed],
    queryFn: () => fetchPlaylists({ q: trimmed, limit: RESULT_LIMIT }),
    enabled,
  });
  // On-device tracks (files imported straight onto this phone) live only in IndexedDB and never
  // reach the server search above — a library that's mostly phone-imported would otherwise return
  // "no results" for every query. Matched client-side here against the same text. Not gated on
  // credentials: on-device search should work even before the phone is paired to a PC.
  const offlineTracksQuery = useQuery({
    queryKey: ["offline", "tracks"],
    queryFn: getAllOfflineTracks,
    enabled: isOpen && trimmed.length > 0,
  });

  // Local UI state resets whenever the palette closes, so a reopen always starts fresh —
  // routed through this one handler (called from event handlers, never from an effect body)
  // rather than every close site (backdrop click, Escape, opening a result, ...) resetting it.
  function handleClose() {
    setQuery("");
    setActiveKey(null);
    setStatusMessage(null);
    closePalette();
  }

  // Active regardless of isOpen, so the shortcut opens the palette from anywhere. setState only
  // happens inside the callback (in response to a keydown), not synchronously in the effect body.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      } else if (e.key === "Escape") {
        handleClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const groups = useMemo(() => {
    const q = trimmed.toLowerCase();
    const serverTracks = tracksQuery.data?.items ?? [];
    const serverTrackIds = new Set(serverTracks.map((t) => t.id));
    // A phone-imported track matches on title, artist, or album — the server tracks query only
    // filters on title, so this stays a little more forgiving. A copied-crate track that's also
    // a real server row is left to its server copy (dropped here) so it isn't listed twice.
    const offlineMatches = (offlineTracksQuery.data ?? [])
      .filter((t) => !serverTrackIds.has(t.id))
      .filter((t) => [t.title, t.artistName, t.albumTitle].some((f) => f?.toLowerCase().includes(q)))
      .map(offlineTrackToSummary);
    const tracks: FlatResult[] = [...serverTracks, ...offlineMatches].slice(0, RESULT_LIMIT).map((t) => ({
      group: "Tracks" as const,
      key: `track-${t.id}`,
      label: t.title ?? "Untitled",
      sublabel: t.artistName ?? "Unknown artist",
      track: t,
    }));
    const externalHref = (path: string) => (STANDALONE && device ? `${device.serverUrl}${path}` : path);
    const albums: FlatResult[] = (albumsQuery.data?.items ?? []).map((a) => ({
      group: "Albums" as const,
      key: `album-${a.id}`,
      label: a.title,
      sublabel: a.albumArtistName,
      href: externalHref(`/albums/${a.id}`),
    }));
    const artists: FlatResult[] = (artistsQuery.data?.items ?? []).map((ar) => ({
      group: "Artists" as const,
      key: `artist-${ar.id}`,
      label: ar.name,
      sublabel: `${ar.albumCount} album${ar.albumCount === 1 ? "" : "s"}`,
      href: externalHref(`/artists/${ar.id}`),
    }));
    const crates: FlatResult[] = (cratesQuery.data?.items ?? []).map((c) => ({
      group: "Crates" as const,
      key: `crate-${c.id}`,
      label: c.name,
      sublabel: c.type === "smart" ? "Smart crate" : `${c.trackCount} track${c.trackCount === 1 ? "" : "s"}`,
      href: externalHref(`/crates/${c.id}`),
    }));
    const actions: FlatResult[] = [];
    if (q.length === 0 || "settings".startsWith(q) || q.includes("set")) {
      actions.push({
        group: "Actions",
        key: "action-settings",
        label: "Settings",
        sublabel: "Palettes, progress bar, shortcuts",
        href: "/settings",
      });
    }
    // Trash has no page of its own in the standalone build; only offer it there once paired,
    // linking out to the PC's own page like the Albums/Artists/Crates results above.
    if ((q.length === 0 || "trash".startsWith(q) || q.includes("bin")) && (!STANDALONE || device)) {
      actions.push({
        group: "Actions",
        key: "action-trash",
        label: "Trash",
        sublabel: "Restore or permanently delete tracks",
        href: externalHref("/trash"),
      });
    }
    return { tracks, albums, artists, crates, actions };
  }, [tracksQuery.data, albumsQuery.data, artistsQuery.data, cratesQuery.data, offlineTracksQuery.data, trimmed, device]);

  const flat = [...groups.actions, ...groups.tracks, ...groups.albums, ...groups.artists, ...groups.crates];

  if (!isOpen) return null;

  // Derived, not synced via effect: falls back to the first result whenever the stored
  // activeKey doesn't match anything in the current result set (e.g. right after typing).
  const activeResult = flat.find((r) => r.key === activeKey) ?? flat[0] ?? null;
  const isLoading = tracksQuery.isLoading || albumsQuery.isLoading || artistsQuery.isLoading || cratesQuery.isLoading;

  function moveActive(delta: number) {
    if (flat.length === 0) return;
    const idx = flat.findIndex((r) => r.key === activeResult?.key);
    const next = idx < 0 ? 0 : (idx + delta + flat.length) % flat.length;
    setActiveKey(flat[next].key);
  }

  function openResult(result: FlatResult) {
    if (result.track) {
      playTrack(
        result.track,
        groups.tracks.map((r) => r.track as TrackSummary)
      );
    } else if (result.href) {
      if (STANDALONE && (result.group === "Albums" || result.group === "Artists" || result.group === "Crates" || result.key === "action-trash")) {
        window.open(result.href, "_blank", "noopener,noreferrer");
      } else {
        router.push(result.href);
      }
    }
    handleClose();
  }

  function flashStatus(message: string) {
    setStatusMessage(message);
    setTimeout(() => setStatusMessage((cur) => (cur === message ? null : cur)), 2500);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!activeResult) return;
      if ((e.metaKey || e.ctrlKey) && activeResult.track) {
        enqueue([activeResult.track]);
        flashStatus(`Queued "${activeResult.label}"`);
      } else {
        openResult(activeResult);
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "e" && activeResult?.track) {
      e.preventDefault();
      openTagEditor(activeResult.track.id);
      handleClose();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "r" && activeResult?.track) {
      e.preventDefault();
      const trackId = activeResult.track.id;
      revealTrackInFolder(trackId)
        .then(() => flashStatus("Revealed in file explorer"))
        .catch((err) => flashStatus(err instanceof Error ? err.message : "Couldn't reveal file"));
    }
  }

  const groupOrder: { name: ResultGroupName; items: FlatResult[] }[] = [
    { name: "Actions", items: groups.actions },
    { name: "Tracks", items: groups.tracks },
    { name: "Albums", items: groups.albums },
    { name: "Artists", items: groups.artists },
    { name: "Crates", items: groups.crates },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center px-6 pt-[120px]"
      style={{ backgroundColor: "rgba(12, 11, 10, 0.6)", backdropFilter: "blur(3px)" }}
      onClick={handleClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-3xl border border-line bg-surf shadow-[var(--lf-shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-[18px]">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search library"
            className="flex-1 bg-transparent text-base text-t1 outline-none placeholder:text-t3"
          />
          <span className="font-mono text-[11px] text-t3">esc</span>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {trimmed.length === 0 ? (
            groupOrder.map(({ name, items }) => {
              if (items.length === 0) return null;
              return (
                <div key={name} className="px-2 py-1">
                  <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-t3">{name}</p>
                  {items.map((result) => (
                    <button
                      key={result.key}
                      type="button"
                      onMouseEnter={() => setActiveKey(result.key)}
                      onClick={() => openResult(result)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${
                        activeResult?.key === result.key
                          ? "border-acc bg-surf-2"
                          : "border-transparent hover:bg-surf-2"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-t1">{result.label}</span>
                        <span className="block truncate font-mono text-xs text-t3">{result.sublabel}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-t3">⌘,</span>
                    </button>
                  ))}
                </div>
              );
            })
          ) : isLoading && flat.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-t3">Searching…</p>
          ) : flat.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-t3">No results for &quot;{trimmed}&quot;.</p>
          ) : (
            groupOrder.map(({ name, items }) => {
              if (items.length === 0) return null;
              return (
                <div key={name} className="px-2 py-1">
                  <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-t3">{name}</p>
                  {items.map((result) => (
                    <button
                      key={result.key}
                      type="button"
                      onMouseEnter={() => setActiveKey(result.key)}
                      onClick={() => openResult(result)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${
                        activeResult?.key === result.key
                          ? "border-acc bg-surf-2"
                          : "border-transparent hover:bg-surf-2"
                      }`}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-t3" aria-hidden>
                        {result.group === "Tracks" && <PlayIcon />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-t1">{result.label}</span>
                        <span className="block truncate font-mono text-xs text-t3">{result.sublabel}</span>
                      </span>
                      {result.track && (
                        <span className="shrink-0 font-mono text-xs text-t3">{formatDuration(result.track.durationSeconds)}</span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-t3">
          <span>{statusMessage ?? "↑↓ Navigate · ↵ Open · ⌘↵ Queue · ⌘E Edit tags · ⌘⇧R Reveal"}</span>
          <span className="shrink-0">Esc to close</span>
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-t3"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
