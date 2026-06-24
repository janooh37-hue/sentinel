"""Crash report payload schema."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

_64KiB = 64 * 1024
_1KiB = 1024


class CrashReportPayload(BaseModel):
    message: Annotated[str, Field(max_length=_1KiB)]
    stack: Annotated[str | None, Field(default=None, max_length=_64KiB)] = None
    browser: str | None = None
    timestamp: datetime | None = None  # client-side timestamp
    severity: Literal["error", "warning"] = "error"
