# REST and SSE API routes for Smart Shuffle audio-similarity analysis and querying. Mirrors
# api/fingerprint_routes.py's job-resource shape (create -> id, GET for polling, GET .../stream
# for SSE, DELETE to cancel) for the batch-analysis endpoints, plus one query-shaped endpoint
# (/similar) with no fingerprinting equivalent.
import asyncio
import json

from fastapi import APIRouter, HTTPException

from fastapi.responses import StreamingResponse

from models.similarity_schemas import (
    CreateSimilarityJobRequest,
    SimilarityJobListResponse,
    SimilarityJobResponse,
    SimilarityJobStatus,
    SimilarToSetRequest,
    SimilarTrackMatch,
    SimilarTrackRequest,
    SimilarTrackResponse,
    TasteScore,
    TasteScoreRequest,
    TasteScoreResponse,
)
from services.similarity.job_manager import similarity_job_manager

router = APIRouter(prefix="/api/similarity")

TERMINAL_STATUSES = {
    SimilarityJobStatus.COMPLETED,
    SimilarityJobStatus.COMPLETED_WITH_ERRORS,
    SimilarityJobStatus.FAILED,
    SimilarityJobStatus.CANCELLED,
}


@router.post("/tracks", response_model=SimilarityJobResponse)
async def analyze_tracks(body: CreateSimilarityJobRequest):
    job = similarity_job_manager.create_track_batch_job(body.tracks)
    return job.to_response()


@router.get("/jobs", response_model=SimilarityJobListResponse)
async def list_jobs():
    jobs = sorted(similarity_job_manager.jobs.values(), key=lambda j: j.created_at, reverse=True)
    return SimilarityJobListResponse(jobs=[j.to_response() for j in jobs])


@router.get("/jobs/{job_id}", response_model=SimilarityJobResponse)
async def get_job(job_id: str):
    job = similarity_job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.to_response()


@router.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    job = similarity_job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    queue = similarity_job_manager.subscribe(job_id)

    async def event_generator():
        try:
            yield f"data: {json.dumps(job.to_response().model_dump(mode='json'))}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    current = similarity_job_manager.get_job(job_id)
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
            similarity_job_manager.unsubscribe(job_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/jobs/{job_id}", response_model=SimilarityJobResponse)
async def cancel_job(job_id: str):
    job = similarity_job_manager.cancel(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.to_response()


@router.post("/similar", response_model=SimilarTrackResponse)
async def similar_tracks(body: SimilarTrackRequest):
    if not similarity_job_manager.index.has_track(body.track_id):
        raise HTTPException(status_code=404, detail="Track has not been analyzed yet.")
    matches = similarity_job_manager.index.similar(
        body.track_id, body.candidate_ids, set(body.exclude_ids), body.top_k
    )
    return SimilarTrackResponse(matches=[SimilarTrackMatch(track_id=tid, score=score) for tid, score in matches])


@router.post("/similar-to-set", response_model=SimilarTrackResponse)
async def similar_to_set(body: SimilarToSetRequest):
    matches = similarity_job_manager.index.similar_to_set(body.track_ids, set(body.exclude_ids), body.top_k)
    return SimilarTrackResponse(matches=[SimilarTrackMatch(track_id=tid, score=score) for tid, score in matches])


@router.post("/taste-score", response_model=TasteScoreResponse)
async def taste_score(body: TasteScoreRequest):
    scores = similarity_job_manager.index.score_weighted(
        [(h.track_id, h.weight) for h in body.history], body.candidate_ids
    )
    return TasteScoreResponse(scores=[TasteScore(track_id=tid, score=score) for tid, score in scores])
