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
