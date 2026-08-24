import { create } from "zustand";
import { cancelImportJob, importJobEventsUrl, submitImport } from "@/lib/api/importClient";
import type { ImportJobWithFiles } from "@/lib/api/types";

const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

const eventSources = new Map<number, EventSource>();

interface IngestState {
  isOpen: boolean;
  isDragActive: boolean;
  jobs: ImportJobWithFiles[];
  open: () => void;
  close: () => void;
  setDragActive: (active: boolean) => void;
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

export const useIngestStore = create<IngestState>((set) => ({
  isOpen: false,
  isDragActive: false,
  jobs: [],
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setDragActive: (active) => set({ isDragActive: active }),

  submitFiles: async (files) => {
    if (files.length === 0) return;
    set({ isOpen: true });
    const job = await submitImport(files);
    set((state) => ({ jobs: [job, ...state.jobs] }));
    subscribeToJobEvents(job.id, set);
  },

  cancelJob: (jobId) => {
    void cancelImportJob(jobId);
  },
}));
