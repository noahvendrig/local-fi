# App settings from environment variables
import os
from pathlib import Path

# This file lives at the root of python-backend/ (unlike the yt-downloader-ui
# fork it started from, where an equivalent config.py sat one level down inside
# a backend/ subfolder) — so the project root is just this file's own directory.
ROOT_DIR = Path(__file__).resolve().parent

# Load .env from project root if present
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT_DIR / ".env")
except ImportError:
    pass

download_dir_env = os.getenv("DOWNLOAD_DIR", "").strip()
DOWNLOAD_DIR = Path(download_dir_env) if download_dir_env else (ROOT_DIR / "downloads")
MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "1"))
FILE_TTL_HOURS = float(os.getenv("FILE_TTL_HOURS", "24"))
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

# Make sure download dir exists
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Landmark sidecars + inverted index for audio fingerprinting/mixtape matching
# (services/fingerprint/). Defaults under LOCALFI_DATA_DIR when set, so this
# derived DSP data sits alongside the rest of local-fi's local data rather
# than inside this source tree -- same fallback shape as DOWNLOAD_DIR above.
localfi_data_dir_env = os.getenv("LOCALFI_DATA_DIR", "").strip()
fingerprint_data_dir_env = os.getenv("FINGERPRINT_DATA_DIR", "").strip()
if fingerprint_data_dir_env:
    FINGERPRINT_DATA_DIR = Path(fingerprint_data_dir_env)
elif localfi_data_dir_env:
    FINGERPRINT_DATA_DIR = Path(localfi_data_dir_env) / "fingerprints"
else:
    FINGERPRINT_DATA_DIR = ROOT_DIR / "fingerprints"
FINGERPRINT_DATA_DIR.mkdir(parents=True, exist_ok=True)

# Embedding sidecars + k-NN graph for Smart Shuffle audio similarity (services/similarity/).
# Same defaulting shape as FINGERPRINT_DATA_DIR above.
similarity_data_dir_env = os.getenv("SIMILARITY_DATA_DIR", "").strip()
if similarity_data_dir_env:
    SIMILARITY_DATA_DIR = Path(similarity_data_dir_env)
elif localfi_data_dir_env:
    SIMILARITY_DATA_DIR = Path(localfi_data_dir_env) / "similarity"
else:
    SIMILARITY_DATA_DIR = ROOT_DIR / "similarity"
SIMILARITY_DATA_DIR.mkdir(parents=True, exist_ok=True)

# ONNX weights for the pretrained audio-embedding model (see scripts/export_similarity_model.py).
# Lives under weights/, not models/ -- that name is already taken by this backend's pydantic
# schemas package (models/schemas.py, models/fingerprint_schemas.py).
similarity_model_path_env = os.getenv("LOCALFI_SIMILARITY_MODEL_PATH", "").strip()
SIMILARITY_MODEL_PATH = Path(similarity_model_path_env) if similarity_model_path_env else (ROOT_DIR / "weights" / "cnn14.onnx")

# Temp stem-separation output for the AI DJ feature (services/stems/). Deliberately namespaced
# under "tmp" (not alongside FINGERPRINT_DATA_DIR/SIMILARITY_DATA_DIR above) -- AI DJ sessions are
# ephemeral by design, so this directory is swept on a TTL (services/cleanup.py) rather than kept
# as durable derived data. Same env-defaulting shape as the dirs above.
stems_data_dir_env = os.getenv("STEMS_DATA_DIR", "").strip()
if stems_data_dir_env:
    STEMS_DATA_DIR = Path(stems_data_dir_env)
elif localfi_data_dir_env:
    STEMS_DATA_DIR = Path(localfi_data_dir_env) / "tmp" / "stems"
else:
    STEMS_DATA_DIR = ROOT_DIR / "tmp" / "stems"
STEMS_DATA_DIR.mkdir(parents=True, exist_ok=True)

STEMS_MAX_CONCURRENT_JOBS = int(os.getenv("STEMS_MAX_CONCURRENT_JOBS", "1"))
# How long a session's separated stems are kept before the cleanup sweep deletes them.
STEMS_SESSION_TTL_HOURS = float(os.getenv("STEMS_SESSION_TTL_HOURS", "2"))
