"""Vocal/instrumental stem separation via Demucs (htdemucs), used by the AI DJ feature's
just-in-time stem-mashup transitions. Lazily imports torch/demucs -- like
services/similarity/embedding.py's ONNX model, the base app must still boot and serve every other
route when the (large, GPU-wheel-specific) stems extras from requirements-stems.txt aren't
installed; AI DJ just falls back to a plain crossfade for that transition instead.

Demucs' htdemucs checkpoint natively separates into four stems (drums, bass, other, vocals), not
two -- the CLI's `--two-stems=vocals` flag is a post-processing convenience, not a different model.
This module reproduces that same merge (drums + bass + other -> "instrumental") directly against
the `demucs.api.Separator` output, rather than depending on a CLI-only flag being mirrored in the
library API.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Optional

_separator = None  # lazy Demucs model instance -- loaded once, reused across jobs
_device: Optional[str] = None

STEM_SAMPLE_RATE = 44100
NON_VOCAL_STEMS = ("drums", "bass", "other")


class ModelNotAvailableError(RuntimeError):
    """Raised when torch/demucs aren't installed. Caught per-job by job_manager.py -- a missing
    install marks that job failed, it doesn't crash the process (same convention as
    services/similarity/embedding.py's ModelNotAvailableError)."""


def get_device() -> str:
    """Picks and caches cuda/cpu for the separator model. A missing torch install is treated as
    "cpu" here (the actual ModelNotAvailableError is raised later, from _get_separator, once we
    know the caller actually wants to run a job -- this function alone must stay side-effect-free
    enough to back the /device status endpoint even when torch isn't installed)."""
    global _device
    if _device is None:
        try:
            import torch

            _device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            _device = "cpu"
    return _device


def get_device_info() -> dict:
    try:
        import torch
    except ImportError:
        return {"available": False, "device": "cpu", "cuda_device_name": None}
    cuda_available = torch.cuda.is_available()
    return {
        "available": True,
        "device": "cuda" if cuda_available else "cpu",
        "cuda_device_name": torch.cuda.get_device_name(0) if cuda_available else None,
    }


def _get_separator():
    global _separator
    if _separator is None:
        try:
            from demucs.api import Separator
        except ImportError as e:
            raise ModelNotAvailableError(
                "Demucs/torch not installed -- run `pip install -r requirements-stems.txt` "
                "(see that file for CPU vs CUDA torch wheel selection) to enable AI DJ stem separation."
            ) from e
        # First use downloads the htdemucs checkpoint (~80MB) to torch's model cache -- one-time,
        # needs internet access even though playback itself stays fully local afterward.
        _separator = Separator(model="htdemucs", device=get_device())
    return _separator


def _decode_stereo_wav(path: str, out_path: Path, sample_rate: int = STEM_SAMPLE_RATE) -> None:
    """Pre-decodes the source file to a stereo WAV via ffmpeg before handing it to Demucs, so
    container/codec support (mp3/flac/m4a/opus/...) is always ffmpeg's, not whatever Demucs'
    bundled loader happens to support -- same reasoning as fingerprint/decode.py's ffmpeg-first
    approach on the mono side."""
    ffmpeg_path = os.environ.get("LOCALFI_FFMPEG_PATH", "ffmpeg")
    cmd = [ffmpeg_path, "-v", "error", "-y", "-i", path, "-ac", "2", "-ar", str(sample_rate), str(out_path)]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed to decode {path!r}: {proc.stderr.decode(errors='replace')}")


def _save_wav(path: Path, tensor, sample_rate: int) -> None:
    """Writes a (channels, samples) torch tensor as a float32 WAV via scipy (already a project
    dependency), sidestepping torchaudio.save entirely -- recent torchaudio releases route .save
    through an optional `torchcodec` backend that isn't part of requirements-stems.txt, and
    scipy's writer needs nothing extra."""
    from scipy.io import wavfile

    audio = tensor.detach().cpu().numpy().T  # (channels, samples) -> (samples, channels)
    wavfile.write(str(path), sample_rate, audio.astype("float32"))


def separate_track(path: str, out_dir: Path) -> dict[str, Path]:
    """Splits the track at `path` into {"vocals": <wav path>, "instrumental": <wav path>} under
    `out_dir`. Raises ModelNotAvailableError if torch/demucs aren't installed."""
    separator = _get_separator()  # raises the friendly ModelNotAvailableError before any other import/ffmpeg work

    import torch

    out_dir.mkdir(parents=True, exist_ok=True)
    decoded_path = out_dir / "_source.wav"
    _decode_stereo_wav(path, decoded_path)
    try:
        _origin, separated = separator.separate_audio_file(decoded_path)
    finally:
        decoded_path.unlink(missing_ok=True)

    instrumental = torch.zeros_like(separated["vocals"])
    for stem in NON_VOCAL_STEMS:
        instrumental += separated[stem]

    vocals_path = out_dir / "vocals.wav"
    instrumental_path = out_dir / "instrumental.wav"
    _save_wav(vocals_path, separated["vocals"], separator.samplerate)
    _save_wav(instrumental_path, instrumental, separator.samplerate)

    return {"vocals": vocals_path, "instrumental": instrumental_path}
