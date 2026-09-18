"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { STATUS_LABEL, STATUS_PROGRESS } from "@/components/ingest/JobFileRow";
import type { TrackSummary } from "@/lib/api-client";
import { submitSingleSpotifyTrack } from "@/lib/api/importClient";
import { fetchSpotifyStatus, searchSpotifyTracks } from "@/lib/api/spotifyClient";
import type { ImportJobWithFiles, SpotifyTrackMetadata } from "@/lib/api/types";
import { formatDuration } from "@/lib/format/track";
import { useIngestStore } from "@/lib/store/ingest";

const SUGGESTION_COUNT = 5;
// Spotify's catalog search doesn't support "more by this artist" directly, so this over-fetches
// a page of that artist's tracks and filters out ones already owned. 10 is the API's actual cap
// (see the matching comment in the search route) — not enough buffer to guarantee 5 survive
// filtering for a heavily-owned artist, but it's the most a single search call can return.
const SEARCH_LIMIT = 10;

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

/** "More from {artist}" — Spotify tracks by this artist not already in the local library,
 *  shown at the bottom of the artist page with a one-click download into local audio. */
export function ArtistSuggestedSongs({
  artistId,
  artistName,
  existingTracks,
}: {
  artistId: number;
  artistName: string;
  existingTracks: TrackSummary[];
}) {
  const [downloadingByUrl, setDownloadingByUrl] = useState<Record<string, number>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const jobs = useIngestStore((s) => s.jobs);
  const queryClient = useQueryClient();

  const spotifyStatusQuery = useQuery({ queryKey: ["spotify", "status"], queryFn: fetchSpotifyStatus });
  const connected = spotifyStatusQuery.data === true;

  const suggestionsQuery = useQuery({
    queryKey: ["spotify", "artist-suggestions", artistName],
    queryFn: () => searchSpotifyTracks(`artist:"${artistName}"`, SEARCH_LIMIT),
    enabled: connected && artistName.length > 0,
  });

  const ownedTitles = useMemo(() => new Set(existingTracks.map((t) => normalizeTitle(t.title ?? ""))), [existingTracks]);

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const results: SpotifyTrackMetadata[] = [];
    for (const track of suggestionsQuery.data ?? []) {
      const key = normalizeTitle(track.title);
      if (ownedTitles.has(key) || seen.has(key)) continue;
      seen.add(key);
      results.push(track);
      if (results.length === SUGGESTION_COUNT) break;
    }
    return results;
  }, [suggestionsQuery.data, ownedTitles]);

  // Same completion-tracking pattern as TopSearchBar's SpotifyResultRow downloads: once a
  // tracked job's file reaches a terminal status, drop the in-flight entry so the row reverts
  // to its resting state (and, on success, refresh the artist's track list to fold it in).
  useEffect(() => {
    for (const [spotifyUrl, jobId] of Object.entries(downloadingByUrl)) {
      const job = jobs.find((j) => j.id === jobId);
      const file = job?.files[0];
      if (!file) continue;
      if (file.status === "done" || file.status === "duplicate_skipped") {
        queryClient.invalidateQueries({ queryKey: ["tracks", { artistId }] });
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to external ingest store changes, not deriving from props
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
  }, [jobs, downloadingByUrl, queryClient, artistId]);

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

  if (!connected || suggestions.length === 0) return null;

  return (
    <div className="mt-10 border-t border-line pt-6">
      <h2 className="font-serif text-lg text-t1">More from {artistName}</h2>
      <p className="mt-1 font-mono text-xs text-t3">From Spotify — not yet in your library</p>

      <div className="mt-4 flex flex-col">
        {suggestions.map((track) => (
          <SuggestedSongRow
            key={track.spotifyUrl}
            track={track}
            jobId={downloadingByUrl[track.spotifyUrl]}
            jobs={jobs}
            onDownload={handleDownload}
          />
        ))}
      </div>
      {downloadError && <p className="mt-2 text-xs text-err">{downloadError}</p>}
    </div>
  );
}

function SuggestedSongRow({
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
    <div className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:border-line hover:bg-surf-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-t1">{track.title}</p>
        <p className="truncate font-mono text-xs text-t3">
          {track.artists.join(", ")}
          {track.album ? ` · ${track.album}` : ""}
        </p>
      </div>
      <span className="shrink-0 font-mono text-xs text-t3">{formatDuration(track.durationMs / 1000)}</span>
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
