"""In-memory job store + worker queue for audio-similarity embedding extraction, mirroring
services/fingerprint/job_manager.py's Job dataclass + asyncio.Queue subscriber/SSE pattern
(same notify/subscribe/unsubscribe shape). Kept as a separate class for the same reason
FingerprintJobManager is separate from services/job_manager.py's generic one: this module owns
its own index (SimilarityIndex) and its own per-track processing step, not because the
concurrency machinery itself needs to differ.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from models.similarity_schemas import (
    SimilarityJobResponse,
    SimilarityJobStatus,
    TrackSimilarityResult,
    TrackToAnalyze,
)

from config import SIMILARITY_DATA_DIR

from ..fingerprint.decode import decode_mono_pcm
from .embedding import SAMPLE_RATE, extract_embedding
from .index import SimilarityIndex

MAX_CONCURRENT_JOBS = int(os.getenv("SIMILARITY_MAX_CONCURRENT_JOBS", "1"))


@dataclass
class Job:
    id: str
    tracks: list[TrackToAnalyze] = field(default_factory=list)
    status: SimilarityJobStatus = SimilarityJobStatus.QUEUED
    progress_pct: float = 0.0
    total_tracks: int = 0
    processed_tracks: int = 0
    failed_tracks: int = 0
    track_results: list[TrackSimilarityResult] = field(default_factory=list)
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    cancelled: bool = False

    def to_response(self) -> SimilarityJobResponse:
        return SimilarityJobResponse(
            id=self.id,
            status=self.status,
            progress_pct=self.progress_pct,
            total_tracks=self.total_tracks,
            processed_tracks=self.processed_tracks,
            failed_tracks=self.failed_tracks,
            track_results=self.track_results,
            error=self.error,
            created_at=self.created_at,
        )


class SimilarityJobManager:
    def __init__(self, index: SimilarityIndex):
        self.index = index
        self.jobs: dict[str, Job] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.subscribers: dict[str, list[asyncio.Queue]] = {}
        self.workers: list[asyncio.Task] = []
        self.running = False

    async def start(self):
        if self.running:
            return
        self.running = True
        for _ in range(max(1, MAX_CONCURRENT_JOBS)):
            self.workers.append(asyncio.create_task(self.worker_loop()))

    async def stop(self):
        self.running = False
        for task in self.workers:
            task.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)
        self.workers.clear()

    def create_track_batch_job(self, tracks: list[TrackToAnalyze]) -> Job:
        job = Job(id=str(uuid.uuid4()), tracks=tracks, total_tracks=len(tracks))
        self.jobs[job.id] = job
        self.queue.put_nowait(job.id)
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        return self.jobs.get(job_id)

    def cancel(self, job_id: str) -> Optional[Job]:
        job = self.jobs.get(job_id)
        if not job:
            return None
        job.cancelled = True
        if job.status == SimilarityJobStatus.QUEUED:
            job.status = SimilarityJobStatus.CANCELLED
            self.notify(job)
        return job

    def subscribe(self, job_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        self.subscribers.setdefault(job_id, []).append(q)
        job = self.jobs.get(job_id)
        if job:
            try:
                q.put_nowait(job.to_response().model_dump(mode="json"))
            except asyncio.QueueFull:
                pass
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue):
        subs = self.subscribers.get(job_id, [])
        if q in subs:
            subs.remove(q)
        if not subs and job_id in self.subscribers:
            del self.subscribers[job_id]

    def notify(self, job: Job):
        payload = job.to_response().model_dump(mode="json")
        for q in list(self.subscribers.get(job.id, [])):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    async def worker_loop(self):
        while self.running:
            try:
                job_id = await asyncio.wait_for(self.queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            job = self.jobs.get(job_id)
            if not job or job.cancelled:
                continue

            await self.run_job(job)

    async def run_job(self, job: Job):
        job.status = SimilarityJobStatus.RUNNING
        self.notify(job)

        loop = asyncio.get_event_loop()

        def notify_threadsafe():
            loop.call_soon_threadsafe(self.notify, job)

        try:
            await loop.run_in_executor(None, self._run_track_batch, job, notify_threadsafe)
        except Exception as e:
            job.status = SimilarityJobStatus.FAILED
            job.error = str(e)

        if job.status == SimilarityJobStatus.RUNNING:
            job.status = (
                SimilarityJobStatus.COMPLETED_WITH_ERRORS if job.failed_tracks else SimilarityJobStatus.COMPLETED
            )
        self.notify(job)

    # -- blocking work, run in a thread via run_in_executor -----------------

    def _run_track_batch(self, job: Job, notify_threadsafe) -> None:
        for t in job.tracks:
            if job.cancelled:
                job.status = SimilarityJobStatus.CANCELLED
                return
            try:
                pcm = decode_mono_pcm(t.path, sample_rate=SAMPLE_RATE)
                vector = extract_embedding(pcm)
                self.index.add_track(t.track_id, vector)
                job.track_results.append(TrackSimilarityResult(track_id=t.track_id, status="done"))
            except Exception as e:
                job.failed_tracks += 1
                job.track_results.append(TrackSimilarityResult(track_id=t.track_id, status="failed", error=str(e)))
            job.processed_tracks += 1
            job.progress_pct = round(job.processed_tracks / max(1, job.total_tracks) * 100, 1)
            notify_threadsafe()

        # A multi-track batch (initial scan / manual backfill) refreshes older tracks' neighbor
        # lists too, since a bunch of new vectors just landed; a single fire-and-forget
        # auto-import (len==1, the common per-track case) skips this and relies on add_track's
        # own per-insert neighbor computation for that one track -- see SimilarityIndex.add_track's
        # docstring for why a full rebuild on every single import doesn't scale.
        if len(job.tracks) > 1:
            self.index.rebuild_graph()
        self.index.checkpoint()


# Singleton used by the app, same convention as services/fingerprint/job_manager.py's
# `fingerprint_job_manager`.
similarity_job_manager = SimilarityJobManager(SimilarityIndex(SIMILARITY_DATA_DIR))
