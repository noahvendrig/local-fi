import type { TrackSummary } from "../api-client";
import { apiUrl, authHeaders, withAuthQuery } from "./http";

export type MixtapeAnalysisStatus = "pending" | "queued" | "analyzing" | "ready" | "failed";
export type MixtapeJobStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
export type MixtapeSegmentMatchStatus = "auto_matched" | "manual" | "unrecognized" | "rejected";

export interface Mixtape {
  id: number;
  uuid: string;
  title: string;
  originalFilename: string;
  path: string;
  fileSizeBytes: number;
  durationSeconds: number;
  format: string;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  waveformPath: string | null;
  waveformStatus: string;
  waveformPeakCount: number | null;
  waveformAvgLevel: number | null;
  analysisStatus: MixtapeAnalysisStatus;
  latestJobId: number | null;
  /** The companion `tracks` row this mixtape is also playable as from the regular library. */
  libraryTrackId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MixtapeJob {
  id: number;
  uuid: string;
  mixtapeId: number;
  pythonJobId: string | null;
  status: MixtapeJobStatus;
  stage: "decoding" | "fingerprinting" | "matching" | "done" | null;
  progressPct: number;
  matchedSegments: number;
  unrecognizedSegments: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface MixtapeSegment {
  id: number;
  startSeconds: number;
  endSeconds: number;
  matchedTrackId: number | null;
  matchStatus: MixtapeSegmentMatchStatus;
  confidenceScore: number | null;
  matchedTempoRatio: number | null;
  sourceStartSeconds: number | null;
  position: number;
  matchedTrack: TrackSummary | null;
}

export interface MixtapeDetail extends Mixtape {
  latestJob: MixtapeJob | null;
  segments: MixtapeSegment[];
}

export class ManualSegmentsExistError extends Error {
  manualSegmentCount: number;
  constructor(message: string, manualSegmentCount: number) {
    super(message);
    this.manualSegmentCount = manualSegmentCount;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...authHeaders(), ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 409 && body?.error?.code === "manual_segments_exist") {
      throw new ManualSegmentsExistError(body.error.message, body.error.manualSegmentCount ?? 0);
    }
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** POST /api/v1/mixtapes — uploads one file (and auto-starts matching). */
export async function uploadMixtape(file: File, title?: string): Promise<Mixtape> {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);
  const res = await fetch(apiUrl("/api/v1/mixtapes"), { method: "POST", headers: authHeaders(), body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
  }
  return res.json();
}

export function fetchMixtapes(): Promise<{ items: Mixtape[] }> {
  return request("/api/v1/mixtapes");
}

export function fetchMixtape(id: number): Promise<MixtapeDetail> {
  return request(`/api/v1/mixtapes/${id}`);
}

export function renameMixtape(id: number, title: string): Promise<MixtapeDetail> {
  return request(`/api/v1/mixtapes/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
}

export function deleteMixtape(id: number): Promise<void> {
  return request(`/api/v1/mixtapes/${id}`, { method: "DELETE" });
}

/** Throws ManualSegmentsExistError if segments have manual corrections and `force` is false. */
export function analyzeMixtape(id: number, force = false): Promise<MixtapeJob> {
  return request(`/api/v1/mixtapes/${id}/analyze${force ? "?force=true" : ""}`, { method: "POST" });
}

export function assignMixtapeSegment(mixtapeId: number, segmentId: number, matchedTrackId: number | null): Promise<MixtapeSegment> {
  return request(`/api/v1/mixtapes/${mixtapeId}/segments/${segmentId}`, {
    method: "PATCH",
    body: JSON.stringify({ matchedTrackId }),
  });
}

export function fetchMixtapeJob(jobId: number): Promise<MixtapeJob> {
  return request(`/api/v1/mixtapes/jobs/${jobId}`);
}

export function cancelMixtapeJob(jobId: number): Promise<MixtapeJob> {
  return request(`/api/v1/mixtapes/jobs/${jobId}/cancel`, { method: "POST" });
}

export function mixtapeJobEventsUrl(jobId: number): string {
  return withAuthQuery(`/api/v1/mixtapes/jobs/${jobId}/events`);
}

export function mixtapeWaveformUrl(id: number): string {
  return withAuthQuery(`/api/v1/mixtapes/${id}/waveform`);
}

export function mixtapeStreamUrl(id: number): string {
  return withAuthQuery(`/api/v1/mixtapes/${id}/stream`);
}
