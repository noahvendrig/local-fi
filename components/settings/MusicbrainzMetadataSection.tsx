"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelMusicbrainzEnrichJob,
  createMusicbrainzEnrichJob,
  fetchMusicbrainzEnrichStatus,
  musicbrainzEnrichJobEventsUrl,
  type MusicbrainzEnrichJob,
} from "@/lib/api/musicbrainzEnrichClient";

const TERMINAL = new Set<MusicbrainzEnrichJob["status"]>(["completed", "completed_with_errors", "failed", "cancelled"]);
/** MusicBrainz allows one request a second, so a run is roughly a second per track. */
const SECONDS_PER_TRACK = 1.1;

function estimate(trackCount: number): string {
  const minutes = Math.round((trackCount * SECONDS_PER_TRACK) / 60);
  if (minutes < 1) return "under a minute";
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Looks the library up in MusicBrainz to fix the two metadata fields Vibe Radio most depends on.
 *
 * ORIGINAL RELEASE YEAR: a reissue's tag dates the reissue, so "Big Poppa - 2007 Remaster" reads as
 * 2007 rather than 1994 and can't be found by a "90s hip hop" prompt. Stored alongside the tag year
 * rather than replacing it, and only ever written when it's EARLIER — so this can't make an already
 * correct year worse.
 *
 * GENRE: replaces CNN14's audio guess (see Smart Shuffle below) with human-curated catalog tags.
 * A genre from the file's own tags, or one set by hand, is never touched.
 *
 * Unlike the Spotify card above this needs no account, at the cost of a strict rate limit — hence
 * the time estimate. Modeled on SpotifyMetadataSection's backfill-job/SSE-progress pattern.
 */
export function MusicbrainzMetadataSection() {
  const queryClient = useQueryClient();
  const [jobProgress, setJobProgress] = useState<MusicbrainzEnrichJob | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const statusQuery = useQuery({ queryKey: ["musicbrainz-enrich-status"], queryFn: fetchMusicbrainzEnrichStatus });

  const attach = useCallback(
    (jobId: number) => {
      sourceRef.current?.close();
      const source = new EventSource(musicbrainzEnrichJobEventsUrl(jobId));
      sourceRef.current = source;
      source.addEventListener("update", (event) => {
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as { job: MusicbrainzEnrichJob };
        setJobProgress(snapshot.job);
        if (TERMINAL.has(snapshot.job.status)) {
          source.close();
          if (sourceRef.current === source) sourceRef.current = null;
          queryClient.invalidateQueries({ queryKey: ["musicbrainz-enrich-status"] });
        }
      });
    },
    [queryClient]
  );

  // A run lasts minutes, so leaving the stream open after unmount would hold a server connection
  // for a component nobody is looking at.
  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  const backfillMutation = useMutation({
    mutationFn: () => createMusicbrainzEnrichJob(),
    onSuccess: (job) => {
      setJobProgress(job);
      attach(job.id);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: number) => cancelMusicbrainzEnrichJob(jobId),
    onSuccess: (job) => setJobProgress(job),
  });

  const isRunning = jobProgress ? !TERMINAL.has(jobProgress.status) : false;
  const status = statusQuery.data;

  return (
    <div className="lf-card mt-3 rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-t1">Improve genres and release years from MusicBrainz</p>
          <p className="mt-0.5 text-sm text-t2">
            Looks each track up in MusicBrainz to find its <em>original</em> release year — a remaster&apos;s tag dates the
            remaster, not the song — and to replace genres guessed from the audio with catalog ones. Both help Vibe Radio
            answer prompts like &ldquo;90s hip hop&rdquo;. Years only ever move earlier, and genres from your own file tags
            are never touched. No account needed.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => backfillMutation.mutate()}
            disabled={isRunning || backfillMutation.isPending || (status?.eligible ?? 0) === 0}
            className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-50"
          >
            {isRunning ? "Looking up…" : "Look up metadata"}
          </button>
          {isRunning && jobProgress ? (
            <button
              type="button"
              onClick={() => cancelMutation.mutate(jobProgress.id)}
              disabled={cancelMutation.isPending}
              className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-t2 hover:border-err hover:text-err disabled:opacity-50"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      {backfillMutation.isError ? <p className="mt-2 text-xs text-err">{(backfillMutation.error as Error).message}</p> : null}

      {status ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-4 text-xs text-t2">
            <span>
              {isRunning && jobProgress
                ? `${jobProgress.processedTracks} / ${jobProgress.totalTracks} checked — ${jobProgress.matchedTracks} improved` +
                  (jobProgress.failedTracks > 0 ? `, ${jobProgress.failedTracks} failed` : "")
                : status.eligible > 0
                  ? `${status.eligible} of ${status.total} tracks could be improved — ${status.missingOriginalYear} without an original release year, ${status.detectedGenre} with a genre guessed from audio`
                  : `All ${status.total} tracks have catalog metadata`}
            </span>
            {!isRunning && status.eligible > 0 ? <span className="shrink-0">Takes {estimate(status.eligible)}</span> : null}
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
