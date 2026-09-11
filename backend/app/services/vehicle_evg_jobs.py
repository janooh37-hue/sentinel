"""Run long EVG preview fetches outside FastAPI's shared request thread pool.

A dedicated single worker isolates an upstream call of unknown duration so it cannot
starve the lightweight preview-status routes.
"""

from __future__ import annotations

import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Literal

from fastapi import status

from app.api.errors import AppError, EvgError, NotFoundError
from app.db import session as session_mod
from app.schemas.vehicle import EvgPreviewJobStatus, EvgPreviewResponse
from app.services import vehicle_evg_service

log = logging.getLogger(__name__)

_JobStatus = Literal["queued", "running", "done", "failed"]


@dataclass
class _PreviewJob:
    job_id: str
    owner_id: int
    status: _JobStatus = "queued"
    result: EvgPreviewResponse | None = None
    error_code: str | None = None
    error_message: str | None = None


_jobs: dict[str, _PreviewJob] = {}
_lock = threading.Lock()
_executor: ThreadPoolExecutor | None = None
_MAX_JOBS = 500


def _prune_for_admission_locked() -> None:
    """Evict oldest terminal jobs until one registry slot is available."""
    if len(_jobs) < _MAX_JOBS:
        return
    for job_id in list(_jobs):
        if len(_jobs) < _MAX_JOBS:
            break
        if _jobs[job_id].status in ("done", "failed"):
            del _jobs[job_id]


def _executor_locked() -> ThreadPoolExecutor:
    """Return the single lazy executor. Caller must hold ``_lock``."""
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="evg-preview")
    return _executor


def _set_failed(job_id: str, *, error_code: str, error_message: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job.status = "failed"
        job.result = None
        job.error_code = error_code
        job.error_message = error_message


def _run_preview(job_id: str, traffic_codes: list[str] | None) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job.status = "running"

    try:
        db = session_mod.SessionLocal()
        try:
            result = vehicle_evg_service.preview(db, traffic_codes=traffic_codes)
        finally:
            db.close()
    except EvgError as exc:
        _set_failed(job_id, error_code=exc.code, error_message=exc.message)
    except Exception as exc:
        log.error(
            "EVG preview job failed",
            extra={"job_id": job_id, "exception_class": type(exc).__name__},
        )
        _set_failed(
            job_id,
            error_code="EVG_UNAVAILABLE",
            error_message="EVG fine fetching failed.",
        )
    else:
        with _lock:
            job = _jobs.get(job_id)
            if job is None:
                return
            job.status = "done"
            job.result = result
            job.error_code = None
            job.error_message = None


def submit_preview(*, owner_id: int, traffic_codes: list[str] | None) -> str:
    """Queue an EVG preview for one user and return its opaque job id."""
    submitted_codes = None if traffic_codes is None else list(traffic_codes)
    job_id = str(uuid.uuid4())

    with _lock:
        _prune_for_admission_locked()
        if len(_jobs) >= _MAX_JOBS:
            raise AppError(
                "EVG_BUSY",
                "EVG fetch queue is full.",
                http_status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        executor = _executor_locked()
        _jobs[job_id] = _PreviewJob(job_id=job_id, owner_id=owner_id)

    try:
        executor.submit(_run_preview, job_id, submitted_codes)
    except Exception:
        with _lock:
            _jobs.pop(job_id, None)
        raise EvgError("EVG_UNAVAILABLE", "EVG fine fetching failed.") from None
    return job_id


def get_preview(job_id: str, *, owner_id: int) -> EvgPreviewJobStatus:
    """Return an owner-scoped snapshot without disclosing other users' jobs."""
    with _lock:
        job = _jobs.get(job_id)
        if job is None or job.owner_id != owner_id:
            raise NotFoundError(
                "EVG_PREVIEW_JOB_NOT_FOUND",
                "EVG preview job not found.",
            )
        return EvgPreviewJobStatus(
            job_id=job.job_id,
            status=job.status,
            result=job.result,
            error_code=job.error_code,
            error_message=job.error_message,
        )


def shutdown() -> None:
    """Cancel queued work, drain any active fetch, and clear ephemeral jobs."""
    global _executor
    with _lock:
        executor = _executor
        _executor = None

    try:
        if executor is not None:
            # Intentional tradeoff: an in-flight fetch is drained, so shutdown can
            # take as long as today's synchronous route; queued work is cancelled.
            executor.shutdown(wait=True, cancel_futures=True)
    finally:
        with _lock:
            _jobs.clear()


__all__ = ["get_preview", "shutdown", "submit_preview"]
