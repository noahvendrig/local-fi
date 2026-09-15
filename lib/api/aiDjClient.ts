import { authHeaders, withAuthQuery } from "./http";

export type AiDjStemsJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Mirrors python-backend's StemsJobResponse fields verbatim (relayed as-is by the Next.js proxy
 *  routes under app/api/v1/ai-dj/stems/) — same "no camelCase translation" convention as the
 *  server-side stemsClient.ts. */
export interface AiDjStemsJob {
  id: string;
  status: AiDjStemsJobStatus;
  progress_pct: number;
  track_id: number;
  session_id: string;
  device: string | null;
  error: string | null;
  created_at: number;
}

export interface AiDjDeviceInfoResponse {
  available: boolean;
  device: "cuda" | "cpu";
  cuda_device_name: string | null;
}

const TERMINAL: ReadonlySet<AiDjStemsJobStatus> = new Set(["completed", "failed", "cancelled"]);

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/** POST /api/v1/ai-dj/stems — kicks off vocal/instrumental separation for one track. */
export function postAiDjStemsJob(trackId: number, sessionId: string): Promise<AiDjStemsJob> {
  return request("/api/v1/ai-dj/stems", { method: "POST", body: JSON.stringify({ trackId, sessionId }) });
}

/** DELETE /api/v1/ai-dj/stems/:jobId — best-effort cancel for a prep job that's no longer needed. */
export function cancelAiDjStemsJob(jobId: string): Promise<void> {
  return request(`/api/v1/ai-dj/stems/${jobId}`, { method: "DELETE" });
}

export function aiDjStemAudioUrl(jobId: string, stem: "vocals" | "instrumental"): string {
  return withAuthQuery(`/api/v1/ai-dj/stems/${jobId}/audio/${stem}`);
}

/** GET /api/v1/ai-dj/stems/device — GPU/CPU status for the AI DJ view's device badge. */
export function fetchAiDjDeviceInfo(): Promise<AiDjDeviceInfoResponse> {
  return request("/api/v1/ai-dj/stems/device");
}

/**
 * Subscribes to a stems job's SSE stream until it reaches a terminal status. Resolves with the
 * final job snapshot (or the last one seen, on a stream error) — never rejects, so callers can
 * always fall back cleanly to a plain crossfade instead of throwing mid-session.
 */
export function watchAiDjStemsJob(jobId: string, onUpdate?: (job: AiDjStemsJob) => void): Promise<AiDjStemsJob | null> {
  return new Promise((resolve) => {
    const source = new EventSource(withAuthQuery(`/api/v1/ai-dj/stems/${jobId}/events`));
    let last: AiDjStemsJob | null = null;
    let settled = false;
    const finish = (job: AiDjStemsJob | null) => {
      if (settled) return;
      settled = true;
      source.close();
      resolve(job);
    };
    source.onmessage = (event) => {
      try {
        const job = JSON.parse(event.data) as AiDjStemsJob;
        last = job;
        onUpdate?.(job);
        if (TERMINAL.has(job.status)) finish(job);
      } catch {
        // Malformed frame — ignore and keep waiting for a good one.
      }
    };
    source.onerror = () => finish(last);
  });
}
