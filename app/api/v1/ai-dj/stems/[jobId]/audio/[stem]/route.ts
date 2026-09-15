import { getPythonBackendUrl } from "@/lib/pythonBackend/process";

const VALID_STEMS = new Set(["vocals", "instrumental"]);

/**
 * GET /api/v1/ai-dj/stems/:jobId/audio/:stem — raw passthrough of python-backend's
 * GET /api/stems/jobs/:id/audio/:stem (the separated WAV bytes). Same "browser never talks to
 * python-backend directly" convention as the events route.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string; stem: string }> }) {
  const { jobId, stem } = await params;
  if (!VALID_STEMS.has(stem)) {
    return new Response("Unknown stem.", { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${getPythonBackendUrl()}/api/stems/jobs/${jobId}/audio/${stem}`);
  } catch {
    return new Response("Could not reach the Python backend.", { status: 503 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("Stem not available.", { status: upstream.status === 404 ? 404 : 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: { "Content-Type": "audio/wav" },
  });
}
