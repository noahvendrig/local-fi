import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { getDataDir } from "@/lib/storage/dataDir";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "No waveform for this track." } }, { status: 404 });

/** GET /api/v1/tracks/:id/waveform — raw .lfpk peak sidecar bytes (ARCHITECTURE.md §3.5, §7). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const track = getDb()
    .select({ waveformPath: tracks.waveformPath, waveformStatus: tracks.waveformStatus })
    .from(tracks)
    .where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt)))
    .get();
  if (!track?.waveformPath || track.waveformStatus !== "ready") return NOT_FOUND;

  const absPath = path.join(getDataDir(), track.waveformPath);
  if (!existsSync(absPath)) return NOT_FOUND;

  const buffer = readFileSync(absPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "private, max-age=604800",
    },
  });
}
