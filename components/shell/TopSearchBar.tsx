"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { STATUS_LABEL, STATUS_PROGRESS } from "@/components/ingest/JobFileRow";
import { fetchTracks, type TrackSummary } from "@/lib/api-client";
import { useHasCredentials } from "@/lib/api/http";
import { submitSingleSpotifyTrack } from "@/lib/api/importClient";
import { fetchSpotifyStatus, searchSpotifyTracks } from "@/lib/api/spotifyClient";
import type { ImportJobWithFiles, SpotifyTrackMetadata } from "@/lib/api/types";
import { formatDuration } from "@/lib/format/track";
import { getAllOfflineTracks } from "@/lib/offline/db";
import { offlineTrackToSummary } from "@/lib/offline/trackSummary";
import { useIngestStore } from "@/lib/store/ingest";
import { usePlayerStore } from "@/lib/store/player";
import { CloseIcon } from "./PlayerIcons";

const RESULT_LIMIT = 8;
const SPOTIFY_DEBOUNCE_MS = 400;
const SPOTIFY_MIN_QUERY_LENGTH = 2;

// Always-mounted search bar pinned to the top of the shell (app/layout.tsx), distinct from
// CommandPalette's ⌘K modal — visible from every section without needing the shortcut.
export function TopSearchBar() {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  // Spotify track downloads currently in flight from this bar, keyed by spotifyUrl so more
  // than one row can download independently (the python backend just queues extras behind
  // MAX_CONCURRENT_JOBS rather than rejecting them).
  const [downloadingByUrl, setDownloadingByUrl] = useState<Record<string, number>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const hasCredentials = useHasCredentials();
  const jobs = useIngestStore((s) => s.jobs);
  const queryClient = useQueryClient();

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
  const localSettled = !tracksQuery.isLoading && !offlineTracksQuery.isLoading;
  const showDropdown = isFocused && trimmed.length > 0;

  const spotifyStatusQuery = useQuery({
    queryKey: ["spotify", "status"],
    queryFn: fetchSpotifyStatus,
    enabled,
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(trimmed), SPOTIFY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  // Only offer the Spotify fallback once local library search has actually come back empty —
  // avoids flashing Spotify results while fetchTracks/offline lookup are still in flight.
  const shouldSearchSpotify =
    enabled &&
    localSettled &&
    results.length === 0 &&
    spotifyStatusQuery.data === true &&
    debouncedQuery === trimmed &&
    debouncedQuery.length >= SPOTIFY_MIN_QUERY_LENGTH;

  const spotifySearchQuery = useQuery({
    queryKey: ["spotify", "search", debouncedQuery],
    queryFn: () => searchSpotifyTracks(debouncedQuery),
    enabled: shouldSearchSpotify,
  });

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // Once a tracked download's file reaches a terminal status: on success, drop the local
  // "tracks" query cache for this search so the new track reappears as a normal local result
  // (which then hides this whole Spotify branch, since `results.length` becomes > 0); on
  // failure, surface the error and let the row revert to a retryable Download button. `jobs`
  // is genuinely external state (the ingest store, updated from an SSE subscription outside
  // React), so reacting to its changes here — rather than in the event handler that started
  // the download — is the legitimate case react-hooks/set-state-in-effect's own guidance
  // carves out, not the derived-state-from-props anti-pattern it targets.
  useEffect(() => {
    for (const [spotifyUrl, jobId] of Object.entries(downloadingByUrl)) {
      const job = jobs.find((j) => j.id === jobId);
      const file = job?.files[0];
      if (!file) continue;
      if (file.status === "done" || file.status === "duplicate_skipped") {
        queryClient.invalidateQueries({ queryKey: ["search", "tracks", trimmed] });
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
        setDownloadingByUrl((m) => {
          const next = { ...m };
          delete next[spotifyUrl];
          return next;
        });
      } else if (file.status === "failed") {
        setDownloadError(file.errorMessage ?? "Download failed.");
        setDownloadingByUrl((m) => {
          const next = { ...m };
          delete next[spotifyUrl];
          return next;
        });
      }
    }
  }, [jobs, downloadingByUrl, queryClient, trimmed]);

  function selectTrack(track: TrackSummary) {
    playTrack(track, results);
    setQuery("");
    setIsFocused(false);
  }

  async function handleDownload(track: SpotifyTrackMetadata) {
    setDownloadError(null);
    try {
      const job = await submitSingleSpotifyTrack(track);
      setDownloadingByUrl((m) => ({ ...m, [track.spotifyUrl]: job.id }));
      useIngestStore.getState().trackJob(job);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    }
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
      inputRef.current?.blur();
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
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
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
              <div className="py-1">
                {spotifyStatusQuery.data === false ? (
                  <div className="px-4 py-6 text-center text-sm text-t3">
                    <p>No results for &quot;{trimmed}&quot;.</p>
                    <a href="/settings" className="mt-1 inline-block text-xs text-acc hover:underline">
                      Connect Spotify to search online
                    </a>
                  </div>
                ) : shouldSearchSpotify && spotifySearchQuery.isLoading ? (
                  <p className="px-4 py-6 text-center text-sm text-t3">Searching Spotify…</p>
                ) : shouldSearchSpotify && (spotifySearchQuery.data?.length ?? 0) > 0 ? (
                  <>
                    <p className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-t3">From Spotify</p>
                    {spotifySearchQuery.data!.map((track) => (
                      <SpotifyResultRow
                        key={track.spotifyUrl}
                        track={track}
                        jobId={downloadingByUrl[track.spotifyUrl]}
                        jobs={jobs}
                        onDownload={handleDownload}
                      />
                    ))}
                    {downloadError && <p className="px-4 pt-1 pb-2 text-xs text-err">{downloadError}</p>}
                  </>
                ) : shouldSearchSpotify ? (
                  <p className="px-4 py-6 text-center text-sm text-t3">No matches on Spotify either.</p>
                ) : (
                  <p className="px-4 py-6 text-center text-sm text-t3">No results for &quot;{trimmed}&quot;.</p>
                )}
              </div>
            ) : (
              results.map((track, i) => (
                <button
                  key={track.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => {
                    selectTrack(track);
                    inputRef.current?.blur();
                  }}
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

function SpotifyResultRow({
  track,
  jobId,
  jobs,
  onDownload,
}: {
  track: SpotifyTrackMetadata;
  jobId: number | undefined;
  jobs: ImportJobWithFiles[];
  onDownload: (track: SpotifyTrackMetadata) => void;
}) {
  const file = jobId ? jobs.find((j) => j.id === jobId)?.files[0] : undefined;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-t1">{track.title}</span>
        <span className="block truncate font-mono text-xs text-t3">
          {track.artists.join(", ")}
          {track.album ? ` · ${track.album}` : ""}
        </span>
      </span>
      {jobId ? (
        <span className="w-24 shrink-0">
          <span className="block truncate text-right font-mono text-[10px] text-t3">
            {file ? STATUS_LABEL[file.status] : "Starting…"}
          </span>
          <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surf-2">
            <span
              className="block h-full rounded-full bg-acc transition-all"
              style={{ width: `${file ? STATUS_PROGRESS[file.status] : 0}%` }}
            />
          </span>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onDownload(track)}
          className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-t1 hover:bg-surf-2"
        >
          Download
        </button>
      )}
    </div>
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
