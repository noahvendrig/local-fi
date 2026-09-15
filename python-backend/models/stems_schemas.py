# Pydantic models for the AI DJ stem-separation API. One job = one track's vocals/instrumental
# split (see services/stems/job_manager.py) -- unlike similarity_schemas.py's batch jobs, stems
# jobs are always single-track since they're requested one "next track" at a time during a live
# AI DJ session.
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class StemsJobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CreateStemsJobRequest(BaseModel):
    track_id: int
    # Absolute path on the shared local filesystem -- local-fi (the caller) owns file placement,
    # this backend only ever reads from it. Same convention as similarity_schemas.TrackToAnalyze.
    path: str
    # Namespaces this job's output directory (services/stems/storage.py) so concurrent AI DJ
    # sessions -- or the same session re-requesting a track -- never collide on disk.
    session_id: str = Field(..., min_length=1)


class StemsJobResponse(BaseModel):
    id: str
    status: StemsJobStatus
    progress_pct: float = 0.0
    track_id: int
    session_id: str
    device: Optional[str] = None
    error: Optional[str] = None
    created_at: float


class DeviceInfoResponse(BaseModel):
    available: bool
    device: str  # "cuda" | "cpu"
    cuda_device_name: Optional[str] = None
