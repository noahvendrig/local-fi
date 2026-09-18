"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTracks, type TrackSummary } from "@/lib/api-client";
import { useHasCredentials } from "@/lib/api/http";
import { getAllOfflineTracks } from "@/lib/offline/db";
import { offlineTrackToSummary } from "@/lib/offline/trackSummary";
import { formatDuration } from "@/lib/format/track";
import { usePlayerStore } from "@/lib/store/player";
import { CloseIcon } from "./PlayerIcons";

const RESULT_LIMIT = 8;

// Always-mounted search bar pinned to the top of the shell (app/layout.tsx), distinct from
// CommandPalette's ⌘K modal — visible from every section without needing the shortcut.
export function TopSearchBar() {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const hasCredentials = useHasCredentials();

  const trimmed = query.trim();
  const enabled = trimmed.length > 0;

  const tracksQuery = useQuery({
    queryKey: ["search", "tracks", trimmed],
    queryFn: () => fetchTracks({ q: trimmed, limit: RESULT_LIMIT }),
    enabled: enabled && hasCredentials,
  });
  // On-device tracks (phone-only imports) never reach the server search above — matched
  // client-side here against the same text, same approach as CommandPalette.
  const offlineTracksQuery = useQuery({
    queryKey: ["offline", "tracks"],
    queryFn: getAllOfflineTracks,
    enabled,
  });

  const results = useMemo(() => {
    const q = trimmed.toLowerCase();
    const serverTracks = tracksQuery.data?.items ?? [];
    const serverTrackIds = new Set(serverTracks.map((t) => t.id));
    const offlineMatches = (offlineTracksQuery.data ?? [])
      .filter((t) => !serverTrackIds.has(t.id))
      .filter((t) => [t.title, t.artistName, t.albumTitle].some((f) => f?.toLowerCase().includes(q)))
      .map(offlineTrackToSummary);
    return [...serverTracks, ...offlineMatches].slice(0, RESULT_LIMIT);
  }, [tracksQuery.data, offlineTracksQuery.data, trimmed]);

  const isLoading = enabled && (tracksQuery.isLoading || offlineTracksQuery.isLoading);
  const showDropdown = isFocused && trimmed.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmed]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function selectTrack(track: TrackSummary) {
    playTrack(track, results);
    setQuery("");
    setIsFocused(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setQuery("");
      setIsFocused(false);
      inputRef.current?.blur();
      return;
    }
    if (!showDropdown || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectTrack(results[activeIndex]);
    }
  }

  return (
    <header className="relative z-30 flex h-14 w-full shrink-0 items-center border-b border-line bg-bg px-4 md:px-6">
      <div ref={containerRef} className="relative w-full max-w-[480px]">
        <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surf-2 px-3 py-2">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search your library…"
            className="flex-1 bg-transparent text-sm text-t1 outline-none placeholder:text-t3"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="text-t3 hover:text-t1"
            >
              <CloseIcon />
            </button>
          )}
        </div>

        {showDropdown && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surf shadow-[var(--lf-shadow)]">
            {isLoading && results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-t3">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-t3">No results for &quot;{trimmed}&quot;.</p>
            ) : (
              results.map((track, i) => (
                <button
                  key={track.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => selectTrack(track)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${
                    i === activeIndex ? "bg-surf-2" : "hover:bg-surf-2"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-t1">{track.title ?? "Untitled"}</span>
                    <span className="block truncate font-mono text-xs text-t3">
                      {track.artistName ?? "Unknown artist"}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-t3">{formatDuration(track.durationSeconds)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-t3"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
