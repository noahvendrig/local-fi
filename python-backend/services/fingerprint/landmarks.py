"""STFT-based landmark (constellation) extraction for audio fingerprinting.

Landmarks are sparse (time, frequency) peaks picked from the spectrogram --
the raw material hashing.py turns into scale-invariant hashes. See
hashing.py's module docstring for why plain (freq, freq, dt) landmark
hashing (classic "Shazam" style) isn't enough for DJ sets: pitch/tempo
invariance has to be designed in starting here, by working with log-frequency
values rather than fixing it up after the fact.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import stft

SAMPLE_RATE = 12000  # decode.py resamples everything to this before extraction
FREQ_MIN_HZ = 100.0
FREQ_MAX_HZ = 5500.0  # keeps a clean margin under the 6000Hz Nyquist
WINDOW_SAMPLES = 1024  # ~85ms at 12kHz
HOP_SAMPLES = 256  # ~21ms, 75% overlap
NUM_BANDS = 6  # log-spaced sub-bands per frame, one peak candidate each
LOCAL_MAX_HALF_WINDOW = 5  # frames either side (~+-105ms) for the time-local-max test
ENERGY_SMOOTHING_FRAMES = 94  # ~2s at ~21ms hop, for the adaptive threshold
THRESHOLD_FACTOR = 1.5  # candidate must clear this multiple of local smoothed energy


@dataclass(frozen=True)
class Landmark:
    time_ms: float
    freq_hz: float
    magnitude: float


def extract_landmarks(pcm: np.ndarray, sample_rate: int = SAMPLE_RATE) -> list[Landmark]:
    """pcm: mono float32 samples at `sample_rate`. Returns landmarks sorted by time."""
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE}Hz input, got {sample_rate}Hz")
    if pcm.size < WINDOW_SAMPLES:
        return []

    freqs, _times, spec = stft(
        pcm,
        fs=sample_rate,
        window="hann",
        nperseg=WINDOW_SAMPLES,
        noverlap=WINDOW_SAMPLES - HOP_SAMPLES,
        boundary=None,
        padded=False,
    )
    mag = np.abs(spec)  # (n_freqs, n_frames)

    band_mask = (freqs >= FREQ_MIN_HZ) & (freqs <= FREQ_MAX_HZ)
    band_freqs = freqs[band_mask]
    band_mag = mag[band_mask, :]
    if band_freqs.size == 0 or band_mag.shape[1] == 0:
        return []

    # Log-spaced band edges over the frequency range of interest.
    edges = np.geomspace(FREQ_MIN_HZ, FREQ_MAX_HZ, NUM_BANDS + 1)
    band_indices = np.clip(np.digitize(band_freqs, edges[1:-1]), 0, NUM_BANDS - 1)

    n_frames = band_mag.shape[1]
    # Per-band, per-frame strongest bin -> a (NUM_BANDS, n_frames) grid of
    # (freq, magnitude) candidates, one per band per frame.
    cand_freq = np.zeros((NUM_BANDS, n_frames))
    cand_mag = np.zeros((NUM_BANDS, n_frames))
    for b in range(NUM_BANDS):
        rows = np.where(band_indices == b)[0]
        if rows.size == 0:
            continue
        sub = band_mag[rows, :]
        best_row = np.argmax(sub, axis=0)
        cand_mag[b, :] = sub[best_row, np.arange(n_frames)]
        cand_freq[b, :] = band_freqs[rows][best_row]

    # Adaptive threshold: smoothed overall band energy per frame, so sparse
    # or EQ'd-out passages just yield fewer peaks instead of wrong ones.
    frame_energy = band_mag.mean(axis=0)
    kernel = np.ones(ENERGY_SMOOTHING_FRAMES) / ENERGY_SMOOTHING_FRAMES
    smoothed = np.convolve(frame_energy, kernel, mode="same")
    threshold = smoothed * THRESHOLD_FACTOR

    landmarks: list[Landmark] = []
    hop_ms = HOP_SAMPLES / sample_rate * 1000.0
    w = LOCAL_MAX_HALF_WINDOW
    for b in range(NUM_BANDS):
        series = cand_mag[b, :]
        for t in range(n_frames):
            m = series[t]
            if m <= 0 or m < threshold[t]:
                continue
            lo = max(0, t - w)
            hi = min(n_frames, t + w + 1)
            if m < series[lo:hi].max():
                continue  # not a local maximum in this band's time series
            landmarks.append(Landmark(time_ms=t * hop_ms, freq_hz=float(cand_freq[b, t]), magnitude=float(m)))

    landmarks.sort(key=lambda lm: lm.time_ms)
    return landmarks
