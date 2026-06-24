"""AppSetting schemas — key/value with JSON-encoded payload."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


class AppSettingUpsert(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    value: Any  # decoded JSON, serialised on the way in


class AppSettingRead(ORMBase):
    key: str
    value: str  # raw JSON-encoded string as stored
