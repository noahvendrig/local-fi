import { authHeaders } from "./http";
import type { ImportJob } from "./types";

export interface LibraryRoot {
  id: number;
  uuid: string;
  name: string;
  path: string;
  createdAt: string;
  trackCount: number;
  missingCount: number;
  /** Recognized-audio-file count from the last scan of this folder — may exceed trackCount (unsupported formats, soft-deleted duplicates); refreshes on add/rescan. */
  totalFileCount: number;
  syncToCrate: boolean;
  /** The whole-folder synced crate's playlist id, if syncToCrate is on and it's been created yet. */
  rootCrateId: number | null;
}

export interface LibraryRootWithJob extends LibraryRoot {
  importJob: ImportJob;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function fetchLibraryRoots(): Promise<{ items: LibraryRoot[] }> {
  return request(`/api/v1/library-roots`);
}

export function addLibraryRoot(path: string, name?: string, syncToCrate?: boolean): Promise<LibraryRootWithJob> {
  return request(`/api/v1/library-roots`, { method: "POST", body: JSON.stringify({ path, name, syncToCrate }) });
}

export function renameLibraryRoot(id: number, name: string): Promise<LibraryRoot> {
  return request(`/api/v1/library-roots/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

/** Toggleable anytime — turning it on backfills tracks already indexed for this root into its crate(s). */
export function setLibraryRootSync(id: number, syncToCrate: boolean): Promise<LibraryRoot> {
  return request(`/api/v1/library-roots/${id}`, { method: "PATCH", body: JSON.stringify({ syncToCrate }) });
}

export function removeLibraryRoot(id: number): Promise<void> {
  return request(`/api/v1/library-roots/${id}`, { method: "DELETE" });
}

export function rescanLibraryRoot(id: number): Promise<ImportJob> {
  return request(`/api/v1/library-roots/${id}/scan`, { method: "POST" });
}
