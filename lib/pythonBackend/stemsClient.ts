import { getPythonBackendUrl } from "./process";

export type StemsJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Mirrors python-backend/models/stems_schemas.py's StemsJobResponse — field names match the
 *  backend's JSON exactly (no camelCase translation), same convention as similarityClient.ts. */
export interface PythonStemsJobResponse {
  id: string;
  status: StemsJobStatus;
  progress_pct: number;
  track_id: number;
  session_id: string;
  device: string | null;
  error: string | null;
  created_at: number;
}

export interface PythonDeviceInfoResponse {
  available: boolean;
  device: "cuda" | "cpu";
  cuda_device_name: string | null;
}

/** Kicks off a stem-separation job (python-backend/api/stems_routes.py's POST /api/stems/jobs). */
export async function postStemsJob(trackId: number, path: string, sessionId: string): Promise<PythonStemsJobResponse> {
  const res = await fetch(`${getPythonBackendUrl()}/api/stems/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id: trackId, path, session_id: sessionId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Python backend rejected the stems job (HTTP ${res.status})${body ? `: ${body}` : ""}.`);
  }
  return (await res.json()) as PythonStemsJobResponse;
}

export async function getStemsJob(jobId: string): Promise<PythonStemsJobResponse | null> {
  const res = await fetch(`${getPythonBackendUrl()}/api/stems/jobs/${jobId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Python backend rejected the stems job lookup (HTTP ${res.status}).`);
  return (await res.json()) as PythonStemsJobResponse;
}

export async function cancelStemsJob(jobId: string): Promise<void> {
  await fetch(`${getPythonBackendUrl()}/api/stems/jobs/${jobId}`, { method: "DELETE" }).catch(() => {
    // Best-effort — if the backend is unreachable there's nothing left to cancel anyway.
  });
}

/** Returns `{ available: false, device: "cpu", cuda_device_name: null }` on any failure (e.g. the
 *  python backend isn't running) rather than throwing — this only ever backs a status badge. */
export async function getStemsDeviceInfo(): Promise<PythonDeviceInfoResponse> {
  try {
    const res = await fetch(`${getPythonBackendUrl()}/api/stems/device`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as PythonDeviceInfoResponse;
  } catch {
    return { available: false, device: "cpu", cuda_device_name: null };
  }
}
