"""One-time dev-side export: PANNs Cnn14's embedding head + AudioSet classifier head -> ONNX, for
Smart Shuffle similarity (services/similarity/embedding.py) and audio-based genre detection
(services/similarity/genre.py). NOT part of the running app -- python-backend's own
requirements.txt only needs onnxruntime; this script needs torch + panns_inference, installed
separately in a throwaway venv, e.g.:

    python -m venv .export-venv
    .export-venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cpu
    .export-venv/Scripts/pip install panns_inference onnxruntime onnxscript
    .export-venv/Scripts/python scripts/export_similarity_model.py

Windows note: panns_inference's own checkpoint/label auto-download shells out to `wget`, which
Windows doesn't have, so it silently fails. Fetch these two files yourself first (PowerShell/curl,
whatever's on hand) into %USERPROFILE%/panns_data/ (Path.home()/panns_data on other platforms):
  - https://zenodo.org/record/3987831/files/Cnn14_mAP%3D0.431.pth?download=1
      -> ~/panns_data/Cnn14_mAP=0.431.pth   (~323MB)
  - http://storage.googleapis.com/us_audioset/youtube_corpus/v1/csv/class_labels_indices.csv
      -> ~/panns_data/class_labels_indices.csv

Output: weights/cnn14.onnx + weights/cnn14.onnx.data (external-data format -- both files are
required together; onnxruntime locates the .data file automatically as long as it sits next to
the .onnx file). Verified 2026-09-15 on Python 3.13.14 / Windows: opset_version=17 gets
auto-upgraded to 18 by the exporter (one op, Pad, has no opset-17 version-converter adapter) --
this is expected, not a failure. Reference-vs-ONNX outputs matched within atol=1e-3 across zeros,
random-noise, and sine-wave inputs; the raw embedding is NOT L2-normalized by the model itself
(observed norm ~10.7) -- normalization happens in embedding.py's extract_embedding, after
mean-pooling across a track's windows, not here. `genre_probs` (added 2026-09-20, alongside
`embedding`) IS already sigmoided by Cnn14's own forward (AudioSet is multi-label, so Cnn14 uses
per-class sigmoid rather than softmax) -- callers threshold it directly, no further activation
needed. Exporting both from one graph costs nothing extra at inference: Cnn14's forward computes
clipwise_output and embedding in the same pass regardless, this just stops discarding the former.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from panns_inference import AudioTagging

SAMPLE_RATE = 32000
WINDOW_SECONDS = 10
WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS  # 320000

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "weights"
OUTPUT_PATH = OUTPUT_DIR / "cnn14.onnx"


class EmbeddingAndGenre(nn.Module):
    """Cnn14's forward returns a dict ({'clipwise_output', 'embedding'}); ONNX export needs a
    plain tensor-in/tensor-out module, so this wrapper returns both as a tuple instead."""

    def __init__(self, inner: nn.Module):
        super().__init__()
        self.inner = inner

    def forward(self, waveform: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        out = self.inner(waveform, None)
        return out["embedding"], out["clipwise_output"]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading PANNs Cnn14 checkpoint...")
    at = AudioTagging(checkpoint_path=None, device="cpu")
    wrapper = EmbeddingAndGenre(at.model)
    wrapper.eval()

    dummy = torch.zeros(1, WINDOW_SAMPLES, dtype=torch.float32)

    with torch.no_grad():
        ref_embedding, ref_genre = wrapper(dummy)
    ref_embedding, ref_genre = ref_embedding.numpy(), ref_genre.numpy()
    print("Reference embedding shape:", ref_embedding.shape, "genre_probs shape:", ref_genre.shape)

    print(f"Exporting to {OUTPUT_PATH} (opset 18, fixed input shape (1, {WINDOW_SAMPLES}))...")
    torch.onnx.export(
        wrapper,
        dummy,
        str(OUTPUT_PATH),
        input_names=["waveform"],
        output_names=["embedding", "genre_probs"],
        opset_version=18,
        do_constant_folding=True,
    )
    print("Export complete:", OUTPUT_PATH, "+", OUTPUT_PATH.with_suffix(".onnx.data").name)

    import onnxruntime as ort

    sess = ort.InferenceSession(str(OUTPUT_PATH), providers=["CPUExecutionProvider"])
    onnx_embedding, onnx_genre = sess.run(None, {"waveform": dummy.numpy()})
    embedding_ok = np.allclose(ref_embedding, onnx_embedding, atol=1e-3)
    genre_ok = np.allclose(ref_genre, onnx_genre, atol=1e-3)
    print(
        f"Verification (zeros input): embedding max abs diff {np.abs(ref_embedding - onnx_embedding).max():.2e}, allclose={embedding_ok}; "
        f"genre_probs max abs diff {np.abs(ref_genre - onnx_genre).max():.2e}, allclose={genre_ok}"
    )
    if not (embedding_ok and genre_ok):
        raise SystemExit("ONNX output diverged from the reference PyTorch model -- do not ship this export.")
    print("PASS")


if __name__ == "__main__":
    main()
