"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { analyzeMixtape, mixtapeJobEventsUrl, type MixtapeJob } from "@/lib/api/mixtapesClient";

const TERMINAL = new Set<MixtapeJob["status"]>(["completed", "completed_with_errors", "failed", "cancelled"]);

/**
 * Drives a mixtape's match-analysis progress: reattaches to an already-running job on mount
 * (e.g. the upload route auto-started one) and exposes `startAnalysis` for a manual re-run.
 * Mirrors components/crates/dj/useAnalysisRunner.ts's job-then-SSE shape.
 */
export function useMixtapeAnalysisProgress(mixtapeId: number, latestJob: MixtapeJob | null) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<MixtapeJob | null>(latestJob);
  const sourceRef = useRef<EventSource | null>(null);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["mixtape", mixtapeId] });
  }, [mixtapeId, queryClient]);

  const attach = useCallback(
    (jobId: number) => {
      sourceRef.current?.close();
      const source = new EventSource(mixtapeJobEventsUrl(jobId));
      sourceRef.current = source;
      source.addEventListener("update", (event) => {
        const job = JSON.parse((event as MessageEvent<string>).data) as MixtapeJob;
        setProgress(job);
        invalidate();
        if (TERMINAL.has(job.status)) {
          source.close();
          if (sourceRef.current === source) sourceRef.current = null;
        }
      });
    },
    [invalidate]
  );

  useEffect(() => {
    if (latestJob && !TERMINAL.has(latestJob.status)) {
      attach(latestJob.id);
    }
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
    // Only re-attach when the job identity changes, not on every latestJob field update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestJob?.id]);

  const startAnalysis = useCallback(
    async (force = false) => {
      const job = await analyzeMixtape(mixtapeId, force);
      setProgress(job);
      invalidate();
      attach(job.id);
      return job;
    },
    [mixtapeId, invalidate, attach]
  );

  return { progress, startAnalysis };
}
