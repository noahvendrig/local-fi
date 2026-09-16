import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { getPythonBackendUrl } from "@/lib/pythonBackend/process";
import { getStemsJob, postStemsJob, type PythonStemsJobResponse } from "@/lib/pythonBackend/stemsClient";
import { resolveTrackAbsPath } from "@/lib/storage/resolveTrackPath";

const VALID_STEMS = new Set(["vocals", "instrumental"]);
const POLL_INTERVAL_MS = 750;
const MAX_WAIT_MS = 10 * 60 * 1000; // Demucs on CPU can be slow; debug tool, so wait it out rather than time out early.

const NOT_FOUND = new Response("Track not found.", { status: 404 });

/** One Demucs pass produces both stems, so a request for either stem of a track reuses the same
 *  job as a request for the other — without this, hitting /stems/vocals then /stems/instrumental
 *  back to back would separate the same track twice. Keyed in-memory only; a dev-server restart
 *  just means the next hit re-separates, same ephemeral treatment the AI DJ feature already gives
 *  this output (see python-backend/services/stems/storage.py). */
const jobCache = new Map<number, Promise<PythonStemsJobResponse>>();

async function getOrCreateJob(trackId: number, absPath: string): Promise<PythonStemsJobResponse> {
  const cached = jobCache.get(trackId);
  if (cached) return cached;

  const promise = (async () => {
    const created = await postStemsJob(trackId, absPath, `debug-tracks-stems-${trackId}`);
    const deadline = Date.now() + MAX_WAIT_MS;
    let job = created;
    while (job.status === "queued" || job.status === "running") {
      if (Date.now() > deadline) throw new Error("Stem separation timed out.");
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const polled = await getStemsJob(job.id);
      if (!polled) throw new Error("Stems job disappeared while waiting.");
      job = polled;
    }
    return job;
  })();

  jobCache.set(trackId, promise);
  promise.catch(() => jobCache.delete(trackId)); // don't let a failed attempt stick around forever
  return promise;
}

/**
 * GET /api/v1/tracks/:id/stems/:stem — debug tool: runs this track through the same Demucs
 * separation AI DJ uses (see python-backend/services/stems/separator.py) and returns the raw
 * "vocals" or "instrumental" WAV, so separation quality can be judged by ear. Not wired into any
 * UI; hit it directly in a browser or via curl -o test.wav. First hit for a track can take a while
 * (Demucs runs synchronously from the caller's point of view) — the second stem for the same
 * track reuses that same run instead of re-separating.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; stem: string }> }) {
  const { id, stem } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;
  if (!VALID_STEMS.has(stem)) return new Response("Unknown stem — expected vocals or instrumental.", { status: 404 });

  const track = getDb()
    .select({ path: tracks.path, libraryRootId: tracks.libraryRootId })
    .from(tracks)
    .where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt)))
    .get();
  if (!track) return NOT_FOUND;

  const absPath = resolveTrackAbsPath(track);

  let job: PythonStemsJobResponse;
  try {
    job = await getOrCreateJob(trackId, absPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the Python backend for stem separation.";
    return new Response(message, { status: 503 });
  }

  if (job.status === "failed") return new Response(job.error ?? "Stem separation failed.", { status: 500 });
  if (job.status === "cancelled") return new Response("Stem separation job was cancelled.", { status: 500 });

  let upstream: Response;
  try {
    upstream = await fetch(`${getPythonBackendUrl()}/api/stems/jobs/${job.id}/audio/${stem}`);
  } catch {
    return new Response("Could not reach the Python backend.", { status: 503 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Stem not available.", { status: upstream.status === 404 ? 404 : 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Disposition": `inline; filename="track-${trackId}-${stem}.wav"`,
    },
  });
}
