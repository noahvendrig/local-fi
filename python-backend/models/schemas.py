# Pydantic models for request/response
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Quality(str, Enum):
    P720 = "720p"
    P1080 = "1080p"
    P1440 = "1440p"
    P2160 = "2160p"


class DownloadMode(str, Enum):
    VIDEO = "video"
    AUDIO = "audio"


class JobStatus(str, Enum):
    QUEUED = "queued"
    MATCHING = "matching"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobKind(str, Enum):
    # A direct YouTube/SoundCloud URL supplied by the caller.
    URL_DOWNLOAD = "url_download"
    # A {title, artist, duration} description the backend must find on
    # YouTube itself before downloading — used by callers like local-fi's
    # Spotify playlist import, which knows nothing about YouTube URLs.
    MATCH_DOWNLOAD = "match_download"


class CreateJobsRequest(BaseModel):
    urls: list[str] = Field(..., min_length=1)
    quality: Quality = Quality.P1080
    mode: DownloadMode = DownloadMode.VIDEO


class MatchItem(BaseModel):
    title: str
    artist: str
    duration_ms: Optional[int] = None
    # Absolute path on the shared local filesystem to save the downloaded
    # audio into — the caller (e.g. local-fi) owns file placement, this
    # backend just writes there.
    output_dir: str


class CreateMatchJobsRequest(BaseModel):
    items: list[MatchItem] = Field(..., min_length=1)


class JobResponse(BaseModel):
    id: str
    kind: JobKind = JobKind.URL_DOWNLOAD
    url: str
    quality: Quality
    mode: DownloadMode
    status: JobStatus
    title: Optional[str] = None
    thumbnail: Optional[str] = None
    percent: float = 0.0
    speed: Optional[str] = None
    eta: Optional[str] = None
    error: Optional[str] = None
    filename: Optional[str] = None
    filepath: Optional[str] = None
    # Only set for match_download jobs — the search inputs that produced `title`/`url`.
    track_title: Optional[str] = None
    artist: Optional[str] = None
    created_at: float


class CreateJobsResponse(BaseModel):
    jobs: list[JobResponse]


class JobListResponse(BaseModel):
    jobs: list[JobResponse]
