"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSimilarityJob, fetchSimilarityStatus, similarityJobEventsUrl, type SimilarityJob } from "@/lib/api/similarityClient";

const TERMINAL = new Set<SimilarityJob["status"]>(["completed", "completed_with_errors", "failed", "cancelled"]);

/** Bulk backfill trigger for the audio-similarity embeddings Smart Shuffle is built on (see
 *  components/shell/useSmartShuffle.ts) -- mirrors MixtapeFingerprintSection.tsx. Smart Shuffle
 *  otherwise has no visible status: the transport bar just greys the button out once similarity
 *  analysis for the current queue hasn't finished, with no indication why or how long it'll take
 *  (see components/shell/TransportBar.tsx's smartShuffleAvailable). The same analysis pass also
 *  fills in genre for tracks missing it, guessed from the audio itself (lib/similarity/queue.ts) —
 *  Spotify's genre field is deprecated, so this is the only automatic genre source left. */
export function SmartShuffleSection() {
  const queryClient = useQueryClient();
  const [jobProgress, setJobProgress] = useState<SimilarityJob | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  // Library-wide tally, not tied to any one job -- reflects similarity analysis that happens
  // automatically on import too, not just a backfill run from this button. Keeps polling while
  // there's anything left to do (whether or not *this* tab started the job), and stops once caught up.
  const statusQuery = useQuery({
    queryKey: ["similarity-status"],
    queryFn: fetchSimilarityStatus,
    refetchInterval: (query) => {
      const data = query.state.data;
      return !data || data.ready < data.total ? 4000 : false;
    },
  });

  const attach = useCallback(
    (jobId: number) => {
      sourceRef.current?.close();
      const source = new EventSource(similarityJobEventsUrl(jobId));
      sourceRef.current = source;
      source.addEventListener("update", (event) => {
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as { job: SimilarityJob };
        setJobProgress(snapshot.job);
        if (TERMINAL.has(snapshot.job.status)) {
          source.close();
          if (sourceRef.current === source) sourceRef.current = null;
          queryClient.invalidateQueries({ queryKey: ["similarity-status"] });
        }
      });
    },
    [queryClient]
  );

  const backfillMutation = useMutation({
    mutationFn: () => createSimilarityJob(),
    onSuccess: (job) => {
      setJobProgress(job);
      attach(job.id);
    },
  });

  const isRunning = jobProgress ? !TERMINAL.has(jobProgress.status) : false;
  const status = statusQuery.data;

  return (
    <div className="lf-card mt-3 rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-t1">Smart Shuffle</p>
          <p className="mt-0.5 text-sm text-t2">
            New imports are analyzed automatically. Run this once to backfill tracks already in your library so Smart
            Shuffle has enough analyzed tracks to pick from. This also fills in genre for tracks missing it, guessed from
            the audio — not always exact, and never overwrites a genre that&apos;s already set. Requires the Python backend
            running on this device.
          </p>
        </div>
        <button
          type="button"
          onClick={() => backfillMutation.mutate()}
          disabled={isRunning || backfillMutation.isPending || (status ? status.ready >= status.total && status.missingGenre === 0 : false)}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-50"
        >
          {isRunning ? "Analyzing…" : "Backfill library"}
        </button>
      </div>

      {backfillMutation.isError ? <p className="mt-2 text-xs text-err">{(backfillMutation.error as Error).message}</p> : null}

      {status ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-t2">
            <span>
              {status.ready} / {status.total} tracks analyzed
              {jobProgress && isRunning && jobProgress.failedTracks > 0 ? ` (${jobProgress.failedTracks} failed)` : ""}
            </span>
            {jobProgress && isRunning ? <span className="font-mono">{jobProgress.status}</span> : null}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-acc transition-[width]"
              style={{ width: `${status.total > 0 ? (status.ready / status.total) * 100 : 0}%` }}
            />
          </div>
          {/* Separate from the bar above: most of a library is typically already analyzed from
              before genre detection existed, so this can show real remaining work (and move as
              "Backfill library" re-runs those already-`ready` tracks) even while the bar above
              stays pinned at ready === total. */}
          {status.missingGenre > 0 ? (
            <p className="mt-1.5 text-xs text-t2">{status.missingGenre} / {status.total} tracks missing genre</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
