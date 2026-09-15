"""Filesystem layout + cleanup for AI DJ stem-separation output. Ephemeral by design -- the
feature has no persistence requirement (a session is live-only, never saved), so output lives
under STEMS_DATA_DIR and is swept on a TTL, the same treatment services/cleanup.py already gives
DOWNLOAD_DIR.
"""
from __future__ import annotations

import shutil
import time
from pathlib import Path

from config import STEMS_DATA_DIR, STEMS_SESSION_TTL_HOURS


def session_dir(session_id: str) -> Path:
    return STEMS_DATA_DIR / session_id


def track_stems_dir(session_id: str, track_id: int) -> Path:
    return session_dir(session_id) / str(track_id)


def cleanup_stale_stem_sessions() -> int:
    """Removes session directories whose newest file predates the TTL. Returns count removed."""
    if not STEMS_DATA_DIR.exists():
        return 0
    cutoff = time.time() - (STEMS_SESSION_TTL_HOURS * 3600)
    removed = 0
    for entry in STEMS_DATA_DIR.iterdir():
        if not entry.is_dir():
            continue
        try:
            newest = max((p.stat().st_mtime for p in entry.rglob("*") if p.is_file()), default=entry.stat().st_mtime)
            if newest < cutoff:
                shutil.rmtree(entry, ignore_errors=True)
                removed += 1
        except OSError:
            pass
    return removed
