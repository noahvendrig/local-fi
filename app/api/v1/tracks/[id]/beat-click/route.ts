import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { ensureBeatGrid } from "@/lib/analysis/beatGrid";
import { renderBeatClickOverlay } from "@/lib/analysis/beatClickTrack";
import { ANALYSIS_SAMPLE_RATE, decodeMonoPcmF32 } from "@/lib/analysis/pcmDecode";
import { encodeWavPcm16Mono } from "@/lib/analysis/wavEncode";
import { resolveTrackAbsPath } from "@/lib/storage/resolveTrackPath";

const NOT_FOUND = new Response("Track not found.", { status: 404 });
const NO_BPM = new Response("Track has no BPM — beat grid cannot be computed.", { status: 422 });

/**
 * GET /api/v1/tracks/:id/beat-click — debug tool: the track's own audio (ducked) with an audible
 * click layered onto every beat this repo's detector currently finds (a higher-pitched click on
 * downbeats), so the beat grid can be judged by ear instead of only inspected as numbers. Runs the
 * exact same decode + detectBeatGrid/estimateDownbeats path as production analysis — nothing here
 * is a separate/idealized detector. Not wired into any UI; hit it directly in a browser or via
 * curl -o test.wav.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const track = getDb()
    .select()
    .from(tracks)
    .where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt)))
    .get();
  if (!track) return NOT_FOUND;
  if (track.bpm == null) return NO_BPM;

  const grid = await ensureBeatGrid(trackId);
  if (grid == null) {
    return new Response("Could not detect a beat grid for this track.", { status: 422 });
  }

  const absPath = resolveTrackAbsPath(track);
  const samples = await decodeMonoPcmF32(absPath, ANALYSIS_SAMPLE_RATE);
  const overlaid = renderBeatClickOverlay(samples, ANALYSIS_SAMPLE_RATE, grid.beats, grid.downbeats);
  const wav = encodeWavPcm16Mono(overlaid, ANALYSIS_SAMPLE_RATE);

  return new Response(new Uint8Array(wav), {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Disposition": `inline; filename="track-${trackId}-beat-click.wav"`,
    },
  });
}
