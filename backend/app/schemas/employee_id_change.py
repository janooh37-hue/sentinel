"""Preview and confirmation payloads for a capability-gated G-number correction."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

ImpactKey = Literal[
    "documents",
    "leaves",
    "violations",
    "absences",
    "attendance",
    "timesheet",
    "messages",
    "uniform",
    "vault_files",
]


class EmployeeIdChangeImpactRead(BaseModel):
    key: ImpactKey
    count: int


class EmployeeIdChangePreviewRead(BaseModel):
    new_id: str
    status: Literal["ok", "invalid", "same", "taken"]
    owner_id: str | None = None
    owner_name_en: str | None = None
    owner_name_ar: str | None = None
    impact: list[EmployeeIdChangeImpactRead]


class EmployeeIdChangeRequest(BaseModel):
    new_id: str
    reason: str = Field(min_length=5, max_length=500)

    @field_validator("reason", mode="before")
    @classmethod
    def trim_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value
