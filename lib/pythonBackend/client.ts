import { getPythonBackendUrl } from "./process";

export type PythonJobStatus = "queued" | "matching" | "downloading" | "completed" | "failed" | "cancelled";

/** Mirrors python-backend/models/schemas.py's JobResponse — field names match the backend's JSON exactly (no camelCase translation). */
export interface PythonJobResponse {
  id: string;
  kind: "url_download" | "match_download";
  url: string;
  status: PythonJobStatus;
  title: string | null;
  percent: number;
  error: string | null;
  filename: string | null;
  filepath: string | null;
  track_title: string | null;
  artist: string | null;
  created_at: number;
}

export interface MatchJobRequest {
  title: string;
  artist: string;
  durationMs: number | null;
  /** Absolute path on the shared local filesystem to save the downloaded audio into. */
  outputDir: string;
}

const TERMINAL_STATUSES: PythonJobStatus[] = ["completed", "failed", "cancelled"];

/** Kicks off a single match-and-download job on the Python backend (python-backend/api/routes.py's POST /api/jobs/match). */
export async function postMatchJob(item: MatchJobRequest): Promise<PythonJobResponse> {
  const res = await fetch(`${getPythonBackendUrl()}/api/jobs/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          title: item.title,
          artist: item.artist,
          duration_ms: item.durationMs,
          output_dir: item.outputDir,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Python backend rejected the match job (HTTP ${res.status}).`);
  }
  const body = (await res.json()) as { jobs: PythonJobResponse[] };
  const job = body.jobs[0];
  if (!job) throw new Error("Python backend returned no job for the match request.");
  return job;
}

export async function cancelPythonJob(jobId: string): Promise<void> {
  await fetch(`${getPythonBackendUrl()}/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {
    // Best-effort — if the backend is unreachable there's nothing left to cancel anyway.
  });
}

/**
 * Consumes the Python backend's SSE stream for one job (python-backend/api/routes.py's
 * GET /api/jobs/{id}/stream), calling `onUpdate` for every state change, and resolves
 * once the job reaches a terminal status.
 */
export async function streamJobUntilDone(
  jobId: string,
  onUpdate: (job: PythonJobResponse) => void
): Promise<PythonJobResponse> {
  const res = await fetch(`${getPythonBackendUrl()}/api/jobs/${jobId}/stream`);
  if (!res.ok || !res.body) {
    throw new Error(`Could not open the progress stream for job ${jobId} (HTTP ${res.status}).`);
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

        const job = JSON.parse(dataLine.slice("data: ".length)) as PythonJobResponse;
        onUpdate(job);
        if (TERMINAL_STATUSES.includes(job.status)) {
          return job;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error(`Progress stream for job ${jobId} ended before reaching a final state.`);
}
