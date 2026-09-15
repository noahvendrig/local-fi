# REST and SSE API routes
import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from models.schemas import (
    CreateJobsRequest,
    CreateJobsResponse,
    CreateMatchJobsRequest,
    JobListResponse,
    JobResponse,
    JobStatus,
)
from services.job_manager import job_manager

router = APIRouter(prefix="/api")


@router.post("/jobs", response_model=CreateJobsResponse)
async def create_jobs(body: CreateJobsRequest):
    # Create one job per URL
    jobs = job_manager.create_jobs(body.urls, body.quality, body.mode)
    if not jobs:
        raise HTTPException(status_code=400, detail="No valid URLs provided.")
    return CreateJobsResponse(jobs=[j.to_response() for j in jobs])


@router.post("/jobs/match", response_model=CreateJobsResponse)
async def create_match_jobs(body: CreateMatchJobsRequest):
    # Create one job per {title, artist, duration} item — the caller doesn't
    # supply a YouTube URL, the backend has to find one itself.
    jobs = job_manager.create_match_jobs(body.items)
    if not jobs:
        raise HTTPException(status_code=400, detail="No items provided.")
    return CreateJobsResponse(jobs=[j.to_response() for j in jobs])


@router.get("/jobs", response_model=JobListResponse)
async def list_jobs():
    jobs = job_manager.list_jobs()
    return JobListResponse(jobs=[j.to_response() for j in jobs])


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.to_response()


@router.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    queue = job_manager.subscribe(job_id)

    async def event_generator():
        try:
            # Send current state first
            yield f"data: {json.dumps(job.to_response().model_dump(mode='json'))}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    # Keepalive comment so proxies don't close the connection
                    yield ": keepalive\n\n"
                    current = job_manager.get_job(job_id)
                    if not current:
                        break
                    if current.status in (
                        JobStatus.COMPLETED,
                        JobStatus.FAILED,
                        JobStatus.CANCELLED,
                    ):
                        yield f"data: {json.dumps(current.to_response().model_dump(mode='json'))}\n\n"
                        break
                    continue

                yield f"data: {json.dumps(payload)}\n\n"
                status = payload.get("status")
                if status in (
                    JobStatus.COMPLETED.value,
                    JobStatus.FAILED.value,
                    JobStatus.CANCELLED.value,
                ):
                    break
        finally:
            job_manager.unsubscribe(job_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/jobs/{job_id}/file")
async def download_file(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status != JobStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Job is not completed yet.")
    if not job.filepath or not Path(job.filepath).exists():
        raise HTTPException(status_code=404, detail="File not found on server.")

    media_type = "application/octet-stream"
    name = job.filename or Path(job.filepath).name
    if name.lower().endswith(".mp3"):
        media_type = "audio/mpeg"
    elif name.lower().endswith(".opus"):
        media_type = "audio/ogg"
    elif name.lower().endswith(".mp4"):
        media_type = "video/mp4"
    elif name.lower().endswith(".webm"):
        media_type = "video/webm"
    elif name.lower().endswith(".mkv"):
        media_type = "video/x-matroska"

    return FileResponse(
        path=str(job.filepath),
        media_type=media_type,
        filename=name,
    )


@router.delete("/jobs/{job_id}", response_model=JobResponse)
async def delete_job(job_id: str):
    job = job_manager.cancel_or_remove(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.to_response()
