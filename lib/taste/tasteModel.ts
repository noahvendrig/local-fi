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

/** The same taste signal as rankByTaste, exposed as a score map so a caller can BLEND it with other
 *  relevance signals rather than sorting by it outright.
 *
 *  Vibe matching needs this shape: the old code called rankByTaste on the whole candidate pool and
 *  then trimmed, which meant taste decided the ORDER and theme relevance only decided membership --
 *  so a strong play history could push every on-prompt track out of the trim. As one band among
 *  several in vibeScore.ts, taste can only break ties, never cross a hard constraint.
 *
 *  Returns an empty Map on cold start or any backend failure, exactly like rankByTaste. */
export async function getTasteScoreMap(candidateIds: number[]): Promise<Map<number, number>> {
  const history = getPlayHistoryWeights();
  if (history.length === 0 || candidateIds.length === 0) return new Map();
  return fetchTasteScores(history, candidateIds);
}
