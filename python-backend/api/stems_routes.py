"""REST and SSE API routes for AI DJ stem separation. Mirrors api/similarity_routes.py's
job-resource shape (create -> id, GET for polling, GET .../stream for SSE, DELETE to cancel) plus
two endpoints unique to this feature: serving the separated stem audio bytes, and reporting GPU
availability for the AI DJ view's device indicator.
"""
import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from models.stems_schemas import (
    CreateStemsJobRequest,
    DeviceInfoResponse,
    StemsJobResponse,
    StemsJobStatus,
)
from services.stems.job_manager import stems_job_manager
from services.stems.separator import get_device_info

router = APIRouter(prefix="/api/stems")

TERMINAL_STATUSES = {StemsJobStatus.COMPLETED, StemsJobStatus.FAILED, StemsJobStatus.CANCELLED}


@router.post("/jobs", response_model=StemsJobResponse)
async def create_job(body: CreateStemsJobRequest):
    job = stems_job_manager.create_job(body.track_id, body.path, body.session_id)
    return job.to_response()


@router.get("/jobs/{job_id}", response_model=StemsJobResponse)
async def get_job(job_id: str):
    job = stems_job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.to_response()


@router.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    job = stems_job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    queue = stems_job_manager.subscribe(job_id)

    async def event_generator():
        try:
            yield f"data: {json.dumps(job.to_response().model_dump(mode='json'))}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    current = stems_job_manager.get_job(job_id)
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
            stems_job_manager.unsubscribe(job_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/jobs/{job_id}", response_model=StemsJobResponse)
async def cancel_job(job_id: str):
    job = stems_job_manager.cancel(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.to_response()


@router.get("/jobs/{job_id}/audio/{stem}")
async def get_stem_audio(job_id: str, stem: str):
    job = stems_job_manager.get_job(job_id)
    if not job or job.status != StemsJobStatus.COMPLETED:
        raise HTTPException(status_code=404, detail="Stem not available.")
    path = {"vocals": job.vocals_path, "instrumental": job.instrumental_path}.get(stem)
    if not path:
        raise HTTPException(status_code=404, detail="Unknown stem.")
    return FileResponse(path, media_type="audio/wav")


@router.get("/device", response_model=DeviceInfoResponse)
async def device_info():
    return DeviceInfoResponse(**get_device_info())
