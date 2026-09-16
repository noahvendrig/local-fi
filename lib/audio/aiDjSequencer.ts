import type { PlaylistTrackItem } from "@/lib/api/playlistsClient";
import { keyCompatibility, tempoDelta, type MatchLevel } from "./djMatch";

export interface AiDjSkippedTrack {
  track: PlaylistTrackItem;
  reason: "no-bpm";
}

export interface AiDjSequenceResult {
  order: PlaylistTrackItem[];
  skipped: AiDjSkippedTrack[];
}

const KEY_MISMATCH_PENALTY: Record<MatchLevel, number> = { ok: 0, warn: 8, err: 20 };
/** Applied when one side has no key at all — worse than any known compatibility level, better than a hard clash. */
const KEY_UNKNOWN_PENALTY = 4;

function pairScore(from: PlaylistTrackItem, to: PlaylistTrackItem): number {
  const delta = tempoDelta(to.bpm, from.bpm);
  const tempoScore = delta ? Math.abs(delta.pct) : 0;
  const compat = keyCompatibility(to.key, from.key);
  const keyScore = compat ? KEY_MISMATCH_PENALTY[compat.level] : KEY_UNKNOWN_PENALTY;
  return tempoScore + keyScore;
}

/**
 * Picks the single best next track for `from` out of `candidates` by the same tempo/key
 * compatibility scoring sequenceCrateForAiDj uses to build a whole set order — used by the AI DJ
 * engine as its non-network fallback (or its "not yet a Smart Shuffle candidate" fallback) when
 * dynamically deciding one track at a time instead of pre-sequencing the whole crate. Returns null
 * only when `candidates` is empty.
 */
export function pickNextByTempoKey(from: PlaylistTrackItem, candidates: PlaylistTrackItem[]): PlaylistTrackItem | null {
  let best: PlaylistTrackItem | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = pairScore(from, candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Orders a crate's tracks for an AI DJ session. Tracks with no BPM can't be beatmatched or
 * beat-grid-aligned at all, so they're excluded rather than forced into the set (missing key only
 * lowers match confidence — it doesn't disqualify a track). A random BPM-known track anchors the
 * set (so back-to-back sessions on the same crate don't always open with the same song); the rest
 * follow via greedy nearest-tempo/key-neighbor selection from there, reusing the same compatibility
 * math the manual DJ view uses. Pure, but not deterministic (see the anchor pick) — callers that
 * need a stable order for a given input should memoize the result rather than recompute it.
 */
export function sequenceCrateForAiDj(tracks: PlaylistTrackItem[]): AiDjSequenceResult {
  const usable: PlaylistTrackItem[] = [];
  const skipped: AiDjSkippedTrack[] = [];
  for (const track of tracks) {
    if (track.bpm == null) skipped.push({ track, reason: "no-bpm" });
    else usable.push(track);
  }
  if (usable.length === 0) return { order: [], skipped };

  const byId = new Map(usable.map((t) => [t.id, t]));
  // A Set preserves insertion order, and only ever loses elements here — iterating it later still
  // walks remaining candidates in original crate order, which is what gives the strict `<` below
  // its "prefer the earlier track on a tie" behavior for free.
  const remaining = new Set(usable.map((t) => t.id));

  const anchor = usable[Math.floor(Math.random() * usable.length)];
  const order: PlaylistTrackItem[] = [anchor];
  remaining.delete(anchor.id);

  while (remaining.size > 0) {
    const current = order[order.length - 1];
    let best: PlaylistTrackItem | null = null;
    let bestScore = Infinity;
    for (const id of remaining) {
      const candidate = byId.get(id)!;
      const score = pairScore(current, candidate);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    order.push(best!);
    remaining.delete(best!.id);
  }

  return { order, skipped };
}
