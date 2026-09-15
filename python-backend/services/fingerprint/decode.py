"""Decodes an audio file to mono float32 PCM via ffmpeg, at the reduced
sample rate landmarks.py expects. Mirrors lib/ffmpeg.ts's external-binary
convention on the Node side -- same LOCALFI_FFMPEG_PATH env var, so both
processes honor one override rather than needing two different names.
"""
from __future__ import annotations

import os
import subprocess

import numpy as np

from .landmarks import SAMPLE_RATE


def _ffmpeg_path() -> str:
    return os.environ.get("LOCALFI_FFMPEG_PATH", "ffmpeg")


def decode_mono_pcm(path: str, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Returns mono float32 PCM samples at `sample_rate`, in [-1, 1]."""
    cmd = [
        _ffmpeg_path(),
        "-v", "error",
        "-i", path,
        "-f", "f32le",
        "-ac", "1",
        "-ar", str(sample_rate),
        "-",
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed to decode {path!r}: {proc.stderr.decode(errors='replace')}")
    return np.frombuffer(proc.stdout, dtype="<f4")
