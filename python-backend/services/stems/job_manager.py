"""In-memory job store + worker queue for AI DJ stem separation, mirroring
services/similarity/job_manager.py's Job dataclass + asyncio.Queue subscriber/SSE pattern. Kept
separate for the same reason SimilarityJobManager is separate from the generic
services/job_manager.py: this module owns model loading and stem-file placement, not because the
concurrency machinery itself differs. Concurrency defaults to 1 (STEMS_MAX_CONCURRENT_JOBS) since
Demucs is GPU-memory-bound -- most consumer GPUs can't usefully run two separation passes at once.
"""
from __future__ import annotations

import asyncio
import uuid
import time
from dataclasses import dataclass, field
from typing import Optional

from config import STEMS_MAX_CONCURRENT_JOBS
from models.stems_schemas import StemsJobResponse, StemsJobStatus

from .separator import get_device, separate_track
from .storage import track_stems_dir


@dataclass
class Job:
    id: str
    track_id: int
    session_id: str
    path: str
    status: StemsJobStatus = StemsJobStatus.QUEUED
    progress_pct: float = 0.0
    device: Optional[str] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    cancelled: bool = False
    vocals_path: Optional[str] = None
    instrumental_path: Optional[str] = None

    def to_response(self) -> StemsJobResponse:
        return StemsJobResponse(
            id=self.id,
            status=self.status,
            progress_pct=self.progress_pct,
            track_id=self.track_id,
            session_id=self.session_id,
            device=self.device,
            error=self.error,
            created_at=self.created_at,
        )


class StemsJobManager:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.subscribers: dict[str, list[asyncio.Queue]] = {}
        self.workers: list[asyncio.Task] = []
        self.running = False

    async def start(self):
        if self.running:
            return
        self.running = True
        for _ in range(max(1, STEMS_MAX_CONCURRENT_JOBS)):
            self.workers.append(asyncio.create_task(self.worker_loop()))

    async def stop(self):
        self.running = False
        for task in self.workers:
            task.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)
        self.workers.clear()

    def create_job(self, track_id: int, path: str, session_id: str) -> Job:
        job = Job(id=str(uuid.uuid4()), track_id=track_id, session_id=session_id, path=path)
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
        if job.status == StemsJobStatus.QUEUED:
            job.status = StemsJobStatus.CANCELLED
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
        job.status = StemsJobStatus.RUNNING
        job.device = get_device()
        self.notify(job)

        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, self._run_separation, job)
        except Exception as e:
            job.status = StemsJobStatus.FAILED
            job.error = str(e)

        if job.status == StemsJobStatus.RUNNING:
            job.status = StemsJobStatus.COMPLETED
            job.progress_pct = 100.0
        self.notify(job)

    # -- blocking work, run in a thread via run_in_executor -----------------

    def _run_separation(self, job: Job) -> None:
        out_dir = track_stems_dir(job.session_id, job.track_id)
        stems = separate_track(job.path, out_dir)
        job.vocals_path = str(stems["vocals"])
        job.instrumental_path = str(stems["instrumental"])


# Singleton used by the app, same convention as services/similarity/job_manager.py's
# `similarity_job_manager`.
stems_job_manager = StemsJobManager()
