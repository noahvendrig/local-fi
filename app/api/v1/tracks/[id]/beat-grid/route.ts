import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { ensureBeatGrid } from "@/lib/analysis/beatGrid";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });
const NO_BPM = NextResponse.json(
  { error: { code: "no_bpm", message: "Track has no BPM — beat grid cannot be computed." } },
  { status: 422 }
);

/** GET /api/v1/tracks/:id/beat-grid — beat timestamps (seconds), computed and cached on first request. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const track = getDb()
    .select({ bpm: tracks.bpm })
    .from(tracks)
    .where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt)))
    .get();
  if (!track) return NOT_FOUND;
  if (track.bpm == null) return NO_BPM;

  const grid = await ensureBeatGrid(trackId);
  if (grid == null) {
    return NextResponse.json(
      { error: { code: "detection_failed", message: "Could not detect a beat grid for this track." } },
      { status: 422 }
    );
  }

  return NextResponse.json({ bpm: track.bpm, beats: grid.beats, downbeats: grid.downbeats });
}
