"""ONNX Runtime inference for track-level audio embeddings (Smart Shuffle similarity) and, from
the same model pass, genre labels (see genre.py).

Uses a fixed-shape ONNX export of PANNs Cnn14 (see scripts/export_similarity_model.py for how
weights/cnn14.onnx was produced) -- a pretrained AudioSet-trained CNN, not anything trained in
this repo. The exported graph takes a fixed (1, WINDOW_SAMPLES) input (confirmed: onnxruntime
rejects any other batch size), so a whole track is processed by splitting it into
WINDOW_SAMPLES-sized windows, running each through the model one at a time, and mean-pooling the
results -- standard practice for clip-level embeddings from a frame-level audio model, and it
sidesteps ONNX dynamic-batch export risk entirely. The graph has two outputs per window
(embedding, genre_probs); both are free from the same forward pass, so extracting genre alongside
the embedding costs no extra inference.

Runs on GPU automatically when one's usable, CPU otherwise -- see _get_session()'s provider
selection. Nothing here needs to know or care which it ends up on.
"""
from __future__ import annotations

import numpy as np

from config import SIMILARITY_MODEL_PATH

from .genre import NUM_GENRE_CLASSES, genre_probs_to_label, scored_genre_candidates

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

        # requirements.txt installs plain `onnxruntime` (CPU-only, works on every platform this
        # app supports) so a fresh install always works regardless of what hardware it's on --
        # `onnxruntime-gpu` has no macOS wheel at all and would break `pip install -r
        # requirements.txt` there. GPU use is opt-in instead: a user with an NVIDIA GPU can
        # separately `pip uninstall onnxruntime && pip install onnxruntime-gpu` (plus a working
        # CUDA/cuDNN setup) themselves, and this picks it up automatically with no further config
        # -- CUDAExecutionProvider only ever appears in get_available_providers() when that GPU
        # package (not the plain CPU one) is what's actually installed.
        available = ort.get_available_providers()
        if "CUDAExecutionProvider" in available:
            candidate = ort.InferenceSession(str(SIMILARITY_MODEL_PATH), providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
            # Session construction alone does NOT prove CUDA actually works -- confirmed on real
            # hardware (an RTX 3090 with onnxruntime-gpu installed but no system cuDNN 9): the
            # session above constructs fine and candidate.get_providers() happily reports
            # CUDAExecutionProvider as active, but the first real Conv op then throws
            # NOT_IMPLEMENTED ("cuDNN is unavailable ... LoadLibrary failed for cudnn64_9.dll") --
            # ORT does not fall back to CPU for that node on its own. So this runs one real
            # (cheap, zeros-input) inference here, up front, to actually prove the GPU path works
            # before trusting it for every track after -- not just construct-and-hope.
            try:
                candidate.run(None, {"waveform": np.zeros((1, WINDOW_SAMPLES), dtype=np.float32)})
                _session = candidate
                print(f"[similarity] ONNX Runtime using GPU: {_session.get_providers()}")
            except Exception as e:
                print(
                    f"[similarity] CUDAExecutionProvider is installed but failed on a real inference "
                    f"({e.__class__.__name__}: {e}) -- falling back to CPU. This usually means CUDA is "
                    f"present but cuDNN isn't (or is the wrong version) -- see requirements.txt."
                )
                _session = ort.InferenceSession(str(SIMILARITY_MODEL_PATH), providers=["CPUExecutionProvider"])
        else:
            _session = ort.InferenceSession(str(SIMILARITY_MODEL_PATH), providers=["CPUExecutionProvider"])
            print(f"[similarity] ONNX Runtime using CPU: {_session.get_providers()}")
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


def _run_windows(pcm: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray]:
    """Runs every window of `pcm` through the model once, returning the raw (unpooled) per-window
    (embedding, genre_probs) arrays -- shape (n_windows, EMBED_DIM) and (n_windows,
    NUM_GENRE_CLASSES) respectively. Shared by extract_embedding and
    extract_embedding_and_genre so a caller that wants both never pays for two separate passes."""
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
    window_genre_probs = np.empty((len(starts), NUM_GENRE_CLASSES), dtype=np.float32)
    for i, start in enumerate(starts):
        window = pcm[start : start + WINDOW_SAMPLES][None, :]  # (1, WINDOW_SAMPLES)
        embedding, genre_probs = session.run(None, {"waveform": window})
        window_embeddings[i] = embedding[0]
        window_genre_probs[i] = genre_probs[0]

    return window_embeddings, window_genre_probs


def _pool_embedding(window_embeddings: np.ndarray) -> np.ndarray:
    """Pooling happens before normalization (mean of raw per-window embeddings, normalized once
    at the end) so a track's overall direction in embedding space is what's compared --
    normalizing each window first and then averaging would generally yield a vector with norm < 1,
    understating windows that disagree with each other."""
    pooled = window_embeddings.mean(axis=0)
    norm = np.linalg.norm(pooled)
    if norm < 1e-8:
        return pooled.astype(np.float32)  # near-silent audio -- return as-is rather than divide by ~0
    return (pooled / norm).astype(np.float32)


def extract_embedding(pcm: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """pcm: mono float32 samples at `sample_rate` (must be SAMPLE_RATE). Returns an L2-normalized
    float32[EMBED_DIM] vector. See extract_embedding_and_genre if the caller also wants genre --
    that costs nothing extra over this, since both come from the same model pass."""
    window_embeddings, _ = _run_windows(pcm, sample_rate)
    return _pool_embedding(window_embeddings)


def extract_embedding_and_genre(
    pcm: np.ndarray, sample_rate: int = SAMPLE_RATE
) -> tuple[np.ndarray, str | None, list[tuple[str, float]]]:
    """Same embedding as extract_embedding, plus a genre label string (comma-joined, highest
    confidence first -- e.g. "House, Electronic, Dance") derived from the model's AudioSet
    classifier head, pooled the same way (mean across windows) before thresholding, and the full
    ranked (name, score) list every candidate scored -- not just the ones that cleared the
    threshold -- for job_manager.py's genre_debug log (see genre.py's scored_genre_candidates).
    The label is None when nothing cleared genre.py's confidence threshold -- not every track
    resembles one of AudioSet's genre classes closely enough to guess, and this errs toward
    leaving genre unset over guessing wrong (see genre.py)."""
    window_embeddings, window_genre_probs = _run_windows(pcm, sample_rate)
    embedding = _pool_embedding(window_embeddings)
    pooled_genre_probs = window_genre_probs.mean(axis=0)
    genre = genre_probs_to_label(pooled_genre_probs)
    candidates = scored_genre_candidates(pooled_genre_probs)
    return embedding, genre, candidates
