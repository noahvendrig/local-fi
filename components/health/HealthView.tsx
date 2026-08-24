"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TrackSummary } from "@/lib/api-client";
import { fetchDuplicateGroups, fetchHealthReport, fetchMissingTracks, triggerScan } from "@/lib/api/healthClient";
import { deleteTrack, relinkTrack } from "@/lib/api/tracksClient";
import { formatDuration, formatRate } from "@/lib/format/track";
import { FormatBadge } from "@/components/library/FormatBadge";

function invalidateHealthAndLibrary(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["health"] });
  queryClient.invalidateQueries({ queryKey: ["tracks"] });
  queryClient.invalidateQueries({ queryKey: ["albums"] });
}

// Settings & Health view (ARCHITECTURE.md M10): stat tiles + per-issue rows with a working
// Relink/Remove/Review action, backed by GET /health/report, /health/missing, /health/duplicates
// and POST /scan.
export function HealthView() {
  const queryClient = useQueryClient();

  const reportQuery = useQuery({ queryKey: ["health", "report"], queryFn: fetchHealthReport });
  const missingQuery = useQuery({ queryKey: ["health", "missing"], queryFn: () => fetchMissingTracks() });
  const duplicatesQuery = useQuery({ queryKey: ["health", "duplicates"], queryFn: () => fetchDuplicateGroups() });

  const scanMutation = useMutation({
    mutationFn: triggerScan,
    onSuccess: () => invalidateHealthAndLibrary(queryClient),
  });

  const report = reportQuery.data;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-8">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl text-t1">Library Health</h1>
        <button
          type="button"
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="rounded-full bg-acc px-4 py-2 text-sm font-medium text-[var(--lf-on-acc)] hover:bg-acc-2 disabled:opacity-50"
        >
          {scanMutation.isPending ? "Scanning…" : "Rescan library"}
        </button>
      </div>
      {scanMutation.isError && <p className="mt-2 text-xs text-err">{(scanMutation.error as Error).message}</p>}

      <div className="mt-6 grid grid-cols-3 gap-4">
        <StatTile label="Missing files" value={report?.missingCount} warn={!!report && report.missingCount > 0} />
        <StatTile label="Duplicate groups" value={report?.duplicateGroupCount} warn={!!report && report.duplicateGroupCount > 0} />
        <StatTile label="Pending waveforms" value={report?.pendingWaveformCount} warn={false} />
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-t3">Missing tracks</h2>
        {missingQuery.isLoading ? (
          <p className="mt-3 text-sm text-t3">Loading…</p>
        ) : !missingQuery.data || missingQuery.data.items.length === 0 ? (
          <p className="mt-3 text-sm text-t3">Nothing missing.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {missingQuery.data.items.map((track) => (
              <MissingTrackRow key={track.id} track={track} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 pb-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-t3">Probable duplicates</h2>
        {duplicatesQuery.isLoading ? (
          <p className="mt-3 text-sm text-t3">Loading…</p>
        ) : !duplicatesQuery.data || duplicatesQuery.data.items.length === 0 ? (
          <p className="mt-3 text-sm text-t3">No probable duplicates found.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {duplicatesQuery.data.items.map((group) => (
              <div key={group.key} className="rounded-lg border border-line p-3">
                <p className="mb-2 text-xs text-t3">
                  {group.tracks.length} tracks look like duplicates
                </p>
                <ul className="flex flex-col gap-1.5">
                  {group.tracks.map((track) => (
                    <li key={track.id} className="flex items-center gap-3 text-sm">
                      <span className="min-w-0 flex-1 truncate text-t1">{track.title ?? "Untitled"}</span>
                      <span className="truncate text-t3">{track.artistName ?? "Unknown artist"}</span>
                      <FormatBadge format={track.format} lossless={track.lossless} />
                      <span className="shrink-0 font-mono text-xs text-t3">{formatRate(track)}</span>
                      <span className="shrink-0 font-mono text-xs text-t3">{formatDuration(track.durationSeconds)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value, warn }: { label: string; value: number | undefined; warn: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surf p-4">
      <p className="text-xs text-t3">{label}</p>
      <p className={`mt-1 font-mono text-2xl ${warn ? "text-warn" : "text-t1"}`}>{value ?? "—"}</p>
    </div>
  );
}

function MissingTrackRow({ track }: { track: TrackSummary }) {
  const queryClient = useQueryClient();
  const [relinkPath, setRelinkPath] = useState("");
  const [expanded, setExpanded] = useState(false);

  const relinkMutation = useMutation({
    mutationFn: () => relinkTrack(track.id, relinkPath.trim() || undefined),
    onSuccess: () => {
      setExpanded(false);
      setRelinkPath("");
      invalidateHealthAndLibrary(queryClient);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => deleteTrack(track.id, true),
    onSuccess: () => invalidateHealthAndLibrary(queryClient),
  });

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-t1">{track.title ?? "Untitled"}</p>
          <p className="truncate text-xs text-t3">{track.artistName ?? "Unknown artist"}</p>
        </div>
        <button
          type="button"
          onClick={() => (expanded ? relinkMutation.mutate() : setExpanded(true))}
          disabled={relinkMutation.isPending}
          className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs text-t1 hover:bg-surf-2 disabled:opacity-50"
        >
          {relinkMutation.isPending ? "Relinking…" : expanded ? "Confirm relink" : "Relink"}
        </button>
        <button
          type="button"
          onClick={() => removeMutation.mutate()}
          disabled={removeMutation.isPending}
          className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs text-err hover:bg-surf-2 disabled:opacity-50"
        >
          {removeMutation.isPending ? "Removing…" : "Remove"}
        </button>
      </div>
      {expanded && (
        <input
          type="text"
          value={relinkPath}
          onChange={(e) => setRelinkPath(e.target.value)}
          placeholder="Leave blank to re-check the original location, or paste a new path inside the data dir"
          className="rounded-md border border-line bg-surf-2 px-2 py-1.5 text-xs text-t1"
        />
      )}
      {relinkMutation.isError && <p className="text-xs text-err">{(relinkMutation.error as Error).message}</p>}
    </li>
  );
}
