"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TrackSummary } from "@/lib/api-client";
import {
  fetchDuplicateGroups,
  fetchHealthReport,
  fetchMissingTracks,
  removeDuplicateExtras,
  triggerScan,
  type DuplicateGroup,
} from "@/lib/api/healthClient";
import { deleteTrack, relinkTrack } from "@/lib/api/tracksClient";
import { formatDuration, formatRate } from "@/lib/format/track";
import { DEFAULT_TRASH_GRACE_DAYS } from "@/lib/library/trashConfig";
import { invalidateLibraryQueries } from "@/lib/query/invalidateLibrary";
import { usePlayerStore } from "@/lib/store/player";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { FormatBadge } from "@/components/library/FormatBadge";

function dropFromQueue(ids: number[]) {
  const removeTrackById = usePlayerStore.getState().removeTrackById;
  for (const id of ids) removeTrackById(id);
}

// Settings & Health view (ARCHITECTURE.md M10): stat tiles + per-issue rows with a working
// Relink/Remove/Review action, backed by GET /health/report, /health/missing, /health/duplicates
// and POST /scan.
export function HealthView() {
  const queryClient = useQueryClient();
  const [removeAllOpen, setRemoveAllOpen] = useState(false);

  const reportQuery = useQuery({ queryKey: ["health", "report"], queryFn: fetchHealthReport });
  const missingQuery = useQuery({ queryKey: ["health", "missing"], queryFn: () => fetchMissingTracks() });
  const duplicatesQuery = useQuery({
    queryKey: ["health", "duplicates"],
    queryFn: () => fetchDuplicateGroups({ limit: 100 }),
  });

  const scanMutation = useMutation({
    mutationFn: triggerScan,
    onSuccess: () => invalidateLibraryQueries(queryClient),
  });

  const removeAllMutation = useMutation({
    mutationFn: () => removeDuplicateExtras(),
    onSuccess: (result) => {
      dropFromQueue(result.removedIds);
      setRemoveAllOpen(false);
      invalidateLibraryQueries(queryClient);
    },
  });

  const report = reportQuery.data;
  const groups = duplicatesQuery.data?.items ?? [];
  const extrasCount = groups.reduce((count, group) => count + Math.max(0, group.tracks.length - 1), 0);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-10 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-[1.2] text-t1">Library health</h1>
        </div>
        <button
          type="button"
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="lf-top rounded-lg border border-acc bg-acc px-5 py-2.5 text-[13px] font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2 disabled:opacity-50"
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
          <ul className="mt-3 flex flex-col gap-2.5">
            {missingQuery.data.items.map((track) => (
              <MissingTrackRow key={track.id} track={track} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 pb-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-t3">Probable duplicates</h2>
          {groups.length > 0 ? (
            <button
              type="button"
              onClick={() => setRemoveAllOpen(true)}
              disabled={removeAllMutation.isPending}
              className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-err hover:border-err hover:bg-surf-2 disabled:opacity-50"
            >
              Remove all duplicates
            </button>
          ) : null}
        </div>
        {removeAllMutation.isError && (
          <p className="mt-2 text-xs text-err">{(removeAllMutation.error as Error).message}</p>
        )}
        {duplicatesQuery.isLoading ? (
          <p className="mt-3 text-sm text-t3">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="mt-3 text-sm text-t3">No probable duplicates found.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {groups.map((group) => (
              <DuplicateGroupCard key={group.key} group={group} />
            ))}
          </div>
        )}
      </section>

      {removeAllOpen ? (
        <ConfirmDialog
          title="Remove all duplicates"
          message={`Keep one copy in each of ${groups.length} group${groups.length === 1 ? "" : "s"} (lossless / higher bitrate first) and move ${extrasCount} extra${extrasCount === 1 ? "" : "s"} to Trash. You can restore them for ${DEFAULT_TRASH_GRACE_DAYS} days.`}
          confirmLabel="Remove all duplicates"
          danger
          isPending={removeAllMutation.isPending}
          onConfirm={() => removeAllMutation.mutate()}
          onClose={() => setRemoveAllOpen(false)}
        />
      ) : null}
    </div>
  );
}

function StatTile({ label, value, warn }: { label: string; value: number | undefined; warn: boolean }) {
  return (
    <div className="lf-card rounded-2xl p-4">
      <p className={`mb-2 font-mono text-xs ${warn ? "text-warn" : "text-t2"}`}>{value ?? "—"}</p>
      <p className="text-base font-semibold text-t1">{label}</p>
    </div>
  );
}

function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const queryClient = useQueryClient();
  const extrasInGroup = group.tracks.filter((track) => track.id !== group.keeperId).length;

  const removeExtrasMutation = useMutation({
    mutationFn: () => removeDuplicateExtras(group.key),
    onSuccess: (result) => {
      dropFromQueue(result.removedIds);
      invalidateLibraryQueries(queryClient);
    },
  });

  return (
    <div className="lf-card rounded-lg p-3.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-t3">
          {group.tracks.length} tracks look like duplicates
        </p>
        {extrasInGroup > 0 ? (
          <button
            type="button"
            onClick={() => removeExtrasMutation.mutate()}
            disabled={removeExtrasMutation.isPending}
            className="shrink-0 rounded-lg border border-line bg-surf-2 px-3 py-1.5 text-xs font-medium text-t3 hover:border-err hover:text-err disabled:opacity-50"
          >
            {removeExtrasMutation.isPending ? "Removing…" : "Remove extras"}
          </button>
        ) : null}
      </div>
      {removeExtrasMutation.isError && (
        <p className="mb-2 text-xs text-err">{(removeExtrasMutation.error as Error).message}</p>
      )}
      <ul className="flex flex-col gap-1.5">
        {group.tracks.map((track) => (
          <DuplicateTrackRow key={track.id} track={track} isKeeper={track.id === group.keeperId} />
        ))}
      </ul>
    </div>
  );
}

function DuplicateTrackRow({ track, isKeeper }: { track: TrackSummary; isKeeper: boolean }) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="min-w-0 flex-1 truncate text-t1">{track.title ?? "Untitled"}</span>
      <span className="min-w-0 truncate text-t3">{track.artistName ?? "Unknown artist"}</span>
      <FormatBadge format={track.format} lossless={track.lossless} />
      <span className="shrink-0 font-mono text-xs text-t3">{formatRate(track)}</span>
      <span className="shrink-0 font-mono text-xs text-t3">{formatDuration(track.durationSeconds)}</span>
      {isKeeper ? (
        <span className="shrink-0 rounded border border-line px-[7px] py-[3px] font-mono text-[10px] uppercase tracking-wide text-ok">
          Keep
        </span>
      ) : null}
    </li>
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
      invalidateLibraryQueries(queryClient);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => deleteTrack(track.id, true),
    onSuccess: () => invalidateLibraryQueries(queryClient),
  });

  return (
    <li className="lf-card flex flex-col gap-2 rounded-lg px-3.5 py-3.5">
      <div className="flex items-center gap-3.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-err" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-t1">{track.title ?? "Untitled"}</p>
          <p className="truncate font-mono text-xs text-t3">{track.artistName ?? "Unknown artist"}</p>
        </div>
        <button
          type="button"
          onClick={() => (expanded ? relinkMutation.mutate() : setExpanded(true))}
          disabled={relinkMutation.isPending}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-50"
        >
          {relinkMutation.isPending ? "Relinking…" : expanded ? "Confirm relink" : "Relink"}
        </button>
        <button
          type="button"
          onClick={() => removeMutation.mutate()}
          disabled={removeMutation.isPending}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-err hover:border-err hover:bg-surf-2 disabled:opacity-50"
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
          className="rounded-lg border border-line bg-surf-2 px-2 py-1.5 text-xs text-t1"
        />
      )}
      {relinkMutation.isError && <p className="text-xs text-err">{(relinkMutation.error as Error).message}</p>}
    </li>
  );
}
