"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { analysisJobEventsUrl, createAnalysisJob, type AnalysisJobStatus } from "@/lib/api/analysisClient";

const TERMINAL = new Set<AnalysisJobStatus>(["completed", "completed_with_errors", "failed", "cancelled"]);

export interface AnalysisProgress {
  jobId: number;
  total: number;
  processed: number;
  status: AnalysisJobStatus;
}

/**
 * Drives on-demand BPM/key analysis for a crate's DJ view: starts a job (single track or a bulk
 * crate-wide batch — same endpoint either way) and tracks its SSE progress. One shared connection
 * at a time keeps a bulk "Analyze crate" pass from racing dozens of per-row EventSource streams;
 * every update invalidates the crate query, which is enough for a row started while another job
 * is in flight to still converge to the right state once any subsequent update lands.
 */
export function useAnalysisRunner(playlistId: number) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
  }, [playlistId, queryClient]);

  const startAnalysis = useCallback(
    async (trackIds: number[]) => {
      if (trackIds.length === 0) return;
      const job = await createAnalysisJob(trackIds);
      setProgress({ jobId: job.id, total: job.totalTracks, processed: job.processedTracks, status: job.status });
      invalidate();

      sourceRef.current?.close();
      const source = new EventSource(analysisJobEventsUrl(job.id));
      sourceRef.current = source;
      source.addEventListener("update", (event) => {
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as {
          job: { id: number; status: AnalysisJobStatus; totalTracks: number; processedTracks: number };
        };
        setProgress({
          jobId: snapshot.job.id,
          total: snapshot.job.totalTracks,
          processed: snapshot.job.processedTracks,
          status: snapshot.job.status,
        });
        invalidate();
        if (TERMINAL.has(snapshot.job.status)) {
          source.close();
          if (sourceRef.current === source) sourceRef.current = null;
        }
      });
    },
    [invalidate]
  );

  return { progress, startAnalysis };
}
