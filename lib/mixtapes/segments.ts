import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { mixtapeSegments, tracks } from "../db/schema";
import type { PythonMixtapeSegmentResult } from "../pythonBackend/fingerprintClient";

// Sub-second gaps between accepted segments are just alignment-boundary jitter, not a real
// unrecognized stretch worth a row of its own — skip anything shorter than this.
const MIN_GAP_SECONDS = 1.0;

// Two matches whose windows overlap by at least this fraction of the shorter one are treated as
// the same slot detected twice (e.g. the same song imported into the library more than once, so
// each copy's fingerprint independently matches the identical stretch of the mixtape) rather than
// a legitimate crossfade, where the outgoing/incoming tracks only share a few seconds out of
// windows that are minutes long. Only the highest-confidence match per slot is kept.
const DUPLICATE_OVERLAP_RATIO = 0.7;

/** Drops lower-confidence matches whose time window is essentially the same slot as an
 *  already-kept, higher-confidence match (see DUPLICATE_OVERLAP_RATIO) — collapses duplicate
 *  detections of one library song appearing more than once down to a single segment. */
function dedupeOverlappingMatches(matches: PythonMixtapeSegmentResult[]): PythonMixtapeSegmentResult[] {
  const byConfidence = [...matches].sort((a, b) => b.confidence - a.confidence);
  const kept: PythonMixtapeSegmentResult[] = [];
  for (const candidate of byConfidence) {
    const candidateSpanMs = candidate.end_ms - candidate.start_ms;
    const isDuplicate = kept.some((k) => {
      const overlapMs = Math.min(k.end_ms, candidate.end_ms) - Math.max(k.start_ms, candidate.start_ms);
      return candidateSpanMs > 0 && overlapMs / candidateSpanMs >= DUPLICATE_OVERLAP_RATIO;
    });
    if (!isDuplicate) kept.push(candidate);
  }
  return kept;
}

interface MatchedInterval {
  startSeconds: number;
  endSeconds: number;
}

interface SegmentRow {
  startSeconds: number;
  endSeconds: number;
  matchedTrackId: number | null;
  matchStatus: "auto_matched" | "unrecognized";
  confidenceScore: number | null;
  matchedTempoRatio: number | null;
  sourceStartSeconds: number | null;
}

/** Merges overlapping/touching intervals — used only to find the *uncovered* gaps between
 *  accepted matches. The matched segments themselves are inserted as-is, overlaps included:
 *  a crossfade legitimately produces overlapping accepted segments for the outgoing/incoming
 *  track, and that's meant to render as overlapping blocks in the timeline, not be clipped. */
function mergeIntervals(intervals: MatchedInterval[]): MatchedInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startSeconds - b.startSeconds);
  const merged: MatchedInterval[] = [{ ...sorted[0] }];
  for (const next of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (next.startSeconds <= last.endSeconds) {
      last.endSeconds = Math.max(last.endSeconds, next.endSeconds);
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

/** python-backend's fingerprint index is a separate process with its own on-disk sidecars, so it
 *  can still match a track whose library row has since been purged (and its sidecar left behind).
 *  Inserting that ghost id would blow up the whole analysis on mixtape_segments' foreign key, so
 *  drop those matches here — the stretch they covered just falls through as an unrecognized gap. */
function dropMatchesForMissingTracks(matches: PythonMixtapeSegmentResult[]): PythonMixtapeSegmentResult[] {
  const trackIds = [...new Set(matches.map((m) => m.track_id))];
  if (trackIds.length === 0) return matches;
  const existing = new Set(
    getDb()
      .select({ id: tracks.id })
      .from(tracks)
      .where(inArray(tracks.id, trackIds))
      .all()
      .map((row) => row.id)
  );
  return matches.filter((m) => existing.has(m.track_id));
}

/**
 * Turns python-backend's flat match list into `mixtapeSegments` rows: the matches themselves
 * (matchStatus "auto_matched"), plus a synthetic "unrecognized" row for every stretch of the
 * mixtape's timeline no accepted match covers. Replaces whatever segments already exist for
 * this mixtape — callers are responsible for confirming that's OK (see the analyze route's
 * manual-segment check) before calling this.
 */
export function writeMixtapeSegments(
  mixtapeId: number,
  durationSeconds: number,
  matches: PythonMixtapeSegmentResult[]
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const matchedRows: SegmentRow[] = dedupeOverlappingMatches(dropMatchesForMissingTracks(matches)).map((m) => ({
    startSeconds: m.start_ms / 1000,
    endSeconds: m.end_ms / 1000,
    matchedTrackId: m.track_id,
    matchStatus: "auto_matched" as const,
    confidenceScore: m.confidence,
    matchedTempoRatio: m.tempo_ratio,
    sourceStartSeconds: m.source_start_ms / 1000,
  }));

  const merged = mergeIntervals(matchedRows.map((m) => ({ startSeconds: m.startSeconds, endSeconds: m.endSeconds })));

  const gapRows: SegmentRow[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.startSeconds - cursor >= MIN_GAP_SECONDS) {
      gapRows.push({
        startSeconds: cursor,
        endSeconds: interval.startSeconds,
        matchedTrackId: null,
        matchStatus: "unrecognized",
        confidenceScore: null,
        matchedTempoRatio: null,
        sourceStartSeconds: null,
      });
    }
    cursor = Math.max(cursor, interval.endSeconds);
  }
  if (durationSeconds - cursor >= MIN_GAP_SECONDS) {
    gapRows.push({
      startSeconds: cursor,
      endSeconds: durationSeconds,
      matchedTrackId: null,
      matchStatus: "unrecognized",
      confidenceScore: null,
      matchedTempoRatio: null,
      sourceStartSeconds: null,
    });
  }

  const allRows = [...matchedRows, ...gapRows].sort((a, b) => a.startSeconds - b.startSeconds);

  db.transaction((tx) => {
    tx.delete(mixtapeSegments).where(eq(mixtapeSegments.mixtapeId, mixtapeId)).run();
    if (allRows.length === 0) return;
    tx.insert(mixtapeSegments)
      .values(
        allRows.map((row, position) => ({
          mixtapeId,
          startSeconds: row.startSeconds,
          endSeconds: row.endSeconds,
          matchedTrackId: row.matchedTrackId,
          matchStatus: row.matchStatus,
          confidenceScore: row.confidenceScore,
          matchedTempoRatio: row.matchedTempoRatio,
          sourceStartSeconds: row.sourceStartSeconds,
          position,
          createdAt: now,
          updatedAt: now,
        }))
      )
      .run();
  });
}
