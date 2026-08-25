"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addLibraryRoot,
  fetchLibraryRoots,
  removeLibraryRoot,
  rescanLibraryRoot,
  setLibraryRootSync,
  type LibraryRoot,
} from "@/lib/api/libraryRootsClient";
import type { ImportJobWithFiles } from "@/lib/api/types";
import { useIngestStore } from "@/lib/store/ingest";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";

const ACTIVE_JOB = new Set(["pending", "running"]);
const ACTIVE_FILE = new Set(["reading_tags", "transcoding_waveform", "saving"]);

function folderNameFromPath(folderPath: string): string {
  const trimmed = folderPath.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || folderPath;
}

function findFolderScanJob(
  jobs: ImportJobWithFiles[],
  rootId: number | undefined,
  mappedJobId: number | undefined
): ImportJobWithFiles | undefined {
  return jobs.find((job) => {
    if (job.type !== "folder_scan" || !ACTIVE_JOB.has(job.status)) return false;
    if (mappedJobId != null && job.id === mappedJobId) return true;
    if (rootId == null) return false;
    return job.files.some((file) => file.libraryRootId === rootId);
  });
}

/**
 * Watched-folder management. Lives on Import so add/rescan can share the ingest job
 * stream; progress itself is shown on the folder row (in context) rather than as a
 * per-file dump in the copy-on-import tray. ImportView invalidates ["library-roots"]
 * when a tracked job reaches a terminal state so counts refresh after indexing.
 */
