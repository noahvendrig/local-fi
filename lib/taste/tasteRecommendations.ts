import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { getPlayHistoryWeights } from "@/lib/db/tasteProfile";
import { fetchTasteScores } from "@/lib/pythonBackend/similarityClient";

export interface TasteRecommendation {
  trackId: number;
  score: number;
}

/** Home dashboard's "Picked for you": library tracks the user hasn't played yet, ranked by the
 *  same weighted-nearest-neighbor taste model as Vibe Radio (lib/taste/tasteModel.ts), restricted
 *  to playCount === 0 so this never just re-surfaces what the user already knows they like.
 *  Unlike rankByTaste() -- a re-ranker that always returns every candidate, just reordered -- this
 *  is a recommender that must be able to say "no recommendation": returns [] on cold start (no
 *  play history yet) or if the Python backend is unreachable, rather than an arbitrary unranked
 *  sample. A "picked for you" card is presented as a real answer, so it must not exist when it
 *  isn't backed by one -- the caller hides the section entirely on an empty list. */
export async function getTasteRecommendations(limit = 5): Promise<TasteRecommendation[]> {
  const history = getPlayHistoryWeights();
  if (history.length === 0) return [];

  const candidates = getDb()
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(isNull(tracks.deletedAt), eq(tracks.similarityStatus, "ready"), eq(tracks.playCount, 0)))
    .all();
  if (candidates.length === 0) return [];

  const scores = await fetchTasteScores(history, candidates.map((c) => c.id));
  if (scores.size === 0) return [];

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([trackId, score]) => ({ trackId, score }));
}
