"""Two-stage matching: cheap invariant retrieval, then a bounded re-score to
recover the actual tempo ratio and time offset (see hashing.py for why the
retrieval stage doesn't need to know the shift in advance).
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from .hashing import build_hashes
from .landmarks import Landmark

# Stage B: bounded tempo-ratio search grid, applied only to shortlisted
# candidates (not the whole library) -- +-12%, 1% steps.
TEMPO_RATIOS = np.arange(0.88, 1.121, 0.01)
OFFSET_BUCKET_MS = 250.0
MIN_RAW_HITS = 8  # floor before a track is even shortlisted
MIN_SPAN_MS = 15_000.0  # minimum contiguous aligned span to accept a match

# Confidence calibration: raw_hit_count (Stage A hash collisions) grows with
# genre-wide hash noise across the whole library, not just true overlap, so
# vote_count / raw_hit_count (the original v1 formula) systematically
# under-reports real matches once the library has more than a couple of
# tracks in it -- see MatchResult.confidence. Instead we compare the winning
# (tempo_ratio, offset) bucket's vote_count against the count that bucket
# would get if raw_hit_count were spread uniformly across every bucket the
# Stage B grid considered ("concentration"), then log-squash that ratio into
# 0..1. These floor/ceiling constants were calibrated against a real ~140
# track library + two real mixtapes: background hash-collision noise tops
# out with concentration ~100-200, genuine matches start above ~500 and run
# into the tens of thousands.
CONCENTRATION_FLOOR = 200.0
CONCENTRATION_CEILING = 10_000.0


@dataclass(frozen=True)
class Posting:
    track_id: int
    time_ms: float


@dataclass
class MatchResult:
    track_id: int
    tempo_ratio: float
    query_offset_ms: float  # query_time = lib_time / tempo_ratio + query_offset_ms
    start_ms: float  # earliest query-time landmark supporting the winning alignment
    end_ms: float  # latest query-time landmark supporting the winning alignment
    span_ms: float
    vote_count: int
    raw_hit_count: int
    total_bins: int  # (tempo_ratio x offset-bucket) grid size Stage B searched, for confidence normalization

    @property
    def source_start_ms(self) -> float:
        """Where in the *matched track's own* timeline this segment starts."""
        return (self.start_ms - self.query_offset_ms) * self.tempo_ratio

    @property
    def confidence(self) -> float:
        # Normalized against the expected random-collision rate: how many
        # times more concentrated the winning bucket's votes are than chance
        # alone would produce, given this candidate's total raw hit count
        # spread evenly across the whole (tempo_ratio, offset) grid. See the
        # CONCENTRATION_FLOOR/CEILING calibration note above.
        if self.raw_hit_count == 0 or self.total_bins == 0:
            return 0.0
        expected_per_bin = self.raw_hit_count / self.total_bins
        if expected_per_bin <= 0:
            return 0.0
        concentration = self.vote_count / expected_per_bin
        if concentration <= CONCENTRATION_FLOOR:
            return 0.0
        log_span = math.log10(CONCENTRATION_CEILING) - math.log10(CONCENTRATION_FLOOR)
        return min(1.0, (math.log10(concentration) - math.log10(CONCENTRATION_FLOOR)) / log_span)


def build_index(tracks: dict[int, list[Landmark]]) -> dict[int, list[Posting]]:
    """dict[track_id -> landmarks] -> inverted index dict[hash -> postings]."""
    index: dict[int, list[Posting]] = defaultdict(list)
    for track_id, landmarks in tracks.items():
        for h in build_hashes(landmarks):
            index[h.value].append(Posting(track_id=track_id, time_ms=h.anchor_time_ms))
    return index


def _stage_b_vote(query_ms: np.ndarray, lib_ms: np.ndarray) -> tuple[int, int, np.ndarray, int]:
    """Vectorized (tempo_ratio, offset-bucket) histogram vote for one shortlisted
    candidate's raw hits. Builds the full (hit x tempo_ratio) offset/bucket grid
    as numpy arrays and finds the winning bin via bincount, replacing what was a
    Python-level double loop (hits x TEMPO_RATIOS) with a dict-of-lists
    accumulator -- the hot path for long mixtapes, since every raw hit on every
    shortlisted candidate used to cost 25 individual dict-append operations.

    Returns (best_r_idx, best_bucket, query_times_in_winning_bin, total_bins).
    """
    # offset[i, j] = query_ms[i] - lib_ms[i] / TEMPO_RATIOS[j]
    offset = query_ms[:, None] - lib_ms[:, None] / TEMPO_RATIOS[None, :]
    bucket = np.round(offset / OFFSET_BUCKET_MS).astype(np.int64)

    bucket_min = int(bucket.min())
    bucket_range = int(bucket.max()) - bucket_min + 1
    n_ratios = TEMPO_RATIOS.shape[0]
    r_idx = np.arange(n_ratios, dtype=np.int64)[None, :]
    keys = (r_idx * bucket_range + (bucket - bucket_min)).ravel()

    total_bins = n_ratios * bucket_range
    counts = np.bincount(keys, minlength=total_bins)
    winner = int(np.argmax(counts))
    best_r_idx, shifted_bucket = divmod(winner, bucket_range)
    best_bucket = shifted_bucket + bucket_min

    winning_mask = bucket[:, best_r_idx] == best_bucket
    return best_r_idx, best_bucket, query_ms[winning_mask], total_bins


def match_query(
    query_landmarks: list[Landmark],
    index: dict[int, list[Posting]],
) -> list[MatchResult]:
    query_hashes = build_hashes(query_landmarks)

    # Stage A: shortlist candidate tracks by raw hash-collision count. This
    # step is already pitch/tempo-invariant -- no need to know the shift yet.
    raw_hits: dict[int, list[tuple[float, float]]] = defaultdict(list)  # track_id -> [(query_ms, lib_ms), ...]
    for h in query_hashes:
        for posting in index.get(h.value, ()):
            raw_hits[posting.track_id].append((h.anchor_time_ms, posting.time_ms))

    results: list[MatchResult] = []
    for track_id, hits in raw_hits.items():
        if len(hits) < MIN_RAW_HITS:
            continue

        # Stage B: (tempo_ratio, offset) histogram vote, restricted to this
        # one shortlisted candidate's hits -- cheap, not a whole-library scan.
        hits_arr = np.asarray(hits, dtype=np.float64)  # (N, 2): [query_ms, lib_ms]
        best_r_idx, best_bucket, best_query_times, total_bins = _stage_b_vote(hits_arr[:, 0], hits_arr[:, 1])

        span_ms = float(best_query_times.max() - best_query_times.min()) if best_query_times.size > 1 else 0.0
        if span_ms < MIN_SPAN_MS:
            continue

        results.append(
            MatchResult(
                track_id=track_id,
                tempo_ratio=float(TEMPO_RATIOS[best_r_idx]),
                query_offset_ms=best_bucket * OFFSET_BUCKET_MS,
                start_ms=float(best_query_times.min()),
                end_ms=float(best_query_times.max()),
                span_ms=span_ms,
                vote_count=int(best_query_times.size),
                raw_hit_count=len(hits),
                total_bins=total_bins,
            )
        )

    results.sort(key=lambda r: r.confidence, reverse=True)
    return results
