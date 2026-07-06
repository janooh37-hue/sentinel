"""In-process job registry for document generation.

Jobs are stored in a module-level dict keyed by UUID4 string.  The dict is
protected by a threading.Lock because BackgroundTasks can run on any thread in
FastAPI's thread pool.

Lifecycle:
  submit_job(...)  → stores a queued Job, returns job_id
  get_job(job_id)  → Job | None
  The caller (background task) mutates .status and result fields directly.
"""

from __future__ import annotations

import dataclasses
import threading
import uuid
from dataclasses import dataclass, field
from typing import Literal

JobStatus = Literal["queued", "running", "done", "failed"]

_jobs: dict[str, _Job] = {}
_lock = threading.Lock()

# Cap the in-process registry so a long-uptime service doesn't leak memory one
# entry per /documents/generate forever. Oldest *terminal* (done/failed) jobs
# are evicted first; in-flight (queued/running) jobs are never dropped.
_MAX_JOBS = 500


def _prune_locked() -> None:
    """Evict oldest terminal jobs when over the cap. Caller must hold ``_lock``."""
    if len(_jobs) <= _MAX_JOBS:
        return
    for job_id in list(_jobs):  # dict preserves insertion order → oldest first
        if len(_jobs) <= _MAX_JOBS:
            break
        if _jobs[job_id].status in ("done", "failed"):
            del _jobs[job_id]


@dataclass
class JobDocumentItem:
    """Describes one document (primary or companion) inside a completed job.

    Defined here (not in documents.py) to avoid a circular import between
    job_registry and documents.  documents.py re-exports this as a Pydantic
    model for OpenAPI schema generation.
    """

    document_id: int
    template_id: str
    role: str  # "primary" | "companion"
    ref_number: str
    docx_url: str
    pdf_url: str | None = None


@dataclass
class _Job:
    job_id: str
    status: JobStatus = "queued"
    # P04-J: list of generated document items (primary + companions).
    submission_id: str | None = None
    documents: list[JobDocumentItem] = field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None


def submit_job() -> str:
    """Create a new queued job and return its job_id."""
    job_id = str(uuid.uuid4())
    with _lock:
        _jobs[job_id] = _Job(job_id=job_id)
        _prune_locked()
    return job_id


def get_job(job_id: str) -> _Job | None:
    """Return a snapshot of the job state, or None if not found.

    Returns a shallow copy taken while the lock is held — modifying the result
    has no effect on the registry.
    """
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        return dataclasses.replace(job)


def set_running(job_id: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.status = "running"


def set_done(
    job_id: str,
    *,
    submission_id: str,
    documents: list[JobDocumentItem],
) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.status = "done"
            job.submission_id = submission_id
            job.documents = documents


def set_failed(job_id: str, *, error_code: str, error_message: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.status = "failed"
            job.error_code = error_code
            job.error_message = error_message


__all__ = ["_Job", "get_job", "set_done", "set_failed", "set_running", "submit_job"]
