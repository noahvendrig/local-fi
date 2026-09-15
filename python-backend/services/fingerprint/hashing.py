"""Scale-invariant triplet hashing.

Classic Shazam-style landmark hashing keys on raw (f1, f2, dt) between an
anchor peak and nearby "target zone" peaks. That breaks under DJ pitch/tempo
shifting: a pitch shift multiplies every frequency by a constant, a tempo
shift multiplies every time delta by a constant. Both are routine in DJ sets,
which is what this needs to handle (not just clean back-to-back mixtapes).

Instead we hash on:
  - log2(f1/f0), log2(f2/f0)   -- exactly invariant to any pitch multiplier s,
    since log2(s*f) - log2(s*f0) = log2(f) - log2(f0) for any s > 0.
  - log2((t2-t0)/(t1-t0))      -- exactly invariant to any tempo multiplier,
    by the same argument applied to the time axis.

One index built from unmodified reference tracks then retrieves matches at
*any* pitch/tempo shift, with no need to enumerate shift hypotheses at
index-build time (matching.py recovers the actual shift afterward, for the
much smaller shortlist retrieval produces). Same family of technique as
Panako (Six & Leman, ISMIR 2012), a published system built for this exact
problem.
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

import numpy as np

from .landmarks import Landmark

TARGET_ZONE_MIN_MS = 50.0
TARGET_ZONE_MAX_MS = 3000.0
# How many of the nearest-in-time target-zone peaks to consider per anchor,
# and how many of them get paired together into a hash. Real landmark
# extraction is noisy -- background noise, other tracks playing simultaneously
# in a mix, encoding artifacts -- so any *single* peak has a real chance of
# not surviving between two independent captures of "the same" audio. Since
# a hash needs all 3 of its landmarks (anchor + 2 targets) to survive intact,
# pairing each anchor with only one fixed pair of targets makes survival the
# product of three independent-ish survival probabilities -- too fragile in
# practice (empirically ~4-8% of hashes survived in testing). Generating a
# hash for every 2-combination of the nearest TARGET_ZONE_CANDIDATES peaks
# gives many redundant "votes" per anchor, so losing any one nearby peak only
# costs a few of an anchor's hashes rather than its only hash.
TARGET_ZONE_CANDIDATES = 5
TARGET_ZONE_PAIR_SIZE = 2

FREQ_BINS_PER_OCTAVE = 48  # 1/48 octave = 25-cent resolution
FREQ_RANGE_OCTAVES = 4  # clip |log2(f/f0)| to +-4 octaves
FREQ_BIN_MAX = FREQ_BINS_PER_OCTAVE * FREQ_RANGE_OCTAVES  # 192

TIME_RATIO_BINS_PER_OCTAVE = 24
TIME_RATIO_RANGE_OCTAVES = 2  # clip time ratio to [1/4, 4]
TIME_RATIO_BIN_MAX = TIME_RATIO_BINS_PER_OCTAVE * TIME_RATIO_RANGE_OCTAVES  # 48


@dataclass(frozen=True)
class Hash:
    value: int  # packed non-negative int, see _pack()
    anchor_time_ms: float


def _quantize(x: float, bins_per_octave: int, bin_max: int) -> int:
    q = int(round(x * bins_per_octave))
    return max(-bin_max, min(bin_max, q))


def _pack(q1: int, q2: int, q3: int) -> int:
    # Each qN is packed as an unsigned offset so the result is a plain
    # non-negative int (max value 385*385*97 ~= 14.4M, well under 32 bits).
    o1 = q1 + FREQ_BIN_MAX
    o2 = q2 + FREQ_BIN_MAX
    o3 = q3 + TIME_RATIO_BIN_MAX
    return (o1 * (2 * FREQ_BIN_MAX + 1) + o2) * (2 * TIME_RATIO_BIN_MAX + 1) + o3


def build_hashes(landmarks: list[Landmark]) -> list[Hash]:
    hashes: list[Hash] = []
    n = len(landmarks)
    for i, anchor in enumerate(landmarks):
        candidates: list[Landmark] = []
        for j in range(i + 1, n):
            dt = landmarks[j].time_ms - anchor.time_ms
            if dt < TARGET_ZONE_MIN_MS:
                continue
            if dt > TARGET_ZONE_MAX_MS:
                break  # landmarks sorted by time -> nothing further qualifies
            candidates.append(landmarks[j])
            if len(candidates) >= TARGET_ZONE_CANDIDATES:
                break
        if len(candidates) < TARGET_ZONE_PAIR_SIZE:
            continue

        for t1, t2 in combinations(candidates, TARGET_ZONE_PAIR_SIZE):
            dt1 = t1.time_ms - anchor.time_ms
            dt2 = t2.time_ms - anchor.time_ms
            if dt1 <= 0 or dt2 <= 0 or dt1 == dt2:
                continue

            delta_l1 = float(np.log2(t1.freq_hz / anchor.freq_hz))
            delta_l2 = float(np.log2(t2.freq_hz / anchor.freq_hz))
            log_time_ratio = float(np.log2(dt2 / dt1))

            q1 = _quantize(delta_l1, FREQ_BINS_PER_OCTAVE, FREQ_BIN_MAX)
            q2 = _quantize(delta_l2, FREQ_BINS_PER_OCTAVE, FREQ_BIN_MAX)
            q3 = _quantize(log_time_ratio, TIME_RATIO_BINS_PER_OCTAVE, TIME_RATIO_BIN_MAX)

            hashes.append(Hash(value=_pack(q1, q2, q3), anchor_time_ms=anchor.time_ms))

    return hashes
