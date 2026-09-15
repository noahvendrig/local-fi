import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateSmartCrate } from "@/lib/crates/evaluateRules";
import { getDb } from "@/lib/db/client";
import { playlistTracks, playlists, tracks } from "@/lib/db/schema";
import { getTrackSummariesByIds } from "@/lib/db/trackSummary";
import { fetchSimilarTrack } from "@/lib/pythonBackend/similarityClient";

const QueueSourceSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("allSongs") }),
    z.object({ type: z.literal("crate"), crateId: z.number().int() }),
    z.object({ type: z.literal("album"), albumId: z.number().int() }),
    z.object({ type: z.literal("artist"), artistId: z.number().int() }),
  ])
  .nullable();

const BodySchema = z.object({
  trackId: z.number().int(),
  queueSource: QueueSourceSchema,
  excludeIds: z.array(z.number().int()).max(200).optional(),
});

/**
 * POST /api/v1/smart-suggest — Smart Shuffle's "what should play next" lookup. Playing from a
 * crate restricts candidates to that crate's members (live brute-force query on python-backend);
 * any other context (album/artist/allSongs/none) means the whole library, served from
 * python-backend's precomputed k-NN graph instead. Never errors on "no good suggestion" — returns
 * `{ track: null }` so the caller can just fall through to normal queue order.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid smart-suggest request.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }
  const { trackId, queueSource, excludeIds = [] } = parsed.data;

  const db = getDb();
  const track = db.select().from(tracks).where(eq(tracks.id, trackId)).get();
  if (!track || track.similarityStatus !== "ready") {
    return NextResponse.json({ track: null });
  }

  const excludeSet = new Set([...excludeIds, trackId]);

  if (queueSource?.type === "crate") {
    const playlist = db.select().from(playlists).where(eq(playlists.id, queueSource.crateId)).get();
    if (!playlist) return NextResponse.json({ track: null });

    let memberIds: number[];
    if (playlist.type === "manual") {
      memberIds = db
        .select({ id: tracks.id, similarityStatus: tracks.similarityStatus })
        .from(playlistTracks)
        .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
        .where(and(eq(playlistTracks.playlistId, playlist.id), isNull(tracks.deletedAt)))
        .all()
        .filter((t) => t.similarityStatus === "ready" && !excludeSet.has(t.id))
        .map((t) => t.id);
    } else {
      const rules = playlist.rulesJson ? JSON.parse(playlist.rulesJson) : { match: "all", conditions: [] };
      memberIds = evaluateSmartCrate(db, rules, playlist.sortField)
        .filter((t) => t.similarityStatus === "ready" && !excludeSet.has(t.id))
        .map((t) => t.id);
    }

    if (memberIds.length === 0) return NextResponse.json({ track: null });

    const matches = await fetchSimilarTrack(trackId, { candidateIds: memberIds, topK: 1 });
    const winner = matches[0];
    if (!winner) return NextResponse.json({ track: null });
    const [summary] = getTrackSummariesByIds(db, [winner.track_id]);
    return NextResponse.json({ track: summary ?? null });
  }

  // Whole library: let python-backend serve its precomputed k-NN graph (no candidate_ids).
  const matches = await fetchSimilarTrack(trackId, { excludeIds: [...excludeSet], topK: 1 });
  const winner = matches[0];
  if (!winner) return NextResponse.json({ track: null });
  const [summary] = getTrackSummariesByIds(db, [winner.track_id]);
  return NextResponse.json({ track: summary ?? null });
}
