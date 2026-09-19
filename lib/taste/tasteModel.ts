import { getPlayHistoryWeights } from "@/lib/db/tasteProfile";
import { fetchTasteScores } from "@/lib/pythonBackend/similarityClient";

/** Re-ranks a candidate list by personal taste: a weighted-nearest-neighbor score over the
 *  user's play history, computed against the same audio-content embeddings Smart Shuffle uses
 *  (python-backend/services/similarity/index.py's score_weighted). Candidates without an
 *  embedding yet (or any candidate, if the Python backend is unreachable/times out) keep their
 *  original relative order and are appended after the scored ones -- this never drops a
 *  candidate, it only reorders. Safe to call unconditionally: short-circuits to the original
 *  order on cold start (no play history yet) or on any backend failure. */
export async function rankByTaste<T extends { id: number }>(candidates: T[]): Promise<T[]> {
  const history = getPlayHistoryWeights();
  if (history.length === 0) return candidates;

  const scores = await fetchTasteScores(history, candidates.map((c) => c.id));
  if (scores.size === 0) return candidates;

  const scored: T[] = [];
  const unscored: T[] = [];
  for (const c of candidates) {
    (scores.has(c.id) ? scored : unscored).push(c);
  }
  scored.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
  return [...scored, ...unscored];
}
