from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas._base import ORMBase

EmployeeActivityKind = Literal["document", "leave", "violation", "ledger"]


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


class EmployeeActivityListRead(BaseModel):
    items: list[EmployeeActivityItemRead]
    total: int
    limit: int
    offset: int
