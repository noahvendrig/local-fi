"""In-memory job store + worker queue for fingerprinting/matching work,
mirroring services/job_manager.py's Job dataclass + asyncio.Queue
subscriber/SSE pattern (same notify/subscribe/unsubscribe shape) -- kept as
a separate class because the job payload shape genuinely differs (stage +
percentage for a mixtape match, vs per-track batch results for fingerprinting),
not because the concurrency machinery needs to be different.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from models.fingerprint_schemas import (
    FingerprintJobKind,
    FingerprintJobResponse,
    FingerprintJobStatus,
    MixtapeSegmentResult,
    TrackFingerprintResult,
    TrackToFingerprint,
)

from config import FINGERPRINT_DATA_DIR

from .decode import decode_mono_pcm
from .index import FingerprintIndex
from .landmarks import extract_landmarks
from .matching import match_query

MAX_CONCURRENT_JOBS = int(os.getenv("FINGERPRINT_MAX_CONCURRENT_JOBS", "1"))
# Minimum confidence for a stage-B match to be surfaced as a mixtape segment
# at all -- below this it's not worth showing the user even as a low-confidence
# guess. matching.py's MatchResult.confidence is a log-scaled vote
# concentration relative to a calibrated noise floor (see CONCENTRATION_FLOOR
# there); 0.1 corresponds to roughly 300 (just above that noise floor), so
# this deliberately still surfaces weak/low-confidence guesses rather than
# only near-certain ones.
MIN_SEGMENT_CONFIDENCE = 0.1


@dataclass
class Job:
    id: str
    kind: FingerprintJobKind
    status: FingerprintJobStatus = FingerprintJobStatus.QUEUED
    stage: Optional[str] = None
    progress_pct: float = 0.0
    tracks: list[TrackToFingerprint] = field(default_factory=list)
    mixtape_path: Optional[str] = None
    total_tracks: int = 0
    processed_tracks: int = 0
    failed_tracks: int = 0
    track_results: list[TrackFingerprintResult] = field(default_factory=list)
    segments: list[MixtapeSegmentResult] = field(default_factory=list)
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    cancelled: bool = False

    def to_response(self) -> FingerprintJobResponse:
        return FingerprintJobResponse(
            id=self.id,
            kind=self.kind,
            status=self.status,
            stage=self.stage,
            progress_pct=self.progress_pct,
            total_tracks=self.total_tracks,
            processed_tracks=self.processed_tracks,
            failed_tracks=self.failed_tracks,
            track_results=self.track_results,
            segments=self.segments,
            error=self.error,
            created_at=self.created_at,
        )


class FingerprintJobManager:
    def __init__(self, index: FingerprintIndex):
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

    def create_track_batch_job(self, tracks: list[TrackToFingerprint]) -> Job:
        job = Job(
            id=str(uuid.uuid4()),
            kind=FingerprintJobKind.TRACK_BATCH,
            tracks=tracks,
            total_tracks=len(tracks),
        )
        self.jobs[job.id] = job
        self.queue.put_nowait(job.id)
        return job

    def create_mixtape_match_job(self, mixtape_path: str) -> Job:
        job = Job(
            id=str(uuid.uuid4()),
            kind=FingerprintJobKind.MIXTAPE_MATCH,
            mixtape_path=mixtape_path,
            stage="decoding",
        )
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
        if job.status == FingerprintJobStatus.QUEUED:
            job.status = FingerprintJobStatus.CANCELLED
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
        job.status = FingerprintJobStatus.RUNNING
        self.notify(job)

        loop = asyncio.get_event_loop()

        def notify_threadsafe():
            loop.call_soon_threadsafe(self.notify, job)

        try:
            if job.kind == FingerprintJobKind.TRACK_BATCH:
                await loop.run_in_executor(None, self._run_track_batch, job, notify_threadsafe)
            else:
                await loop.run_in_executor(None, self._run_mixtape_match, job, notify_threadsafe)
        except Exception as e:
            job.status = FingerprintJobStatus.FAILED
            job.error = str(e)

        if job.status == FingerprintJobStatus.RUNNING:
            job.status = (
                FingerprintJobStatus.COMPLETED_WITH_ERRORS if job.failed_tracks else FingerprintJobStatus.COMPLETED
            )
        self.notify(job)

    # -- blocking work, run in a thread via run_in_executor -----------------

    def _run_track_batch(self, job: Job, notify_threadsafe) -> None:
        for t in job.tracks:
            if job.cancelled:
                job.status = FingerprintJobStatus.CANCELLED
                return
            try:
                pcm = decode_mono_pcm(t.path)
                landmarks = extract_landmarks(pcm)
                self.index.add_track(t.track_id, landmarks)
                job.track_results.append(
                    TrackFingerprintResult(track_id=t.track_id, status="done", landmark_count=len(landmarks))
                )
            except Exception as e:
                job.failed_tracks += 1
                job.track_results.append(TrackFingerprintResult(track_id=t.track_id, status="failed", error=str(e)))
            job.processed_tracks += 1
            job.progress_pct = round(job.processed_tracks / max(1, job.total_tracks) * 100, 1)
            notify_threadsafe()
        # One checkpoint at the end of the batch, not per-track -- see
        # FingerprintIndex.add_track's docstring for why.
        self.index.checkpoint()

    def _run_mixtape_match(self, job: Job, notify_threadsafe) -> None:
        job.stage = "decoding"
        notify_threadsafe()
        pcm = decode_mono_pcm(job.mixtape_path)
        if job.cancelled:
            job.status = FingerprintJobStatus.CANCELLED
            return

        job.stage = "fingerprinting"
        notify_threadsafe()
        query_landmarks = extract_landmarks(pcm)
        if job.cancelled:
            job.status = FingerprintJobStatus.CANCELLED
            return

        job.stage = "matching"
        notify_threadsafe()
        results = match_query(query_landmarks, self.index.snapshot())

        job.segments = [
            MixtapeSegmentResult(
                track_id=r.track_id,
                start_ms=r.start_ms,
                end_ms=r.end_ms,
                tempo_ratio=r.tempo_ratio,
                source_start_ms=r.source_start_ms,
                confidence=r.confidence,
            )
            for r in results
            if r.confidence >= MIN_SEGMENT_CONFIDENCE
        ]
        job.stage = "done"
        job.progress_pct = 100.0


# Singleton used by the app, same convention as services/job_manager.py's `job_manager`.
fingerprint_job_manager = FingerprintJobManager(FingerprintIndex(FINGERPRINT_DATA_DIR))
