from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class CreateRequestIn(BaseModel):
    capability: str


class DecideIn(BaseModel):
    decision: str            # 'once' | 'permanent' | 'refused'
    window: str | None = None  # '2h' | 'today' | 'week' (required for 'once')
    note: str | None = None


class PermissionRequestRead(BaseModel):
    id: int
    user_id: int
    requester_name: str
    capability: str
    capability_label: str
    status: str
    decision: str | None
    created_at: datetime
