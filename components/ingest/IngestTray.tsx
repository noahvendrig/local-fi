"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collectDroppedFiles, filterAudioFiles } from "@/lib/ingest/collectFiles";
import { useIngestStore } from "@/lib/store/ingest";
import type { ImportJobWithFiles } from "@/lib/api/types";
import { JobFileRow } from "./JobFileRow";

/**
 * Global Ingest tray: listens for drag-and-drop anywhere in the app window,
 * and hosts the drop-zone / per-file progress rows (ARCHITECTURE.md M2).
 */
export function IngestTray() {
  const isOpen = useIngestStore((s) => s.isOpen);
  const isDragActive = useIngestStore((s) => s.isDragActive);
  const jobs = useIngestStore((s) => s.jobs);
  const close = useIngestStore((s) => s.close);
  const setDragActive = useIngestStore((s) => s.setDragActive);
  const submitFiles = useIngestStore((s) => s.submitFiles);
  const cancelJob = useIngestStore((s) => s.cancelJob);

  const [error, setError] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function hasFiles(e: DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).includes("Files");
    }
    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    }
    function onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    }
    async function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      if (!e.dataTransfer) return;
      const files = await collectDroppedFiles(e.dataTransfer);
      if (files.length === 0) {
        setError("No supported audio files found in that drop.");
        return;
      }
      setError(null);
      try {
        await submitFiles(files);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed.");
      }
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [setDragActive, submitFiles]);

  const handleBrowse = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = filterAudioFiles(e.target.files ?? []);
      e.target.value = "";
      if (files.length === 0) {
        setError("No supported audio files were selected.");
        return;
      }
      setError(null);
      try {
        await submitFiles(files);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed.");
      }
    },
    [submitFiles]
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.flac,.aiff,.aif"
        className="hidden"
        onChange={handleFileInputChange}
        aria-hidden
      />

      {isDragActive && (
        // NOTE: --lf-glass is only defined under the dark-theme selector (globals.css) —
        // in light mode it's unset, not inherited, so var() needs an explicit fallback here.
        <div
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center"
          style={{ backgroundColor: "var(--lf-glass, rgba(18,16,22,0.6))" }}
        >
          <div className="rounded-2xl border-2 border-dashed border-acc bg-surf px-10 py-8 text-center shadow-[var(--lf-shadow)]">
            <p className="font-serif text-xl text-t1">Drop to import</p>
            <p className="mt-1 text-sm text-t2">Audio files and folders are both supported.</p>
          </div>
        </div>
      )}

      {isOpen && (
        <div
          className="fixed bottom-[104px] right-4 z-40 flex max-h-[60vh] w-[380px] flex-col overflow-hidden rounded-xl border border-line bg-surf shadow-[var(--lf-shadow)]"
          role="dialog"
          aria-label="Ingest tray"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-medium text-t1">Import</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBrowse}
                className="rounded-md bg-acc px-2.5 py-1 text-xs font-medium text-[var(--lf-on-acc)] hover:bg-acc-2"
              >
                Browse files
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Close import tray"
                className="flex h-6 w-6 items-center justify-center rounded-md text-t3 hover:bg-surf-2 hover:text-t1"
              >
                ×
              </button>
            </div>
          </div>

          {error && <p className="border-b border-line bg-[var(--lf-tint)] px-4 py-2 text-xs text-err">{error}</p>}

          <div className="flex-1 overflow-y-auto">
            {jobs.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-t3">
                Drag audio files or a folder anywhere in the window to begin.
              </p>
            ) : (
              jobs.map((job) => <JobSection key={job.id} job={job} onCancel={() => cancelJob(job.id)} />)
            )}
          </div>
        </div>
      )}
    </>
  );
}

function JobSection({ job, onCancel }: { job: ImportJobWithFiles; onCancel: () => void }) {
  const isActive = job.status === "pending" || job.status === "running";
  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex items-center justify-between px-4 pt-3 text-xs text-t3">
        <span>
          {job.processedFiles}/{job.totalFiles} processed
          {job.failedFiles > 0 ? ` · ${job.failedFiles} failed` : ""}
        </span>
        {isActive ? (
          <button type="button" onClick={onCancel} className="text-t3 hover:text-err">
            Cancel
          </button>
        ) : (
          <span className="capitalize text-t2">{job.status.replace(/_/g, " ")}</span>
        )}
      </div>
      <ul className="divide-y divide-line">
        {job.files.map((file) => (
          <JobFileRow key={file.id} file={file} />
        ))}
      </ul>
    </div>
  );
}
