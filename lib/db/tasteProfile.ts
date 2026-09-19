import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";

const HISTORY_TOP_N = 200;
const HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export interface WeightedHistoryEntry {
  trackId: number;
  weight: number;
}

/** Converts implicit-feedback signals (play_count, last_played_at) into a single decayed weight
 *  per track, for use as the "history" side of the weighted-nearest-neighbor taste model
 *  (lib/taste/tasteModel.ts). Only playCount > 0 and similarityStatus === "ready" rows are
 *  eligible -- the Python backend's score_weighted() can only use tracks it has an embedding for.
 *  No SQL-side LIMIT before decay: at personal-library scale a full filtered scan is cheap, and
 *  capping by raw playCount first could drop a recently-played track in favor of a
 *  stale-but-high-count one before recency gets a say. */
export function getPlayHistoryWeights(): WeightedHistoryEntry[] {
  const rows = getDb()
    .select({ id: tracks.id, playCount: tracks.playCount, lastPlayedAt: tracks.lastPlayedAt })
    .from(tracks)
    .where(and(isNull(tracks.deletedAt), gt(tracks.playCount, 0), eq(tracks.similarityStatus, "ready")))
    .all();

  const now = Date.now();
  const weighted = rows.map((r) => {
    // lastPlayedAt is set in the same transaction as playCount (app/api/v1/tracks/[id]/play/route.ts),
    // so a playCount > 0 row should always have it -- the `now` fallback is defensive only.
    const lastPlayedMs = r.lastPlayedAt ? Date.parse(r.lastPlayedAt) : now;
    const daysSince = Math.max(0, (now - lastPlayedMs) / MS_PER_DAY);
    const decay = Math.pow(0.5, daysSince / HALF_LIFE_DAYS);
    return { trackId: r.id, weight: r.playCount * decay };
  });

  weighted.sort((a, b) => b.weight - a.weight);
  return weighted.slice(0, HISTORY_TOP_N);
}
