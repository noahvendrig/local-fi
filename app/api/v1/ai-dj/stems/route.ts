import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { postStemsJob } from "@/lib/pythonBackend/stemsClient";
import { resolveTrackAbsPath } from "@/lib/storage/resolveTrackPath";

const BodySchema = z.object({
  trackId: z.number().int(),
  sessionId: z.string().trim().min(1),
});

/**
 * POST /api/v1/ai-dj/stems — kicks off vocal/instrumental separation for one track on
 * python-backend's GPU (or CPU-fallback) Demucs pipeline. A thin fetch-and-relay proxy, not a
 * DB-backed job mirror (unlike similarity/fingerprint jobs) — AI DJ sessions are ephemeral, so
 * there's nothing here worth persisting past the browser tab's lifetime. The browser never talks
 * to python-backend directly; this route (and its siblings under ai-dj/stems/[jobId]/*) is the
 * only thing that does, same convention as similarityClient.ts/fingerprintClient.ts.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid stems request.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }
  const { trackId, sessionId } = parsed.data;

  const track = getDb()
    .select({ path: tracks.path, libraryRootId: tracks.libraryRootId })
    .from(tracks)
    .where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt)))
    .get();
  if (!track) {
    return NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });
  }

  const absPath = resolveTrackAbsPath(track);

  try {
    const job = await postStemsJob(trackId, absPath, sessionId);
    return NextResponse.json(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the Python backend for stem separation.";
    console.warn(`[ai-dj] stems job creation failed for track ${trackId}: ${message}`);
    return NextResponse.json({ error: { code: "python_backend_unavailable", message } }, { status: 503 });
  }
}
