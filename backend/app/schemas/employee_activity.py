from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas._base import ORMBase

DutyLocationEventType = Literal["initial_placement", "transfer"]
EmployeeActivityKind = Literal["document", "leave", "violation", "ledger", "duty_location"]


class EmployeeActivityItemRead(ORMBase):
    kind: EmployeeActivityKind
    source_id: int
    target_id: int
    occurred_at: datetime
    employee_id: str
    employee_name_en: str
    employee_name_ar: str | None = None
    title: str
    detail: str | None = None
    status: str | None = None
    days: int | None = None
    direction: str | None = None
    channel: str | None = None
    reference: str

    event_type: DutyLocationEventType | None = None
    from_department: str | None = None
    from_unit: str | None = None
    from_post: str | None = None
    to_department: str | None = None
    to_unit: str | None = None
    to_post: str | None = None
    reason: str | None = None


class EmployeeActivityListRead(BaseModel):
    items: list[EmployeeActivityItemRead]
    total: int
    limit: int
    offset: int
