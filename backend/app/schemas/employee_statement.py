"""Employee-file statements: the Activity statement and issued print serials.

Field-for-field the contract in
``frontend/src/pages/employees/statement/statementTypes.ts``.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas._base import ORMBase
from app.schemas.employee_activity import (
    DutyLocationEventType,
    StatusEventKind,
    StatusEventSource,
)
from app.schemas.linked_document import LinkedDocumentRead

StatementKind = Literal[
    "document", "leave", "violation", "ledger", "absence", "duty_location", "status"
]
StatementPrintKind = Literal["activity", "attendance"]
StatementLanguage = Literal["ar", "en"]

# Upper bound on the serialized setup options stored with a print.
MAX_PRINT_OPTIONS_BYTES = 4096


class ActivityStatementItemRead(BaseModel):
    """One fact in the employee's record. Only the fields of its kind are set.

    ``occurred_at`` is site-local (Asia/Dubai) and carries its offset, so the
    wall-clock time is the string's ``HH:MM`` and the instant is unambiguous.
    """

    # Every field is always sent (null when not of this kind): the contract
    # types them as required and nullable, not optional.
    model_config = ConfigDict(
        json_schema_mode_override="serialization",
        json_schema_serialization_defaults_required=True,
    )

    kind: StatementKind
    source_id: int
    occurred_at: datetime
    date_only: bool
    actor_name: str | None = None
    reference: str | None = None
    # document
    template_id: str | None = None
    template_name_en: str | None = None
    template_name_ar: str | None = None
    # leave
    leave_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    days: int | None = None
    leave_status: str | None = None
    # violation
    violation_type: str | None = None
    description: str | None = None
    action_taken: str | None = None
    deduction_days: int | None = None
    violation_status: str | None = None
    # ledger (correspondence)
    subject: str | None = None
    direction: str | None = None
    channel: str | None = None
    counterparty: str | None = None
    # absence
    note: str | None = None
    # duty_location
    event_type: DutyLocationEventType | None = None
    from_department: str | None = None
    from_unit: str | None = None
    from_post: str | None = None
    to_department: str | None = None
    to_unit: str | None = None
    to_post: str | None = None
    reason: str | None = None
    # status
    from_status: str | None = None
    to_status: str | None = None
    effective_date: date | None = None
    site: str | None = None
    return_date: date | None = None
    status_event_kind: StatusEventKind | None = None
    status_source: StatusEventSource | None = None
    linked_documents: list[LinkedDocumentRead] = Field(default_factory=list)


class ActivityStatementRead(BaseModel):
    employee_id: str
    from_date: date | None
    to_date: date | None
    items: list[ActivityStatementItemRead]
    truncated: bool


class StatementPrintCreate(BaseModel):
    kind: StatementPrintKind
    from_date: date | None
    to_date: date
    language: StatementLanguage
    options: dict[str, Any]

    @field_validator("options")
    @classmethod
    def _bounded_options(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > MAX_PRINT_OPTIONS_BYTES:
            raise ValueError(f"options may not exceed {MAX_PRINT_OPTIONS_BYTES} bytes")
        return value

    @model_validator(mode="after")
    def _ordered_period(self) -> StatementPrintCreate:
        if self.from_date is not None and self.to_date < self.from_date:
            raise ValueError("to_date must not be before from_date")
        return self


class StatementPrintRead(ORMBase):
    id: int
    employee_id: str
    kind: StatementPrintKind
    serial: int
    reference: str
    from_date: date | None
    to_date: date
    language: StatementLanguage
    printed_at: datetime
    printed_by_name: str | None
