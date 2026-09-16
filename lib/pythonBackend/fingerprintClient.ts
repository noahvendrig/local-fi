import { getPythonBackendUrl } from "./process";

export type FingerprintJobStatus = "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";

/** Mirrors python-backend/models/fingerprint_schemas.py's TrackFingerprintResult. */
export interface PythonTrackFingerprintResult {
  track_id: number;
  status: "done" | "failed";
  landmark_count: number | null;
  error: string | null;
}

/** Mirrors python-backend/models/fingerprint_schemas.py's MixtapeSegmentResult. */
export interface PythonMixtapeSegmentResult {
  track_id: number;
  start_ms: number;
  end_ms: number;
  tempo_ratio: number;
  source_start_ms: number;
  confidence: number;
}

/** Mirrors python-backend/models/fingerprint_schemas.py's FingerprintJobResponse — field names
 *  match the backend's JSON exactly (no camelCase translation), same convention as client.ts. */
export interface PythonFingerprintJobResponse {
  id: string;
  kind: "track_batch" | "mixtape_match";
  status: FingerprintJobStatus;
  stage: "decoding" | "fingerprinting" | "matching" | "done" | null;
  progress_pct: number;
  total_tracks: number;
  processed_tracks: number;
  failed_tracks: number;
  track_results: PythonTrackFingerprintResult[];
  segments: PythonMixtapeSegmentResult[];
  error: string | null;
  created_at: number;
}

const TERMINAL_STATUSES: FingerprintJobStatus[] = ["completed", "completed_with_errors", "failed", "cancelled"];

/** Kicks off a track-fingerprinting batch job (python-backend/api/fingerprint_routes.py's POST /api/fingerprint/tracks). */
export async function postTrackFingerprintJob(
  tracks: { trackId: number; path: string }[]
): Promise<PythonFingerprintJobResponse> {
  const res = await fetch(`${getPythonBackendUrl()}/api/fingerprint/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracks: tracks.map((t) => ({ track_id: t.trackId, path: t.path })) }),
  });
  if (!res.ok) {
    throw new Error(`Python backend rejected the fingerprint job (HTTP ${res.status}).`);
  }
  return (await res.json()) as PythonFingerprintJobResponse;
}

/** Kicks off a mixtape-matching job (python-backend/api/fingerprint_routes.py's POST /api/fingerprint/mixtapes). */
export async function postMixtapeMatchJob(mixtapeId: number, path: string): Promise<PythonFingerprintJobResponse> {
  const res = await fetch(`${getPythonBackendUrl()}/api/fingerprint/mixtapes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mixtape_id: mixtapeId, path }),
  });
  if (!res.ok) {
    throw new Error(`Python backend rejected the mixtape match job (HTTP ${res.status}).`);
  }
  return (await res.json()) as PythonFingerprintJobResponse;
}

/** Tells python-backend to forget a purged track's fingerprint (its DELETE /api/fingerprint/tracks/:id),
 *  so mixtape matching stops returning an id that no longer has a `tracks` row. Best-effort: if the
 *  backend is down the sidecar survives, and lib/mixtapes/segments.ts still drops the ghost match. */
export async function forgetPythonTrackFingerprint(trackId: number): Promise<void> {
  await fetch(`${getPythonBackendUrl()}/api/fingerprint/tracks/${trackId}`, { method: "DELETE" }).catch(() => {
    // ignore — see the note above.
  });
}

export async function cancelPythonFingerprintJob(jobId: string): Promise<void> {
  await fetch(`${getPythonBackendUrl()}/api/fingerprint/jobs/${jobId}`, { method: "DELETE" }).catch(() => {
    // Best-effort — if the backend is unreachable there's nothing left to cancel anyway.
  });
}

/**
 * Consumes the Python backend's SSE stream for one fingerprint/mixtape job
 * (python-backend/api/fingerprint_routes.py's GET /api/fingerprint/jobs/{id}/stream),
 * calling `onUpdate` for every state change, and resolves once the job reaches a
 * terminal status. Same parsing shape as client.ts's streamJobUntilDone.
 */
export async function streamFingerprintJobUntilDone(
  jobId: string,
  onUpdate: (job: PythonFingerprintJobResponse) => void
): Promise<PythonFingerprintJobResponse> {
  const res = await fetch(`${getPythonBackendUrl()}/api/fingerprint/jobs/${jobId}/stream`);
  if (!res.ok || !res.body) {
    throw new Error(`Could not open the progress stream for fingerprint job ${jobId} (HTTP ${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        separatorIndex = buffer.indexOf("\n\n");

        const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue; // keepalive comment line

        const job = JSON.parse(dataLine.slice("data: ".length)) as PythonFingerprintJobResponse;
        onUpdate(job);
        if (TERMINAL_STATUSES.includes(job.status)) {
          return job;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error(`Progress stream for fingerprint job ${jobId} ended before reaching a final state.`);
}
