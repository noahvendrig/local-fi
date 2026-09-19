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


class SimilarToSetRequest(BaseModel):
    # E.g. a crate's member tracks -- averaged into one centroid vector, then searched against
    # the whole index (minus exclude_ids). Unlike SimilarTrackRequest, there's no candidate_ids
    # option: this query is always "what fits this set, from anywhere in the library."
    track_ids: list[int] = Field(..., min_length=1)
    exclude_ids: list[int] = []
    top_k: int = Field(default=5, ge=1, le=50)


class WeightedHistoryTrack(BaseModel):
    # weight is an implicit-feedback strength (derived from play_count + recency decay on the
    # caller's side, e.g. local-fi's lib/db/tasteProfile.ts) -- this backend has no opinion on how
    # it was computed, it just uses it to weight this track's vote in score_weighted().
    track_id: int
    weight: float = Field(..., gt=0)


class TasteScoreRequest(BaseModel):
    # Personal-taste re-ranking (Vibe Radio): "of these candidate_ids, which best match a taste
    # profile built from the user's weighted play history" -- see SimilarityIndex.score_weighted.
    history: list[WeightedHistoryTrack] = Field(..., min_length=1)
    candidate_ids: list[int] = Field(..., min_length=1)


class TasteScore(BaseModel):
    track_id: int
    score: float  # weighted-nearest-neighbor affinity to the history set, in [-1, 1]


class TasteScoreResponse(BaseModel):
    scores: list[TasteScore]
