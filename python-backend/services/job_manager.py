# In-memory job store and download queue
import asyncio
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from config import DOWNLOAD_DIR, MAX_CONCURRENT_JOBS
from models.schemas import (
    DownloadMode,
    JobKind,
    JobResponse,
    JobStatus,
    MatchItem,
    Quality,
)
from services.downloader import (
    download_video,
    format_eta,
    format_speed,
    is_supported_url,
)
from services.youtube_match import find_best_match


@dataclass
class Job:
    id: str
    url: str
    quality: Quality
    mode: DownloadMode
    kind: JobKind = JobKind.URL_DOWNLOAD
    status: JobStatus = JobStatus.QUEUED
    title: Optional[str] = None
    thumbnail: Optional[str] = None
    percent: float = 0.0
    speed: Optional[str] = None
    eta: Optional[str] = None
    error: Optional[str] = None
    filename: Optional[str] = None
    filepath: Optional[Path] = None
    created_at: float = field(default_factory=time.time)
    cancelled: bool = False
    # match_download only:
    track_title: Optional[str] = None
    artist: Optional[str] = None
    duration_ms: Optional[int] = None
    output_dir: Optional[Path] = None

    def to_response(self) -> JobResponse:
        return JobResponse(
            id=self.id,
            kind=self.kind,
            url=self.url,
            quality=self.quality,
            mode=self.mode,
            status=self.status,
            title=self.title,
            thumbnail=self.thumbnail,
            percent=self.percent,
            speed=self.speed,
            eta=self.eta,
            error=self.error,
            filename=self.filename,
            filepath=str(self.filepath) if self.filepath else None,
            track_title=self.track_title,
            artist=self.artist,
            created_at=self.created_at,
        )


