import { create } from "zustand";
import { cancelImportJob, fetchImportJob, fetchImportJobs, importJobEventsUrl, submitImport } from "@/lib/api/importClient";
import type { ImportJobWithFiles } from "@/lib/api/types";

const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

const eventSources = new Map<number, EventSource>();

interface IngestState {
  isDragActive: boolean;
  dragItemCount: number;
  jobs: ImportJobWithFiles[];
  error: string | null;
  setDragActive: (active: boolean, itemCount?: number) => void;
  setError: (error: string | null) => void;
  hydrateJobs: () => Promise<void>;
  submitFiles: (files: File[]) => Promise<void>;
  cancelJob: (jobId: number) => void;
}

function subscribeToJobEvents(jobId: number, set: (fn: (state: IngestState) => Partial<IngestState>) => void) {
  if (eventSources.has(jobId)) return;

  const source = new EventSource(importJobEventsUrl(jobId));
  eventSources.set(jobId, source);

  source.addEventListener("update", (event) => {
    const snapshot = JSON.parse((event as MessageEvent<string>).data) as {
      job: Omit<ImportJobWithFiles, "files">;
      files: ImportJobWithFiles["files"];
    };
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === jobId ? { ...snapshot.job, files: snapshot.files } : j)),
    }));
    if (TERMINAL_STATUSES.has(snapshot.job.status)) {
      source.close();
      eventSources.delete(jobId);
    }
  });

  source.onerror = () => {
    // EventSource auto-reconnects; the route replays a full snapshot on reconnect, so
    // no separate polling fallback is needed client-side (ARCHITECTURE.md §7).
  };
}

function mergeJobs(incoming: ImportJobWithFiles[], existing: ImportJobWithFiles[]): ImportJobWithFiles[] {
  const live = new Map(existing.map((job) => [job.id, job]));
  const merged = incoming.map((job) => live.get(job.id) ?? job);
  for (const job of existing) {
    if (!merged.some((item) => item.id === job.id)) merged.push(job);
  }
  return merged.sort((a, b) => b.id - a.id);
}

export const useIngestStore = create<IngestState>((set) => ({
  isDragActive: false,
  dragItemCount: 0,
  jobs: [],
  error: null,
  setDragActive: (active, itemCount = 0) =>
    set({ isDragActive: active, dragItemCount: active ? itemCount : 0 }),
  setError: (error) => set({ error }),

  hydrateJobs: async () => {
    try {
      const items = await fetchImportJobs(10);
      const detailed = await Promise.all(items.map((job) => fetchImportJob(job.id)));
      set((state) => ({ jobs: mergeJobs(detailed, state.jobs) }));
      for (const job of detailed) {
        if (!TERMINAL_STATUSES.has(job.status)) subscribeToJobEvents(job.id, set);
      }
    } catch {
      // Keep whatever is already in memory if the list endpoint is unreachable.
    }
  },

  submitFiles: async (files) => {
    if (files.length === 0) return;
    set({ error: null });
    try {
      const job = await submitImport(files);
      set((state) => ({ jobs: [job, ...state.jobs.filter((item) => item.id !== job.id)] }));
      subscribeToJobEvents(job.id, set);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Import failed." });
    }
  },

  cancelJob: (jobId) => {
    void cancelImportJob(jobId);
  },
}));
