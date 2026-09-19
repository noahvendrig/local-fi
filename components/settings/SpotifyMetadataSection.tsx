"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSpotifyEnrichJob,
  fetchSpotifyEnrichStatus,
  spotifyEnrichJobEventsUrl,
  type SpotifyEnrichJob,
} from "@/lib/api/spotifyEnrichClient";
import { fetchSpotifyStatus } from "@/lib/api/spotifyClient";

const TERMINAL = new Set<SpotifyEnrichJob["status"]>(["completed", "completed_with_errors", "failed", "cancelled"]);

/** Fills in genre/release-year for library tracks missing either, by matching them against the
 *  Spotify catalog on title+artist — never overwrites a value that's already set, and tracks with
 *  no confident Spotify match are just skipped (not every local track is on Spotify's catalog).
 *  Modeled on MixtapeFingerprintSection's backfill-job/SSE-progress pattern. */
export function SpotifyMetadataSection() {
  const queryClient = useQueryClient();
  const [jobProgress, setJobProgress] = useState<SpotifyEnrichJob | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const connectedQuery = useQuery({ queryKey: ["spotify-status"], queryFn: fetchSpotifyStatus });
  const connected = connectedQuery.data === true;

  const statusQuery = useQuery({
    queryKey: ["spotify-enrich-status"],
    queryFn: fetchSpotifyEnrichStatus,
    enabled: connected,
  });

  const attach = useCallback(
    (jobId: number) => {
      sourceRef.current?.close();
      const source = new EventSource(spotifyEnrichJobEventsUrl(jobId));
      sourceRef.current = source;
      source.addEventListener("update", (event) => {
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as { job: SpotifyEnrichJob };
        setJobProgress(snapshot.job);
        if (TERMINAL.has(snapshot.job.status)) {
          source.close();
          if (sourceRef.current === source) sourceRef.current = null;
          queryClient.invalidateQueries({ queryKey: ["spotify-enrich-status"] });
        }
      });
    },
    [queryClient]
  );

  const backfillMutation = useMutation({
    mutationFn: () => createSpotifyEnrichJob(),
    onSuccess: (job) => {
      setJobProgress(job);
      attach(job.id);
    },
  });

  if (!connected) return null;

  const isRunning = jobProgress ? !TERMINAL.has(jobProgress.status) : false;
  const status = statusQuery.data;

  return (
    <div className="lf-card mt-3 rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-t1">Fill missing metadata from Spotify</p>
          <p className="mt-0.5 text-sm text-t2">
            Looks up tracks missing genre or release year on Spotify and fills in whatever it finds. Existing values are never
            replaced, and tracks with no match on Spotify are left alone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => backfillMutation.mutate()}
          disabled={isRunning || backfillMutation.isPending || (status?.missing ?? 0) === 0}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-50"
        >
          {isRunning ? "Filling in…" : "Fill missing metadata"}
        </button>
      </div>

      {backfillMutation.isError ? <p className="mt-2 text-xs text-err">{(backfillMutation.error as Error).message}</p> : null}

      {status ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-t2">
            <span>
              {isRunning && jobProgress
                ? `${jobProgress.processedTracks} / ${jobProgress.totalTracks} checked — ${jobProgress.matchedTracks} filled in` +
                  (jobProgress.failedTracks > 0 ? `, ${jobProgress.failedTracks} failed` : "")
                : status.missing > 0
                  ? `${status.missing} / ${status.total} tracks missing genre or release year`
                  : `All ${status.total} tracks have genre and release year`}
            </span>
          </div>
          {isRunning && jobProgress ? (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-acc transition-[width]"
                style={{ width: `${jobProgress.totalTracks > 0 ? (jobProgress.processedTracks / jobProgress.totalTracks) * 100 : 0}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
