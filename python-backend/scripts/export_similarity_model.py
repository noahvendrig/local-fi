"""One-time dev-side export: PANNs Cnn14's embedding head -> ONNX, for Smart Shuffle
(services/similarity/). NOT part of the running app -- python-backend's own requirements.txt
only needs onnxruntime; this script needs torch + panns_inference, installed separately in a
throwaway venv, e.g.:

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
mean-pooling across a track's windows, not here.
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


class EmbeddingOnly(nn.Module):
    """Cnn14's forward returns a dict ({'clipwise_output', 'embedding'}); ONNX export needs a
    plain tensor-in/tensor-out module, so this wrapper slices out just the embedding."""

    def __init__(self, inner: nn.Module):
        super().__init__()
        self.inner = inner

    def forward(self, waveform: torch.Tensor) -> torch.Tensor:
        return self.inner(waveform, None)["embedding"]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading PANNs Cnn14 checkpoint...")
    at = AudioTagging(checkpoint_path=None, device="cpu")
    wrapper = EmbeddingOnly(at.model)
    wrapper.eval()

    dummy = torch.zeros(1, WINDOW_SAMPLES, dtype=torch.float32)

    with torch.no_grad():
        ref = wrapper(dummy).numpy()
    print("Reference embedding shape:", ref.shape)

    print(f"Exporting to {OUTPUT_PATH} (opset 18, fixed input shape (1, {WINDOW_SAMPLES}))...")
    torch.onnx.export(
        wrapper,
        dummy,
        str(OUTPUT_PATH),
        input_names=["waveform"],
        output_names=["embedding"],
        opset_version=18,
        do_constant_folding=True,
    )
    print("Export complete:", OUTPUT_PATH, "+", OUTPUT_PATH.with_suffix(".onnx.data").name)

    import onnxruntime as ort

    sess = ort.InferenceSession(str(OUTPUT_PATH), providers=["CPUExecutionProvider"])
    onnx_out = sess.run(None, {"waveform": dummy.numpy()})[0]
    diff = np.abs(ref - onnx_out)
    ok = np.allclose(ref, onnx_out, atol=1e-3)
    print(f"Verification (zeros input): max abs diff {diff.max():.2e}, allclose={ok}")
    if not ok:
        raise SystemExit("ONNX output diverged from the reference PyTorch model -- do not ship this export.")
    print("PASS")


if __name__ == "__main__":
    main()
