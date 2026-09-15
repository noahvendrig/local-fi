"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createFingerprintJob, fingerprintJobEventsUrl, type FingerprintJob } from "@/lib/api/fingerprintClient";

const TERMINAL = new Set<FingerprintJob["status"]>(["completed", "completed_with_errors", "failed", "cancelled"]);

/** Bulk backfill trigger for the audio-fingerprint index that mixtape matching (lib/mixtapes/,
 *  lib/fingerprint/) is built on — there's no other "fingerprint the whole library" affordance,
 *  since fingerprinting otherwise only happens automatically on import. */
export function MixtapeFingerprintSection() {
  const [progress, setProgress] = useState<FingerprintJob | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const attach = useCallback((jobId: number) => {
    sourceRef.current?.close();
    const source = new EventSource(fingerprintJobEventsUrl(jobId));
    sourceRef.current = source;
    source.addEventListener("update", (event) => {
      const snapshot = JSON.parse((event as MessageEvent<string>).data) as { job: FingerprintJob };
      setProgress(snapshot.job);
      if (TERMINAL.has(snapshot.job.status)) {
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
      }
    });
  }, []);

  const backfillMutation = useMutation({
    mutationFn: () => createFingerprintJob(),
    onSuccess: (job) => {
      setProgress(job);
      attach(job.id);
    },
  });

  const isRunning = progress ? !TERMINAL.has(progress.status) : false;

  return (
    <div className="lf-card mt-3 rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-t1">Mixtape matching</p>
          <p className="mt-0.5 text-sm text-t2">
            New imports are fingerprinted automatically. Run this once to backfill tracks already in your library so{" "}
            <Link href="/mixtapes" className="underline hover:text-t1">
              Mixtapes
            </Link>{" "}
            can match against them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => backfillMutation.mutate()}
          disabled={isRunning || backfillMutation.isPending}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-50"
        >
          {isRunning ? "Fingerprinting…" : "Backfill library"}
        </button>
      </div>

      {backfillMutation.isError ? <p className="mt-2 text-xs text-err">{(backfillMutation.error as Error).message}</p> : null}

      {progress ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-t2">
            <span>
              {progress.processedTracks} / {progress.totalTracks} tracks
              {progress.failedTracks > 0 ? ` (${progress.failedTracks} failed)` : ""}
            </span>
            <span className="font-mono">{progress.status}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-acc transition-[width]"
              style={{ width: `${progress.totalTracks > 0 ? (progress.processedTracks / progress.totalTracks) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
