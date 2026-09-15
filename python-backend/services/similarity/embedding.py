"""ONNX Runtime inference for track-level audio embeddings (Smart Shuffle similarity).

Uses a fixed-shape ONNX export of PANNs Cnn14's embedding head (see
scripts/export_similarity_model.py for how weights/cnn14.onnx was produced) -- a pretrained
AudioSet-trained CNN, not anything trained in this repo. The exported graph takes a fixed
(1, WINDOW_SAMPLES) input (confirmed: onnxruntime rejects any other batch size), so a whole track
is embedded by splitting it into WINDOW_SAMPLES-sized windows, running each through the model one
at a time, and mean-pooling the results -- standard practice for clip-level embeddings from a
frame-level audio model, and it sidesteps ONNX dynamic-batch export risk entirely.
"""
from __future__ import annotations

import numpy as np

from config import SIMILARITY_MODEL_PATH

SAMPLE_RATE = 32000  # decode.py must be called with this rate for extract_embedding's input to be valid
WINDOW_SECONDS = 10
WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS  # 320000, matches the ONNX export's fixed input shape
EMBED_DIM = 2048
# Cap window count for very long files (DJ mixtapes can run 60+ minutes) -- Smart Shuffle wants a
# representative "vibe" vector, not exhaustive coverage of a whole set; personal-library-scale
# pragmatism, same spirit as landmarks.py's own fixed-parameter choices elsewhere in this codebase.
MAX_WINDOWS = 12

_session = None  # lazy: python-backend must still start and serve fingerprint/download routes
# even if weights/cnn14.onnx hasn't been set up yet.


class ModelNotAvailableError(RuntimeError):
    """Raised when the ONNX model file isn't present. Caught per-track by job_manager.py -- a
    missing model marks that track's job result as failed, it doesn't crash the process."""


def _get_session():
    global _session
    if _session is None:
        if not SIMILARITY_MODEL_PATH.exists():
            raise ModelNotAvailableError(
                f"Similarity model not found at {SIMILARITY_MODEL_PATH}. Run "
                "scripts/export_similarity_model.py once to produce it (see that script's docstring)."
            )
        import onnxruntime as ort

        _session = ort.InferenceSession(str(SIMILARITY_MODEL_PATH), providers=["CPUExecutionProvider"])
    return _session


def _window_starts(total_samples: int) -> list[int]:
    """Evenly-spaced window start offsets covering the track, capped at MAX_WINDOWS."""
    if total_samples <= WINDOW_SAMPLES:
        return [0]
    n_windows = min(MAX_WINDOWS, -(-total_samples // WINDOW_SAMPLES))  # ceil div, capped
    if n_windows <= 1:
        return [0]
    last_start = total_samples - WINDOW_SAMPLES
    return [round(i * last_start / (n_windows - 1)) for i in range(n_windows)]


def extract_embedding(pcm: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """pcm: mono float32 samples at `sample_rate` (must be SAMPLE_RATE). Returns an L2-normalized
    float32[EMBED_DIM] vector. Pooling happens before normalization (mean of raw per-window
    embeddings, normalized once at the end) so a track's overall direction in embedding space is
    what's compared -- normalizing each window first and then averaging would generally yield a
    vector with norm < 1, understating windows that disagree with each other."""
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE}Hz input, got {sample_rate}Hz")

    session = _get_session()
    pcm = np.asarray(pcm, dtype=np.float32)

    if pcm.size < WINDOW_SAMPLES:
        padded = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
        padded[: pcm.size] = pcm
        starts = [0]
        pcm = padded
    else:
        starts = _window_starts(pcm.size)

    # The exported ONNX graph has a fixed batch dimension of 1 (verified against the actual
    # export -- onnxruntime rejects any other batch size), so windows are run one at a time
    # rather than stacked into a single batched call.
    window_embeddings = np.empty((len(starts), EMBED_DIM), dtype=np.float32)
    for i, start in enumerate(starts):
        window = pcm[start : start + WINDOW_SAMPLES][None, :]  # (1, WINDOW_SAMPLES)
        window_embeddings[i] = session.run(None, {"waveform": window})[0][0]

    pooled = window_embeddings.mean(axis=0)
    norm = np.linalg.norm(pooled)
    if norm < 1e-8:
        return pooled.astype(np.float32)  # near-silent audio -- return as-is rather than divide by ~0
    return (pooled / norm).astype(np.float32)
