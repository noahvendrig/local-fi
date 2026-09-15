# FastAPI entrypoint
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.fingerprint_routes import router as fingerprint_router
from api.routes import router
from api.similarity_routes import router as similarity_router
from config import CORS_ORIGINS
from services.cleanup import cleanup_old_files
from services.fingerprint.job_manager import fingerprint_job_manager
from services.job_manager import job_manager
from services.similarity.job_manager import similarity_job_manager


async def cleanup_loop():
    # Periodically remove expired download files
    while True:
        try:
            cleanup_old_files()
        except Exception:
            pass
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await job_manager.start()
    await fingerprint_job_manager.start()
    await similarity_job_manager.start()
    cleanup_task = asyncio.create_task(cleanup_loop())
    yield
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    await similarity_job_manager.stop()
    await fingerprint_job_manager.stop()
    await job_manager.stop()


app = FastAPI(title="local-fi Python backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(fingerprint_router)
app.include_router(similarity_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
