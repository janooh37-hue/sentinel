"""System info schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas._base import ORMBase


class SystemInfo(BaseModel):
    version: str
    db_path: str
    log_path: str
    data_dir: str
    python_version: str
    platform: str
    uptime_seconds: int


class UpdateCheckResult(ORMBase):
    current: str
    latest: str | None
    update_available: bool
    checked_at: datetime
    error: str | None
