# Pydantic models for the Smart Shuffle audio-similarity API. Kept separate from
# fingerprint_schemas.py -- similarity jobs are shaped like fingerprinting's TRACK_BATCH kind
# (many independent per-track items), but this feature also has a query-shaped endpoint
# (/similar) with no fingerprinting equivalent, so it gets its own small schema module rather
# than growing fingerprint_schemas.py to cover an unrelated concern.
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class SimilarityJobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    COMPLETED_WITH_ERRORS = "completed_with_errors"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TrackToAnalyze(BaseModel):
    track_id: int
    # Absolute path on the shared local filesystem -- local-fi (the caller) owns file
    # placement, this backend only ever reads from it.
    path: str


class CreateSimilarityJobRequest(BaseModel):
    tracks: list[TrackToAnalyze] = Field(..., min_length=1)


class TrackSimilarityResult(BaseModel):
    track_id: int
    status: str  # "done" | "failed"
    error: Optional[str] = None


class SimilarityJobResponse(BaseModel):
    id: str
    status: SimilarityJobStatus
    progress_pct: float = 0.0
    total_tracks: int = 0
    processed_tracks: int = 0
    failed_tracks: int = 0
    track_results: list[TrackSimilarityResult] = []
    error: Optional[str] = None
    created_at: float


class SimilarityJobListResponse(BaseModel):
    jobs: list[SimilarityJobResponse]


class SimilarTrackRequest(BaseModel):
    track_id: int
    # Given: live brute-force query restricted to these ids (crate-scoped). Omitted: served from
    # the precomputed whole-library k-NN graph instead of a fresh search.
    candidate_ids: Optional[list[int]] = None
    exclude_ids: list[int] = []
    top_k: int = Field(default=1, ge=1, le=50)


class SimilarTrackMatch(BaseModel):
    track_id: int
    score: float  # cosine similarity of L2-normalized embeddings, in [-1, 1]


class SimilarTrackResponse(BaseModel):
    matches: list[SimilarTrackMatch]
