import { getPythonBackendUrl } from "@/lib/pythonBackend/process";

/**
 * GET /api/v1/ai-dj/stems/:jobId/events — raw SSE passthrough of python-backend's own
 * GET /api/stems/jobs/:id/stream. Unlike the other job-progress routes in this app (similarity,
 * fingerprint, import, analysis), there's no Node-side job row or event bus to re-publish from —
 * AI DJ jobs are ephemeral and live only in python-backend's in-memory job manager, so this route
 * just relays the upstream stream's bytes straight through rather than re-framing them.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  let upstream: Response;
  try {
    upstream = await fetch(`${getPythonBackendUrl()}/api/stems/jobs/${jobId}/stream`);
  } catch {
    return new Response("Could not reach the Python backend.", { status: 503 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("Stems job not found.", { status: upstream.status === 404 ? 404 : 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
