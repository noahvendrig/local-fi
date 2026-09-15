# Scores YouTube search results against a {title, artist, duration} description
# and picks the best candidate, instead of blindly taking the first result.
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Optional

import yt_dlp

SEARCH_COUNT = 5
# Candidates whose duration differs from the target by more than this are
# penalized heavily (but not excluded outright — a great title/channel match
# with a slightly-off duration, e.g. a different fade-out, can still win).
MAX_DURATION_DELTA_SECONDS = 12
MIN_SCORE = 0.35


@dataclass
class MatchResult:
    video_id: str
    url: str
    title: str
    channel: Optional[str]
    duration_seconds: Optional[float]
    score: float


def _normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"\(.*?\)|\[.*?\]", " ", text)  # drop "(Official Video)" etc.
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return text.strip()


def _title_score(candidate_title: str, track_title: str, artist: str) -> float:
    query = _normalize(f"{artist} {track_title}")
    candidate = _normalize(candidate_title)
    return SequenceMatcher(None, query, candidate).ratio()


def _channel_bonus(channel: Optional[str], artist: str) -> float:
    if not channel:
        return 0.0
    normalized_channel = _normalize(channel)
    normalized_artist = _normalize(artist)
    if normalized_artist and normalized_artist in normalized_channel:
        return 0.15
    if normalized_channel.endswith("topic") or "official" in normalized_channel:
        return 0.1
    return 0.0


def _duration_score(candidate_seconds: Optional[float], target_seconds: Optional[float]) -> float:
    if candidate_seconds is None or target_seconds is None:
        return 0.0
    delta = abs(candidate_seconds - target_seconds)
    if delta > MAX_DURATION_DELTA_SECONDS:
        return -0.4
    return 0.25 * (1 - delta / MAX_DURATION_DELTA_SECONDS)


def find_best_match(title: str, artist: str, duration_ms: Optional[int]) -> Optional[MatchResult]:
    """Searches YouTube for `<artist> - <title>` and returns the best-scoring
    candidate, or None if nothing clears MIN_SCORE. Uses yt-dlp's own search
    extractor (already a dependency) rather than a separate search library,
    so there's one less unmaintained dependency to break."""
    query = f"ytsearch{SEARCH_COUNT}:{artist} - {title}"
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(query, download=False)

    entries = (info or {}).get("entries") or []
    if not entries:
        return None

    target_seconds = duration_ms / 1000 if duration_ms is not None else None
    best: Optional[MatchResult] = None

    for entry in entries:
        if not entry:
            continue
        video_id = entry.get("id")
        if not video_id:
            continue

        candidate_title = entry.get("title") or ""
        channel = entry.get("channel") or entry.get("uploader")
        duration = entry.get("duration")

        score = _title_score(candidate_title, title, artist)
        score += _channel_bonus(channel, artist)
        score += _duration_score(duration, target_seconds)

        candidate = MatchResult(
            video_id=video_id,
            url=f"https://www.youtube.com/watch?v={video_id}",
            title=candidate_title,
            channel=channel,
            duration_seconds=duration,
            score=score,
        )

        if best is None or candidate.score > best.score:
            best = candidate

    if best is None or best.score < MIN_SCORE:
        return None
    return best
