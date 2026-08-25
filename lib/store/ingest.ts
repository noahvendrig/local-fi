import { create } from "zustand";
import { cancelImportJob, fetchImportJob, fetchImportJobs, importJobEventsUrl, submitImport } from "@/lib/api/importClient";
import type { ImportJob, ImportJobWithFiles } from "@/lib/api/types";
import { chunkFilesForUpload } from "@/lib/ingest/chunkFiles";
import { hasSubfolders, type CollectedFile } from "@/lib/ingest/collectFiles";

const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

const eventSources = new Map<number, EventSource>();

let uploadAbort: AbortController | null = null;

interface IngestState {
  isDragActive: boolean;
  dragItemCount: number;
  jobs: ImportJobWithFiles[];
  error: string | null;
  uploadProgress: { copied: number; total: number } | null;
  /** Set when the collected files span subfolders — waiting on the user to pick per-folder playlists vs. a flat import. */
  pendingFolderImport: CollectedFile[] | null;
  setDragActive: (active: boolean, itemCount?: number) => void;
  setError: (error: string | null) => void;
  hydrateJobs: () => Promise<void>;
  /** Entry point for both the folder picker and drag-and-drop. Prompts first if the files span subfolders. */
  submitFiles: (files: CollectedFile[]) => Promise<void>;
  /** Resolves the folder-import prompt and proceeds with the pending files. */
  resolveFolderImport: (createFolderPlaylists: boolean) => Promise<void>;
  cancelFolderImport: () => void;
  cancelJob: (jobId: number) => void;
  /** Adopts a job created elsewhere (e.g. a library-root add/rescan) into the tray so its
   *  progress shows live and the terminal-status effect refreshes the right queries once it finishes. */
  trackJob: (job: ImportJob) => void;
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

async function performSubmit(
  files: CollectedFile[],
  createFolderPlaylists: boolean,
  set: (fn: (state: IngestState) => Partial<IngestState>) => void,
): Promise<void> {
  uploadAbort?.abort();
  const abort = new AbortController();
  uploadAbort = abort;
  set(() => ({ error: null, uploadProgress: { copied: 0, total: files.length } }));

  let jobUuid: string | undefined;
  try {
    const batches = chunkFilesForUpload(files);
    let copied = 0;
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const job = await submitImport(batch, {
        jobUuid,
        finalize: i === batches.length - 1,
        createFolderPlaylists,
        signal: abort.signal,
      });
      jobUuid = job.uuid;
      copied += batch.length;
      set((state) => ({
        jobs: [job, ...state.jobs.filter((item) => item.id !== job.id)],
        uploadProgress: { copied, total: files.length },
      }));
      subscribeToJobEvents(job.id, set);
    }
    set(() => ({ uploadProgress: null }));
  } catch (err) {
    if (jobUuid && abort.signal.aborted === false) {
      try {
        const job = await submitImport([], { jobUuid, finalize: true, signal: abort.signal });
        set((state) => ({ jobs: [job, ...state.jobs.filter((item) => item.id !== job.id)] }));
        subscribeToJobEvents(job.id, set);
      } catch {
        // Partial job stays pending; user can drop the folder again.
      }
    }
    if (abort.signal.aborted) {
      set(() => ({ uploadProgress: null }));
      return;
    }
    set(() => ({
      error: err instanceof Error ? err.message : "Import failed.",
      uploadProgress: null,
    }));
  } finally {
    if (uploadAbort === abort) uploadAbort = null;
  }
}

export const useIngestStore = create<IngestState>((set, get) => ({
  isDragActive: false,
  dragItemCount: 0,
  jobs: [],
  error: null,
  uploadProgress: null,
  pendingFolderImport: null,
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
    if (hasSubfolders(files)) {
      set({ pendingFolderImport: files, error: null });
      return;
    }
    await performSubmit(files, false, set);
  },

  resolveFolderImport: async (createFolderPlaylists) => {
    const files = get().pendingFolderImport;
    set({ pendingFolderImport: null });
    if (!files || files.length === 0) return;
    await performSubmit(files, createFolderPlaylists, set);
  },

  cancelFolderImport: () => set({ pendingFolderImport: null }),

  cancelJob: (jobId) => {
    uploadAbort?.abort();
    void cancelImportJob(jobId);
  },

  trackJob: (job) => {
    set((state) => ({ jobs: mergeJobs([{ ...job, files: [] }], state.jobs) }));
    if (TERMINAL_STATUSES.has(job.status)) return;
    subscribeToJobEvents(job.id, set);
    void fetchImportJob(job.id)
      .then((detailed) => {
        set((state) => ({ jobs: mergeJobs([detailed], state.jobs) }));
      })
      .catch(() => {
        // SSE updates will still arrive; empty files until then.
      });
  },
}));