export function LibraryFoldersSection() {
  const queryClient = useQueryClient();
  const trackJob = useIngestStore((s) => s.trackJob);
  const cancelJob = useIngestStore((s) => s.cancelJob);
  const jobs = useIngestStore((s) => s.jobs);
  const { data, isLoading } = useQuery({ queryKey: ["library-roots"], queryFn: fetchLibraryRoots });
  const roots = data?.items ?? [];

  const [newPath, setNewPath] = useState("");
  const [syncToCrate, setSyncToCrate] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<LibraryRoot | null>(null);
  const [jobByRootId, setJobByRootId] = useState<Record<number, number>>({});

  const addMutation = useMutation({
    mutationFn: () => addLibraryRoot(newPath.trim(), undefined, syncToCrate),
    onSuccess: (root) => {
      const { importJob, ...listRoot } = root;
      queryClient.setQueryData<{ items: LibraryRoot[] }>(["library-roots"], (old) => {
        const items = old?.items ?? [];
        if (items.some((item) => item.id === listRoot.id)) return old;
        return { items: [...items, listRoot] };
      });
      setNewPath("");
      setSyncToCrate(false);
      setAddError(null);
      if (ACTIVE_JOB.has(importJob.status)) {
        setJobByRootId((prev) => ({ ...prev, [root.id]: importJob.id }));
      }
      trackJob(importJob);
      void queryClient.invalidateQueries({ queryKey: ["library-roots"] });
    },
    onError: (err: Error) => setAddError(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => removeLibraryRoot(id),
    onSuccess: () => {
      setPendingRemove(null);
      void queryClient.invalidateQueries({ queryKey: ["library-roots"] });
    },
  });

  const rescanMutation = useMutation({
    mutationFn: (id: number) => rescanLibraryRoot(id),
    onSuccess: (job, id) => {
      if (ACTIVE_JOB.has(job.status)) {
        setJobByRootId((prev) => ({ ...prev, [id]: job.id }));
      }
      trackJob(job);
      void queryClient.invalidateQueries({ queryKey: ["library-roots"] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: ({ id, sync }: { id: number; sync: boolean }) => setLibraryRootSync(id, sync),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["library-roots"] });
      void queryClient.invalidateQueries({ queryKey: ["playlists"] });
    },
  });

  function handleAdd() {
    if (!newPath.trim() || addMutation.isPending) return;
    addMutation.mutate();
  }

  // Re-link active folder_scan jobs to roots after a page refresh (hydrateJobs).
  useEffect(() => {
    const fromJobs: Record<number, number> = {};
    for (const job of jobs) {
      if (job.type !== "folder_scan" || !ACTIVE_JOB.has(job.status)) continue;
      for (const file of job.files) {
        if (file.libraryRootId != null) {
          fromJobs[file.libraryRootId] = job.id;
          break;
        }
      }
    }
    if (Object.keys(fromJobs).length === 0) return;
    setJobByRootId((prev) => {
      const merged = { ...fromJobs, ...prev };
      const prevKeys = Object.keys(prev);
      const mergedKeys = Object.keys(merged);
      if (prevKeys.length === mergedKeys.length && prevKeys.every((key) => prev[Number(key)] === merged[Number(key)])) {
        return prev;
      }
      return merged;
    });
  }, [jobs]);

  return (
    <section className="mt-8">
      <div className="mb-3.5 flex items-center gap-2.5">
        <h2 className="text-xl font-semibold leading-[1.3] text-t1">Library folders</h2>
        <span className="font-mono text-xs text-t3">watched in place — files are never copied</span>
      </div>

      <div className="lf-card rounded-2xl px-5 py-4">
        <label htmlFor="library-root-path" className="text-xs font-medium uppercase tracking-wide text-t3">
          Folder path
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="library-root-path"
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            placeholder="D:\Music"
            disabled={addMutation.isPending}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surf px-3 py-2 font-mono text-sm text-t1 placeholder:text-t3 focus:border-acc focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newPath.trim() || addMutation.isPending}
            className="shrink-0 rounded-lg bg-acc px-4 py-2 text-sm font-medium text-on-acc hover:bg-acc-2 disabled:opacity-50"
          >
            {addMutation.isPending ? "Finding files…" : "Add folder"}
          </button>
        </div>
        <label className="mt-3 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={syncToCrate}
            onChange={(e) => setSyncToCrate(e.target.checked)}
            disabled={addMutation.isPending}
            className="mt-0.5 h-3.5 w-3.5 rounded border-line accent-[var(--lf-acc)]"
          />
          <span className="text-sm text-t2">
            <span className="text-t1">Sync to playlist</span> — creates a crate that mirrors this folder (and one per
            subfolder), kept in sync as files are added or removed here.
          </span>
        </label>

        {addError ? <p className="mt-2 text-sm text-err">{addError}</p> : null}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {isLoading ? <p className="text-sm text-t3">Loading…</p> : null}
        {!isLoading && roots.length === 0 && !addMutation.isPending ? (
          <p className="text-sm text-t3">No watched folders yet. Add one above.</p>
        ) : null}
        {addMutation.isPending && newPath.trim() ? <DiscoveringFolderRow path={newPath.trim()} /> : null}
        {roots.map((root) => {
          const scanJob = findFolderScanJob(jobs, root.id, jobByRootId[root.id]);
          const isDiscovering = rescanMutation.isPending && rescanMutation.variables === root.id && !scanJob;
          return (
            <LibraryRootRow
              key={root.id}
              root={root}
              scanJob={scanJob}
              isDiscovering={isDiscovering}
              onRescan={() => rescanMutation.mutate(root.id)}
              onCancelScan={scanJob ? () => cancelJob(scanJob.id) : undefined}
              onRemove={() => setPendingRemove(root)}
              onToggleSync={() => syncMutation.mutate({ id: root.id, sync: !root.syncToCrate })}
              syncPending={syncMutation.isPending && syncMutation.variables?.id === root.id}
            />
          );
        })}
      </div>

      {pendingRemove ? (
        <ConfirmDialog
          title="Remove library folder"
          message={`Tracks from "${pendingRemove.name}" leave your library; files on disk are not deleted.`}
          confirmLabel="Remove folder"
          danger
          isPending={removeMutation.isPending}
          onConfirm={() => removeMutation.mutate(pendingRemove.id)}
          onClose={() => (removeMutation.isPending ? undefined : setPendingRemove(null))}
        />
      ) : null}
    </section>
  );
}

function DiscoveringFolderRow({ path }: { path: string }) {
  const name = folderNameFromPath(path);
  return (
    <div
      className="lf-top rounded-lg border border-acc bg-surf px-3 py-3"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <IndexingSpinner />
        <p className="truncate text-sm font-semibold text-t1">{name}</p>
      </div>
      <p className="mt-0.5 truncate font-mono text-xs text-t3" title={path}>
        {path}
      </p>
      <IndexingBar indeterminate label={`Looking for audio files in ${name}`} />
    </div>
  );
}

