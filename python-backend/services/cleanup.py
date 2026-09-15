# Delete old download files after TTL
import time
from pathlib import Path

from config import DOWNLOAD_DIR, FILE_TTL_HOURS
from services.stems.storage import cleanup_stale_stem_sessions


def cleanup_old_files() -> int:
    # Remove files older than FILE_TTL_HOURS; returns count deleted
    if not DOWNLOAD_DIR.exists():
        return 0
    cutoff = time.time() - (FILE_TTL_HOURS * 3600)
    deleted = 0
    for path in DOWNLOAD_DIR.iterdir():
        if not path.is_file():
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
                deleted += 1
        except OSError:
            pass
    deleted += cleanup_stale_stem_sessions()
    return deleted
