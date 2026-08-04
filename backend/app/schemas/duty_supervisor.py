from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


class DutySupervisorCreate(BaseModel):
    duty_unit: str = Field(min_length=1, max_length=128)
    recipient_duty_post: str = Field(min_length=1, max_length=128)


class DutySupervisorRead(ORMBase):
    id: int
    duty_unit: str
    recipient_duty_post: str
    created_at: datetime
