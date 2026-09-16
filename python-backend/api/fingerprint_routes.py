# REST and SSE API routes for track fingerprinting and mixtape matching.
# Mirrors api/routes.py's job-resource shape (create -> id, GET for polling,
# GET .../stream for SSE, DELETE to cancel).
import asyncio
import json

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse

from models.fingerprint_schemas import (
    CreateMixtapeMatchJobRequest,
    CreateTrackFingerprintJobRequest,
    FingerprintJobListResponse,
    FingerprintJobResponse,
    FingerprintJobStatus,
)
from services.fingerprint.job_manager import fingerprint_job_manager

router = APIRouter(prefix="/api/fingerprint")

TERMINAL_STATUSES = {
    FingerprintJobStatus.COMPLETED,
    FingerprintJobStatus.COMPLETED_WITH_ERRORS,
    FingerprintJobStatus.FAILED,
    FingerprintJobStatus.CANCELLED,
}


@router.post("/tracks", response_model=FingerprintJobResponse)
async def fingerprint_tracks(body: CreateTrackFingerprintJobRequest):
    job = fingerprint_job_manager.create_track_batch_job(body.tracks)
    return job.to_response()


@router.post("/mixtapes", response_model=FingerprintJobResponse)
async def match_mixtape(body: CreateMixtapeMatchJobRequest):
    job = fingerprint_job_manager.create_mixtape_match_job(body.path)
    return job.to_response()


@router.delete("/tracks/{track_id}", status_code=204)
async def forget_track(track_id: int):
    """Drops a purged track's fingerprint so mixtape matching stops returning an id whose
    library row is gone. Idempotent -- forgetting an unknown track is a no-op, not a 404."""
    fingerprint_job_manager.index.remove_track(track_id)
    return Response(status_code=204)


@router.get("/jobs", response_model=FingerprintJobListResponse)
async def list_jobs():
    jobs = sorted(fingerprint_job_manager.jobs.values(), key=lambda j: j.created_at, reverse=True)
    return FingerprintJobListResponse(jobs=[j.to_response() for j in jobs])


@router.get("/jobs/{job_id}", response_model=FingerprintJobResponse)
async def get_job(job_id: str):
    job = fingerprint_job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.to_response()


@router.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    job = fingerprint_job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    queue = fingerprint_job_manager.subscribe(job_id)

    async def event_generator():
        try:
            yield f"data: {json.dumps(job.to_response().model_dump(mode='json'))}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    current = fingerprint_job_manager.get_job(job_id)
                    if not current:
                        break
                    if current.status in TERMINAL_STATUSES:
                        yield f"data: {json.dumps(current.to_response().model_dump(mode='json'))}\n\n"
                        break
                    continue

                yield f"data: {json.dumps(payload)}\n\n"
                if payload.get("status") in {s.value for s in TERMINAL_STATUSES}:
                    break
        finally:
            fingerprint_job_manager.unsubscribe(job_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/jobs/{job_id}", response_model=FingerprintJobResponse)
async def cancel_job(job_id: str):
    job = fingerprint_job_manager.cancel(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.to_response()
