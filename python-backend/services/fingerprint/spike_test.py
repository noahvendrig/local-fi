"""Phase-1 algorithm spike (see the mixtape-segmentation plan): validates the
scale-invariant triplet hashing in hashing.py + the two-stage matching in
matching.py actually recover the correct alignment under pitch/tempo shift,
before any of this is wired into the DB/job system.

Uses synthetic audio (sine-tone "notes" + noise) instead of real files so it
runs standalone with no ffmpeg/sample-library dependency -- it exercises the
same landmarks -> hashes -> index -> match pipeline real audio would go
through, just with a signal we can generate ground truth for. Run from
python-backend/ with:

    .venv/Scripts/python -m services.fingerprint.spike_test
"""
from __future__ import annotations

import numpy as np

from .landmarks import SAMPLE_RATE, extract_landmarks
from .matching import MIN_SPAN_MS, build_index, match_query


def render(events: list[tuple[float, float, float, float]], duration_ms: float, seed: int, noise_level: float = 0.02) -> np.ndarray:
    """events: list of (freq_hz, start_ms, dur_ms, amplitude). Returns mono float32 PCM at SAMPLE_RATE."""
    rng = np.random.default_rng(seed)
    n = int(duration_ms / 1000 * SAMPLE_RATE)
    pcm = rng.normal(0, noise_level, n).astype(np.float32)
    t = np.arange(n) / SAMPLE_RATE
    for freq, start_ms, dur_ms, amp in events:
        start = int(start_ms / 1000 * SAMPLE_RATE)
        dur = int(dur_ms / 1000 * SAMPLE_RATE)
        end = min(n, start + dur)
        if start < 0 or start >= n or end <= start:
            continue
        seg_t = t[start:end] - t[start]
        dur_s = dur_ms / 1000
        # Quick linear fade in/out so notes don't click.
        envelope = np.minimum(seg_t * 50, np.minimum(1.0, (dur_s - seg_t) * 50))
        envelope = np.clip(envelope, 0, 1)
        pcm[start:end] += (amp * envelope * np.sin(2 * np.pi * freq * seg_t)).astype(np.float32)
    return pcm


def make_song_events(rng: np.random.Generator, duration_ms: float, count: int) -> list[tuple[float, float, float, float]]:
    events = []
    for _ in range(count):
        freq = float(rng.uniform(250, 3200))
        start = float(rng.uniform(0, duration_ms - 500))
        dur = float(rng.uniform(150, 400))
        amp = float(rng.uniform(0.3, 0.8))
        events.append((freq, start, dur, amp))
    return events


def shift_events(
    events: list[tuple[float, float, float, float]],
    pitch_factor: float,
    tempo_ratio: float,
    offset_ms: float,
) -> list[tuple[float, float, float, float]]:
    """Applies a pitch multiplier and a tempo (playback-speed) multiplier to a
    song's own event timeline, then places it at `offset_ms` in a longer mix --
    mirrors how matching.py defines tempo_ratio: mix_time = lib_time / tempo_ratio + offset.
    """
    shifted = []
    for freq, start, dur, amp in events:
        shifted.append((freq * pitch_factor, start / tempo_ratio + offset_ms, dur / tempo_ratio, amp))
    return shifted


def run_case(name: str, pitch_factor: float, tempo_ratio: float, true_offset_ms: float) -> bool:
    rng = np.random.default_rng(42)
    song_duration_ms = 20_000.0
    # Real music has far denser spectral content (percussive onsets, chords,
    # harmonics) than a sparse sine-note generator -- bump note density so
    # this synthetic signal doesn't understate real-world landmark density
    # and artificially starve the min-span check below.
    song_events = make_song_events(rng, song_duration_ms, count=220)

    # "Library": the track at its native speed.
    library_pcm = render(song_events, song_duration_ms, seed=1)
    library_landmarks = {1: extract_landmarks(library_pcm)}
    index = build_index(library_landmarks)

    # "Mixtape": the same song pitch/tempo-shifted and placed inside a longer
    # buffer, with unrelated decoy tones elsewhere (other "songs" playing).
    mix_duration_ms = 60_000.0
    mix_rng = np.random.default_rng(7)
    decoy_events = make_song_events(mix_rng, mix_duration_ms, count=300)
    target_events = shift_events(song_events, pitch_factor, tempo_ratio, true_offset_ms)
    mixtape_pcm = render(decoy_events + target_events, mix_duration_ms, seed=2)

    query_landmarks = extract_landmarks(mixtape_pcm)
    results = match_query(query_landmarks, index)

    print(f"\n=== {name} (pitch x{pitch_factor:.3f}, tempo x{tempo_ratio:.3f}, offset {true_offset_ms:.0f}ms) ===")
    print(f"  library landmarks: {len(library_landmarks[1])}, query landmarks: {len(query_landmarks)}")
    if not results:
        print("  FAIL: no match found")
        return False

    best = results[0]
    ratio_ok = abs(best.tempo_ratio - tempo_ratio) <= 0.011  # within one grid step
    offset_ok = abs(best.query_offset_ms - true_offset_ms) <= 500  # within 2 buckets
    span_ok = best.span_ms >= MIN_SPAN_MS
    passed = ratio_ok and offset_ok and span_ok

    print(
        f"  best match: track={best.track_id} tempo_ratio={best.tempo_ratio:.3f} "
        f"offset={best.query_offset_ms:.0f}ms span={best.span_ms:.0f}ms "
        f"votes={best.vote_count}/{best.raw_hit_count} confidence={best.confidence:.2f}"
    )
    print(f"  ratio_ok={ratio_ok} offset_ok={offset_ok} span_ok={span_ok} -> {'PASS' if passed else 'FAIL'}")
    return passed


def main() -> None:
    cases = [
        ("unshifted baseline", 1.0, 1.0, 5000.0),
        ("typical +6% varispeed (pitch+tempo linked)", 1.06, 1.06, 12000.0),
        ("typical -6% varispeed (pitch+tempo linked)", 0.94, 0.94, 20000.0),
        ("keylock time-stretch only (+8% tempo, no pitch shift)", 1.0, 1.08, 8000.0),
        ("pitch shift only, no tempo change (+5%)", 1.05, 1.0, 15000.0),
        ("combined independent shift (pitch +3%, tempo -9%)", 1.03, 0.91, 30000.0),
    ]
    results = [run_case(*case) for case in cases]
    passed = sum(results)
    print(f"\n{passed}/{len(results)} cases passed")
    if passed < len(results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
