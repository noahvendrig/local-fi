import { NextResponse } from "next/server";
import { cancelStemsJob, getStemsJob } from "@/lib/pythonBackend/stemsClient";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Stems job not found." } }, { status: 404 });
const UNAVAILABLE = NextResponse.json(
  { error: { code: "python_backend_unavailable", message: "Could not reach the Python backend." } },
  { status: 503 }
);

/** GET /api/v1/ai-dj/stems/:jobId — polling fallback for callers that don't use the SSE stream. */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    const job = await getStemsJob(jobId);
    return job ? NextResponse.json(job) : NOT_FOUND;
  } catch {
    return UNAVAILABLE;
  }
}

/** DELETE /api/v1/ai-dj/stems/:jobId — best-effort cancel (e.g. the user skipped past this transition). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  await cancelStemsJob(jobId);
  return NextResponse.json({ ok: true });
}
