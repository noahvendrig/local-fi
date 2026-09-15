# Pydantic models for the fingerprinting/mixtape-matching API. Kept separate
# from schemas.py (download-job shaped) since the job shapes genuinely differ:
# a track-fingerprint job processes many independent items, a mixtape-match
# job is one long-running task moving through sequential stages.
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class FingerprintJobKind(str, Enum):
    TRACK_BATCH = "track_batch"
    MIXTAPE_MATCH = "mixtape_match"


class FingerprintJobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    COMPLETED_WITH_ERRORS = "completed_with_errors"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TrackToFingerprint(BaseModel):
    track_id: int
    # Absolute path on the shared local filesystem -- local-fi (the caller)
    # owns file placement, this backend only ever reads from it.
    path: str


class CreateTrackFingerprintJobRequest(BaseModel):
    tracks: list[TrackToFingerprint] = Field(..., min_length=1)


class CreateMixtapeMatchJobRequest(BaseModel):
    mixtape_id: int
    path: str


class TrackFingerprintResult(BaseModel):
    track_id: int
    status: str  # "done" | "failed"
    landmark_count: Optional[int] = None
    error: Optional[str] = None


class MixtapeSegmentResult(BaseModel):
    track_id: int
    start_ms: float
    end_ms: float
    tempo_ratio: float
    source_start_ms: float
    confidence: float


class FingerprintJobResponse(BaseModel):
    id: str
    kind: FingerprintJobKind
    status: FingerprintJobStatus
    stage: Optional[str] = None  # mixtape_match only
    progress_pct: float = 0.0
    total_tracks: int = 0  # track_batch only
    processed_tracks: int = 0  # track_batch only
    failed_tracks: int = 0  # track_batch only
    track_results: list[TrackFingerprintResult] = []
    segments: list[MixtapeSegmentResult] = []  # mixtape_match only, once done
    error: Optional[str] = None
    created_at: float


class FingerprintJobListResponse(BaseModel):
    jobs: list[FingerprintJobResponse]