class JobManager:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.subscribers: dict[str, list[asyncio.Queue]] = {}
        self.workers: list[asyncio.Task] = []
        self.running = False
        self.lock = asyncio.Lock()

    async def start(self):
        if self.running:
            return
        self.running = True
        for _ in range(max(1, MAX_CONCURRENT_JOBS)):
            task = asyncio.create_task(self.worker_loop())
            self.workers.append(task)

    async def stop(self):
        self.running = False
        for task in self.workers:
            task.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)
        self.workers.clear()

    def create_jobs(
        self, urls: list[str], quality: Quality, mode: DownloadMode
    ) -> list[Job]:
        created: list[Job] = []
        for raw in urls:
            url = raw.strip()
            if not url:
                continue
            if not is_supported_url(url):
                # Still create a failed job so UI can show the error
                job = Job(
                    id=str(uuid.uuid4()),
                    url=url,
                    quality=quality,
                    mode=mode,
                    status=JobStatus.FAILED,
                    error="Invalid URL. Use a YouTube watch/Shorts or SoundCloud track link.",
                )
                self.jobs[job.id] = job
                created.append(job)
                continue

            job = Job(
                id=str(uuid.uuid4()),
                url=url,
                quality=quality,
                mode=mode,
            )
            self.jobs[job.id] = job
            self.queue.put_nowait(job.id)
            created.append(job)
        return created

    def create_match_jobs(self, items: list[MatchItem]) -> list[Job]:
        created: list[Job] = []
        for item in items:
            output_dir = Path(item.output_dir)
            try:
                output_dir.mkdir(parents=True, exist_ok=True)
            except OSError as e:
                job = Job(
                    id=str(uuid.uuid4()),
                    url="",
                    quality=Quality.P1080,
                    mode=DownloadMode.AUDIO,
                    kind=JobKind.MATCH_DOWNLOAD,
                    status=JobStatus.FAILED,
                    error=f"Could not create output directory: {e}",
                    track_title=item.title,
                    artist=item.artist,
                )
                self.jobs[job.id] = job
                created.append(job)
                continue

            job = Job(
                id=str(uuid.uuid4()),
                url="",
                quality=Quality.P1080,
                mode=DownloadMode.AUDIO,
                kind=JobKind.MATCH_DOWNLOAD,
                track_title=item.title,
                artist=item.artist,
                duration_ms=item.duration_ms,
                output_dir=output_dir,
            )
            self.jobs[job.id] = job
            self.queue.put_nowait(job.id)
            created.append(job)
        return created

    def get_job(self, job_id: str) -> Optional[Job]:
        return self.jobs.get(job_id)

    def list_jobs(self) -> list[Job]:
        return sorted(self.jobs.values(), key=lambda j: j.created_at, reverse=True)

    def cancel_or_remove(self, job_id: str) -> Optional[Job]:
        job = self.jobs.get(job_id)
        if not job:
            return None
        if job.status == JobStatus.QUEUED:
            job.cancelled = True
            job.status = JobStatus.CANCELLED
            self.notify(job)
            return job
        if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            # Remove from store and delete file if present
            if job.filepath and job.filepath.exists():
                try:
                    job.filepath.unlink(missing_ok=True)
                except OSError:
                    pass
            del self.jobs[job_id]
            return job
        # Matching/downloading - mark cancelled; worker will stop when it checks
        job.cancelled = True
        return job

    def subscribe(self, job_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        self.subscribers.setdefault(job_id, []).append(q)
        # Push current state immediately
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
                # Drop oldest-ish by skipping if full
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
            if not job:
                self.queue.task_done()
                continue
            if job.cancelled or job.status == JobStatus.CANCELLED:
                self.queue.task_done()
                continue

            await self.run_job(job)
            self.queue.task_done()

    async def run_job(self, job: Job):
        if job.kind == JobKind.MATCH_DOWNLOAD:
            await self._run_match_job(job)
        else:
            await self._run_url_job(job)

    async def _run_match_job(self, job: Job):
        job.status = JobStatus.MATCHING
        self.notify(job)

        loop = asyncio.get_event_loop()

        try:
            match = await loop.run_in_executor(
                None,
                lambda: find_best_match(job.track_title, job.artist, job.duration_ms),
            )
        except Exception as e:
            job.status = JobStatus.FAILED
            job.error = f"YouTube search failed: {e}"
            self.notify(job)
            return

        if job.cancelled:
            job.status = JobStatus.CANCELLED
            self.notify(job)
            return

        if match is None:
            job.status = JobStatus.FAILED
            job.error = f'No good YouTube match found for "{job.track_title}" by {job.artist}.'
            self.notify(job)
            return

        job.url = match.url
        job.title = match.title
        await self._download_and_finish(job, output_dir=job.output_dir)

    async def _run_url_job(self, job: Job):
        job.status = JobStatus.DOWNLOADING
        job.percent = 0.0
        self.notify(job)
        await self._download_and_finish(job, output_dir=DOWNLOAD_DIR)

    async def _download_and_finish(self, job: Job, output_dir: Path):
        job.status = JobStatus.DOWNLOADING
        job.percent = 0.0
        self.notify(job)

        loop = asyncio.get_event_loop()

        def on_info(info: dict):
            job.title = info.get("title") or job.title
            job.thumbnail = info.get("thumbnail") or job.thumbnail
            # Schedule notify on event loop from worker thread
            loop.call_soon_threadsafe(self.notify, job)

        def on_progress(d: dict):
            if job.cancelled:
                raise RuntimeError("Download cancelled by user.")
            status = d.get("status")
            if status == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                downloaded = d.get("downloaded_bytes") or 0
                if total:
                    job.percent = round(min(100.0, downloaded / total * 100), 1)
                job.speed = format_speed(d.get("speed"))
                job.eta = format_eta(d.get("eta"))
                loop.call_soon_threadsafe(self.notify, job)
            elif status == "finished":
                job.percent = 100.0
                job.speed = None
                job.eta = None
                loop.call_soon_threadsafe(self.notify, job)

        try:
            path = await loop.run_in_executor(
                None,
                lambda: download_video(
                    url=job.url,
                    output_dir=output_dir,
                    mode=job.mode,
                    quality=job.quality,
                    on_progress=on_progress,
                    on_info=on_info,
                ),
            )
            if job.cancelled:
                job.status = JobStatus.CANCELLED
                if path.exists():
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        pass
            else:
                job.status = JobStatus.COMPLETED
                job.percent = 100.0
                job.filepath = path
                job.filename = path.name
                job.speed = None
                job.eta = None
        except Exception as e:
            if job.cancelled or "cancelled" in str(e).lower():
                job.status = JobStatus.CANCELLED
                job.error = None
            else:
                job.status = JobStatus.FAILED
                job.error = str(e)

        self.notify(job)


# Singleton used by the app
job_manager = JobManager()
