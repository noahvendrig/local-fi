import path from "node:path";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { mixtapeSegments, mixtapes } from "@/lib/db/schema";
import { createAndEnqueueMixtapeJob } from "@/lib/mixtapes/queue";
import { getDataDir } from "@/lib/storage/dataDir";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Mixtape not found." } }, { status: 404 });

/**
 * POST /api/v1/mixtapes/:id/analyze — (re-)runs matching against the local library.
 * `?force=true` is required when the mixtape already has manually-assigned segments, since
 * a re-run discards and replaces every segment (see the schema comment on `mixtapeSegments`)
 * — the client shows a confirm dialog and retries with `force` once the user accepts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mixtapeId = Number(id);
  if (!Number.isInteger(mixtapeId)) return NOT_FOUND;

  const db = getDb();
  const existing = db.select().from(mixtapes).where(eq(mixtapes.id, mixtapeId)).get();
  if (!existing) return NOT_FOUND;

  if (existing.analysisStatus === "queued" || existing.analysisStatus === "analyzing") {
    return NextResponse.json(
      { error: { code: "conflict", message: "This mixtape is already being analyzed." } },
      { status: 409 }
    );
  }

  const force = new URL(request.url).searchParams.get("force") === "true";
  const manualCount = db
    .select()
    .from(mixtapeSegments)
    .where(and(eq(mixtapeSegments.mixtapeId, mixtapeId), eq(mixtapeSegments.matchStatus, "manual")))
    .all().length;

  if (manualCount > 0 && !force) {
    return NextResponse.json(
      {
        error: {
          code: "manual_segments_exist",
          message: `Re-analyzing will discard your manual corrections for ${manualCount} segment${manualCount === 1 ? "" : "s"}.`,
          manualSegmentCount: manualCount,
        },
      },
      { status: 409 }
    );
  }

  const absPath = path.join(getDataDir(), existing.path);
  const job = createAndEnqueueMixtapeJob(mixtapeId, absPath);

  return NextResponse.json(job, { status: 201 });
}
