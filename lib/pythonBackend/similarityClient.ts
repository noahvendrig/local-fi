import { getPythonBackendUrl } from "./process";

export type SimilarityJobStatus = "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";

/** Mirrors python-backend/models/similarity_schemas.py's TrackSimilarityResult. */
export interface PythonTrackSimilarityResult {
  track_id: number;
  status: "done" | "failed";
  error: string | null;
  /** Comma-joined genre label(s) from audio analysis (e.g. "House, Electronic, Dance"), or null
   *  when nothing cleared the confidence threshold — see python-backend/services/similarity/genre.py. */
  genre: string | null;
}

/** Mirrors python-backend/models/similarity_schemas.py's SimilarityJobResponse — field names
 *  match the backend's JSON exactly (no camelCase translation), same convention as
 *  fingerprintClient.ts. */
export interface PythonSimilarityJobResponse {
  id: string;
  status: SimilarityJobStatus;
  progress_pct: number;
  total_tracks: number;
  processed_tracks: number;
  failed_tracks: number;
  track_results: PythonTrackSimilarityResult[];
  error: string | null;
  created_at: number;
}

export interface PythonSimilarTrackMatch {
  track_id: number;
  score: number;
}

const TERMINAL_STATUSES: SimilarityJobStatus[] = ["completed", "completed_with_errors", "failed", "cancelled"];

/** Kicks off a track-similarity batch job (python-backend/api/similarity_routes.py's POST /api/similarity/tracks). */
export async function postTrackSimilarityJob(
  tracks: { trackId: number; path: string }[]
): Promise<PythonSimilarityJobResponse> {
  const res = await fetch(`${getPythonBackendUrl()}/api/similarity/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracks: tracks.map((t) => ({ track_id: t.trackId, path: t.path })) }),
  });
  if (!res.ok) {
    throw new Error(`Python backend rejected the similarity job (HTTP ${res.status}).`);
  }
  return (await res.json()) as PythonSimilarityJobResponse;
}

export async function cancelPythonSimilarityJob(jobId: string): Promise<void> {
  await fetch(`${getPythonBackendUrl()}/api/similarity/jobs/${jobId}`, { method: "DELETE" }).catch(() => {
    // Best-effort — if the backend is unreachable there's nothing left to cancel anyway.
  });
}

/**
 * Consumes the Python backend's SSE stream for one similarity job
 * (python-backend/api/similarity_routes.py's GET /api/similarity/jobs/{id}/stream),
 * calling `onUpdate` for every state change, and resolves once the job reaches a
 * terminal status. Same parsing shape as fingerprintClient.ts's streamFingerprintJobUntilDone.
 */
export async function streamSimilarityJobUntilDone(
  jobId: string,
  onUpdate: (job: PythonSimilarityJobResponse) => void
): Promise<PythonSimilarityJobResponse> {
  const res = await fetch(`${getPythonBackendUrl()}/api/similarity/jobs/${jobId}/stream`);
  if (!res.ok || !res.body) {
    throw new Error(`Could not open the progress stream for similarity job ${jobId} (HTTP ${res.status}).`);
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

        const job = JSON.parse(dataLine.slice("data: ".length)) as PythonSimilarityJobResponse;
        onUpdate(job);
        if (TERMINAL_STATUSES.includes(job.status)) {
          return job;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error(`Progress stream for similarity job ${jobId} ended before reaching a final state.`);
}

/** Calls python-backend/api/similarity_routes.py's POST /api/similarity/similar. Returns an
 *  empty list (never throws) on any failure -- Smart Shuffle degrades to "no suggestion", it
 *  never blocks or errors playback. */
export async function fetchSimilarTrack(
  trackId: number,
  opts: { candidateIds?: number[]; excludeIds?: number[]; topK?: number }
): Promise<PythonSimilarTrackMatch[]> {
  try {
    const res = await fetch(`${getPythonBackendUrl()}/api/similarity/similar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        track_id: trackId,
        candidate_ids: opts.candidateIds ?? null,
        exclude_ids: opts.excludeIds ?? [],
        top_k: opts.topK ?? 1,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { matches: PythonSimilarTrackMatch[] };
    return data.matches;
  } catch {
    return [];
  }
}

/** Calls python-backend/api/similarity_routes.py's POST /api/similarity/similar-to-set — averages
 *  the given tracks' embeddings into one centroid and searches the whole index against it (e.g.
 *  "what from the library fits this crate"). Returns an empty list (never throws) on any failure,
 *  same degrade-gracefully convention as fetchSimilarTrack. */
export async function fetchSimilarToTrackSet(
  trackIds: number[],
  opts: { excludeIds?: number[]; topK?: number; timeoutMs?: number }
): Promise<PythonSimilarTrackMatch[]> {
  try {
    const res = await fetch(`${getPythonBackendUrl()}/api/similarity/similar-to-set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        track_ids: trackIds,
        exclude_ids: opts.excludeIds ?? [],
        top_k: opts.topK ?? 5,
      }),
      // Opt-in, and left off by default so existing callers are unchanged. lib/llm/vibeSelector.ts
      // passes one because it runs inside useVibeRadio.ts's replenish loop, where -- exactly as
      // fetchTasteScores' comment below warns -- a hang would be gated behind isFetching and stall
      // every future replenishment rather than degrading a single call.
      signal: opts.timeoutMs != null ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { matches: PythonSimilarTrackMatch[] };
    return data.matches;
  } catch {
    return [];
  }
}

export interface PythonTasteScore {
  track_id: number;
  score: number;
}

/** Calls python-backend/api/similarity_routes.py's POST /api/similarity/taste-score — weighted-
 *  nearest-neighbor personal-taste score for each candidate against a play-history set (see
 *  lib/taste/tasteModel.ts). Returns an empty Map (never throws) on any failure *or timeout* --
 *  unlike fetchSimilarTrack/fetchSimilarToTrackSet above, this one sets an explicit
 *  AbortSignal.timeout: it's called from within useVibeRadio.ts's replenish loop, gated by an
 *  isFetching flag, so a hang here (e.g. lock contention with a similarity-index rebuild job)
 *  would silently stall all future replenishment rather than just degrading one call. */
export async function fetchTasteScores(
  history: { trackId: number; weight: number }[],
  candidateIds: number[]
): Promise<Map<number, number>> {
  if (history.length === 0 || candidateIds.length === 0) return new Map();
  try {
    const res = await fetch(`${getPythonBackendUrl()}/api/similarity/taste-score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        history: history.map((h) => ({ track_id: h.trackId, weight: h.weight })),
        candidate_ids: candidateIds,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return new Map();
    const data = (await res.json()) as { scores: PythonTasteScore[] };
    return new Map(data.scores.map((s) => [s.track_id, s.score]));
  } catch {
    return new Map();
  }
}
