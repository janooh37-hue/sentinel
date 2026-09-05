from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


class CreateRequestIn(BaseModel):
    capability: str


class DecideIn(BaseModel):
    decision: str  # 'once' | 'permanent' | 'refused'
    window: str | None = None  # '2h' | 'today' | 'week' (required for 'once')
    note: str | None = None


class PermissionRequestRead(ORMBase):
    id: int
    user_id: int
    requester_name: str
    capability: str
    capability_label: str = Field(
        deprecated=True,
        description="Deprecated English capability label derived from the catalog.",
    )
    status: str
    decision: str | None
    created_at: datetime
