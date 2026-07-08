"""Schemas for the employee detail aggregate endpoint (TAMM redesign §6.6a).

Returned by ``GET /api/v1/employees/{id}/detail`` so the Employee Detail page
can render its hero card, stats strip, and tabbed history in a single request.

Field names mirror the actual ORM column names (e.g. ``Document.template_id``
not ``form_key``; ``Violation.date`` not ``occurred_at``) so ``model_validate``
works directly on a SQLAlchemy row.
"""

from __future__ import annotations

from datetime import date as date_t
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas._base import ORMBase
from app.schemas.employee import EmployeeRead
from app.schemas.employee_completeness import CompletenessRead
from app.schemas.sms import (
    SmsMessageRead as SmsMessageRead,
)  # re-exported; keep sx.SmsMessageRead working


class EmployeeStatsRead(BaseModel):
    documents: int
    leaves_taken_days: int
    leaves_allowed_days: int
    violations: int
    ledger_count: int
    tenure_years: float


class RecentDocumentRead(ORMBase):
    id: int
    template_id: str
    ref_number: str
    created_at: datetime
    book_id: int | None = None
    approval_state: str | None = None


class RecentLeaveRead(ORMBase):
    id: int
    leave_type: str
    start_date: date_t
    end_date: date_t
    days: int
    status: str


class RecentViolationRead(ORMBase):
    id: int
    date: date_t
    violation_type: str
    status: str
    description: str | None = None


class RecentLedgerRead(ORMBase):
    id: int
    subject: str
    direction: str
    counterparty: str | None = None
    created_at: datetime


class ActivityItemRead(BaseModel):
    when: datetime
    kind: Literal["document", "leave", "violation", "ledger"]
    summary: str
    ref_id: int


class EmployeeDetailRead(BaseModel):
    employee: EmployeeRead
    stats: EmployeeStatsRead
    recent_documents: list[RecentDocumentRead]
    recent_leaves: list[RecentLeaveRead]
    recent_violations: list[RecentViolationRead]
    recent_ledger: list[RecentLedgerRead]
    recent_activity: list[ActivityItemRead]
    recent_sms: list[SmsMessageRead]
    missing_fields: list[str]
    completeness: CompletenessRead
