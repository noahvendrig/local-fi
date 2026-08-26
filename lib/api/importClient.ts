import type { CollectedFile } from "../ingest/collectFiles";
import { authHeaders, withAuthQuery } from "./http";
import type { ImportJob, ImportJobWithFiles } from "./types";

export { withAuthQuery };

export async function submitImport(
  files: CollectedFile[],
  options: {
    jobUuid?: string;
    finalize?: boolean;
    createFolderPlaylists?: boolean;
    compressAudio?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<ImportJobWithFiles> {
  const formData = new FormData();
  for (const { file, relativePath } of files) {
    formData.append("files", file);
    formData.append("relativePaths", relativePath);
  }
  if (options.jobUuid) formData.append("jobUuid", options.jobUuid);
  formData.append("finalize", options.finalize === false ? "false" : "true");
  if (options.createFolderPlaylists) formData.append("createFolderPlaylists", "true");
  if (options.compressAudio) formData.append("compressAudio", "true");

  const res = await fetch("/api/v1/import", {
    method: "POST",
    headers: authHeaders(),
    body: formData,
    signal: options.signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Import failed (${res.status})`);
  }

  return res.json();
}

export async function fetchImportJobs(limit = 20): Promise<ImportJob[]> {
  const res = await fetch(`/api/v1/import/jobs?limit=${limit}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch import jobs (${res.status})`);
  const body = (await res.json()) as { items: ImportJob[] };
  return body.items;
}

export async function fetchImportJob(jobId: number): Promise<ImportJobWithFiles> {
  const res = await fetch(`/api/v1/import/jobs/${jobId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch import job ${jobId} (${res.status})`);
  return res.json();
}

export async function cancelImportJob(jobId: number): Promise<ImportJobWithFiles> {
  const res = await fetch(`/api/v1/import/jobs/${jobId}/cancel`, { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to cancel import job ${jobId} (${res.status})`);
  return res.json();
}

export function importJobEventsUrl(jobId: number): string {
  return withAuthQuery(`/api/v1/import/jobs/${jobId}/events`);
}
