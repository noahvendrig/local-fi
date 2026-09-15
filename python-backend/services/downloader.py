# yt-dlp wrapper with format selection and progress hooks
import re
import shutil
from pathlib import Path
from typing import Callable, Optional

import yt_dlp

from models.schemas import DownloadMode, Quality

# Map quality enum to max height
QUALITY_HEIGHT = {
    Quality.P720: 720,
    Quality.P1080: 1080,
    Quality.P1440: 1440,
    Quality.P2160: 2160,
}

YOUTUBE_URL_RE = re.compile(
    r"^(https?://)?(www\.)?(youtube\.com/(watch\?v=|shorts/)|youtu\.be/)[\w\-]+",
    re.IGNORECASE,
)

# Track links only (not artist pages or sets). Short links via on.soundcloud.com.
SOUNDCLOUD_URL_RE = re.compile(
    r"^(https?://)?((www\.|m\.)?soundcloud\.com/[\w\-]+/(?!sets(?:/|\?|#|$))[\w\-]+"
    r"|on\.soundcloud\.com/[\w\-]+)",
    re.IGNORECASE,
)


def is_supported_url(url: str) -> bool:
    # Check if url is a youtube watch/shorts or soundcloud track link
    cleaned = url.strip()
    return bool(YOUTUBE_URL_RE.match(cleaned) or SOUNDCLOUD_URL_RE.match(cleaned))


def build_format_string(mode: DownloadMode, quality: Quality) -> str:
    if mode == DownloadMode.AUDIO:
        return "bestaudio/best"
    height = QUALITY_HEIGHT[quality]
    # Last fallback covers audio-only hosts like SoundCloud
    return (
        f"bestvideo[height<={height}]+bestaudio/"
        f"best[height<={height}]/bestaudio/best"
    )


def check_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def strip_ansi(text: str) -> str:
    # Remove terminal color codes yt-dlp sometimes leaves in errors
    return re.sub(r"\x1b\[[0-9;]*m", "", text)


def friendly_error(exc: Exception) -> str:
    # Turn yt-dlp / system errors into short user-facing messages
    raw = strip_ansi(str(exc)).strip()
    msg = raw.lower()
    if "ffmpeg" in msg or "ffprobe" in msg:
        return "ffmpeg is not installed or not on PATH. Install ffmpeg to download video."
    if "drm" in msg:
        return (
            "This track is DRM-protected by SoundCloud/YouTube and cannot be downloaded."
        )
    if "private" in msg:
        return "This video is private and cannot be downloaded."
    if "age" in msg and "restrict" in msg:
        return "This video is age-restricted and cannot be downloaded."
    if "unavailable" in msg or "not available" in msg:
        return "This video is unavailable."
    if "timeout" in msg or "timed out" in msg:
        return "Network timeout while downloading. Please try again."
    if "sign in" in msg or "login" in msg:
        return "This video requires sign-in and cannot be downloaded."
    if "403" in msg or "forbidden" in msg:
        return (
            "YouTube blocked the download (HTTP 403). Update yt-dlp "
            '(pip install -U "yt-dlp[default]") and install Deno on PATH.'
        )
    if "javascript runtime" in msg or "js runtime" in msg:
        return (
            "No JavaScript runtime found. Install Deno and ensure it is on PATH "
            "(required for YouTube downloads)."
        )
    # Keep original message but shorten if huge
    if len(raw) > 200:
        return raw[:200] + "..."
    return raw or "Download failed."


def download_video(
    url: str,
    output_dir: Path,
    mode: DownloadMode,
    quality: Quality,
    on_progress: Optional[Callable[[dict], None]] = None,
    on_info: Optional[Callable[[dict], None]] = None,
) -> Path:
    # Download one url; returns path to the finished file
    if mode == DownloadMode.VIDEO and not check_ffmpeg():
        raise RuntimeError(
            "ffmpeg is not installed or not on PATH. Install ffmpeg to download video."
        )

    output_template = str(output_dir / "%(title).200B [%(id)s].%(ext)s")
    format_string = build_format_string(mode, quality)

    result_path: dict = {"path": None}

    def progress_hook(d: dict):
        if d.get("status") == "finished":
            # Prefer filepath from hook when present
            filepath = d.get("filename") or d.get("info_dict", {}).get("_filename")
            if filepath:
                result_path["path"] = Path(filepath)
        if on_progress:
            on_progress(d)

    ydl_opts = {
        "format": format_string,
        "outtmpl": output_template,
        "progress_hooks": [progress_hook],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "restrictfilenames": False,
        "windowsfilenames": True,
    }

    if mode == DownloadMode.AUDIO:
        ydl_opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ]
        if not check_ffmpeg():
            raise RuntimeError(
                "ffmpeg is not installed or not on PATH. Install ffmpeg to extract audio."
            )

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if on_info and info:
                on_info(
                    {
                        "title": info.get("title"),
                        "thumbnail": info.get("thumbnail"),
                        "id": info.get("id"),
                    }
                )
            info = ydl.extract_info(url, download=True)
            # After download, resolve final filename
            if info:
                prepared = ydl.prepare_filename(info)
                if mode == DownloadMode.AUDIO:
                    # Audio postprocessor changes extension to mp3
                    prepared = str(Path(prepared).with_suffix(".mp3"))
                result_path["path"] = Path(prepared)
    except yt_dlp.utils.DownloadError as e:
        raise RuntimeError(friendly_error(e)) from e
    except Exception as e:
        raise RuntimeError(friendly_error(e)) from e

    path = result_path["path"]
    if path is None or not Path(path).exists():
        # Fallback: look for newest file in output dir matching video id
        video_id = (info or {}).get("id") if info else None
        candidates = list(output_dir.glob(f"*[{video_id}]*")) if video_id else []
        if candidates:
            path = max(candidates, key=lambda p: p.stat().st_mtime)
        else:
            raise RuntimeError("Download finished but output file was not found.")

    return Path(path)


def format_speed(speed: Optional[float]) -> Optional[str]:
    if speed is None:
        return None
    if speed < 1024:
        return f"{speed:.0f} B/s"
    if speed < 1024 * 1024:
        return f"{speed / 1024:.1f} KB/s"
    return f"{speed / (1024 * 1024):.1f} MB/s"


def format_eta(seconds: Optional[float]) -> Optional[str]:
    if seconds is None:
        return None
    try:
        secs = int(seconds)
    except (TypeError, ValueError):
        return None
    if secs < 0:
        return None
    if secs < 60:
        return f"{secs}s"
    minutes, secs = divmod(secs, 60)
    if minutes < 60:
        return f"{minutes}m {secs}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes}m"
