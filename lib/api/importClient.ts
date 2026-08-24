import { authHeaders, withAuthQuery } from "./http";
import type { ImportJobWithFiles } from "./types";

export { withAuthQuery };

export async function submitImport(files: File[]): Promise<ImportJobWithFiles> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);

  const res = await fetch("/api/v1/import", {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Import failed (${res.status})`);
  }

  return res.json();
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
