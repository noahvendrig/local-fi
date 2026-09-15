import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { mixtapes } from "@/lib/db/schema";
import { getDataDir } from "@/lib/storage/dataDir";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "No waveform for this mixtape." } }, { status: 404 });

/** GET /api/v1/mixtapes/:id/waveform — raw .lfpk peak sidecar bytes (mirrors tracks/:id/waveform). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mixtapeId = Number(id);
  if (!Number.isInteger(mixtapeId)) return NOT_FOUND;

  const mixtape = getDb()
    .select({ waveformPath: mixtapes.waveformPath, waveformStatus: mixtapes.waveformStatus })
    .from(mixtapes)
    .where(eq(mixtapes.id, mixtapeId))
    .get();
  if (!mixtape?.waveformPath || mixtape.waveformStatus !== "ready") return NOT_FOUND;

  const absPath = path.join(getDataDir(), mixtape.waveformPath);
  if (!existsSync(absPath)) return NOT_FOUND;

  const buffer = readFileSync(absPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "private, max-age=604800",
    },
  });
}