function LibraryRootRow({
  root,
  scanJob,
  isDiscovering,
  onRescan,
  onCancelScan,
  onRemove,
  onToggleSync,
  syncPending,
}: {
  root: LibraryRoot;
  scanJob: ImportJobWithFiles | undefined;
  isDiscovering: boolean;
  onRescan: () => void;
  onCancelScan: (() => void) | undefined;
  onRemove: () => void;
  onToggleSync: () => void;
  syncPending: boolean;
}) {
  const isIndexing = Boolean(scanJob) || isDiscovering;
  const currentFile = scanJob?.files.find((file) => ACTIVE_FILE.has(file.status));
  const progressLabel = isDiscovering
    ? `Looking for audio files in ${root.name}`
    : scanJob
      ? `Indexing ${scanJob.processedFiles} of ${scanJob.totalFiles}`
      : "";

  return (
    <div
      className={`lf-top rounded-lg border bg-surf px-3 py-3 ${isIndexing ? "border-acc" : "border-line"}`}
      aria-busy={isIndexing}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isIndexing ? <IndexingSpinner /> : null}
            <p className="truncate text-sm font-semibold text-t1">{root.name}</p>
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-t3" title={root.path}>
            {root.path}
          </p>
          {isIndexing ? (
            <p className="mt-1 font-mono text-xs text-t2" aria-live="polite">
              {isDiscovering
                ? "Looking for audio files…"
                : scanJob
                  ? `${scanJob.processedFiles} of ${scanJob.totalFiles} indexed${
                      scanJob.failedFiles > 0 ? ` · ${scanJob.failedFiles} failed` : ""
                    }`
                  : null}
              {currentFile ? ` · ${currentFile.originalFilename}` : null}
            </p>
          ) : (
            <p className="mt-1 font-mono text-xs text-t2">
              {root.indexedFileCount} of {root.totalFileCount} file{root.totalFileCount === 1 ? "" : "s"} indexed
              {root.missingCount > 0 ? ` · ${root.missingCount} missing` : ""}
              {root.indexedFileCount < root.totalFileCount ? " · rescan to pick up the rest" : ""}
            </p>
          )}
          {root.rootCrateId != null ? (
            <Link href={`/crates/${root.rootCrateId}`} className="mt-1 inline-block text-xs text-acc hover:underline">
              View synced crate
            </Link>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleSync}
            disabled={syncPending || isIndexing}
            title={root.syncToCrate ? "Sync to playlist is on — click to pause" : "Sync to playlist is off — click to resume"}
            className={`rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-50 ${
              root.syncToCrate
                ? "border-acc text-acc hover:bg-[var(--lf-tint)]"
                : "border-line text-t2 hover:border-acc hover:bg-surf-2"
            }`}
          >
            {syncPending ? "…" : root.syncToCrate ? "Synced" : "Sync off"}
          </button>
          {scanJob && onCancelScan ? (
            <button
              type="button"
              onClick={onCancelScan}
              className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-t1 hover:border-err hover:text-err hover:bg-surf-2"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={onRescan}
              disabled={isIndexing}
              className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-50"
            >
              {isDiscovering ? "Rescanning…" : "Rescan"}
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            disabled={isIndexing}
            className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-err hover:border-err hover:bg-surf-2 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
      {isIndexing ? (
        <IndexingBar
          indeterminate={isDiscovering || !scanJob || scanJob.totalFiles === 0}
          processed={scanJob?.processedFiles}
          total={scanJob?.totalFiles}
          label={progressLabel}
        />
      ) : null}
    </div>
  );
}

function IndexingSpinner() {
  return (
    <span className="lf-index-spin inline-flex shrink-0 text-acc" aria-hidden>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function IndexingBar({
  indeterminate,
  processed,
  total,
  label,
}: {
  indeterminate?: boolean;
  processed?: number;
  total?: number;
  label: string;
}) {
  const percent = !indeterminate && total && total > 0 ? Math.min(100, Math.round(((processed ?? 0) / total) * 100)) : 0;

  return (
    <div
      className="mt-2.5 h-1.5 overflow-hidden rounded-sm bg-surf-2"
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : total}
      aria-valuenow={indeterminate ? undefined : processed}
    >
      {indeterminate ? (
        <div className="lf-progress-indeterminate relative h-full w-full">
          <span className="absolute inset-y-0 left-0 w-2/5 rounded-sm bg-acc" />
        </div>
      ) : (
        <div
          className="h-full rounded-sm bg-acc transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  );
}
