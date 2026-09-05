from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

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
    status: str
    decision: str | None
    created_at: datetime
