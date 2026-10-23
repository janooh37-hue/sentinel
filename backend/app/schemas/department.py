"""Department administration and scoping rollout contracts (org-tree model)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# Heads come from ``departments.head_employee_id``; deputies and viewers are user
# grants; members belong through the derived ``employees.department_id``.
DepartmentRole = Literal["head", "deputy", "viewer", "member"]


class UserDepartmentRead(BaseModel):
    department_id: int
    name_en: str
    name_ar: str
    role: DepartmentRole


class DepartmentPersonRead(BaseModel):
    user_id: int
    display_name: str
    role: DepartmentRole


class DepartmentRead(BaseModel):
    id: int
    name_en: str
    name_ar: str
    head_employee_id: str
    head_name_en: str
    head_name_ar: str | None
    # The active account linked to the head employee, if any.
    head_user_id: int | None
    # Derived from the org tree.
    parent_id: int | None
    active: bool
    employee_count: int
    deputies: list[DepartmentPersonRead]
    viewers: list[DepartmentPersonRead]
    service_ids: list[str]
    exception_count: int


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


class DepartmentCreate(BaseModel):
    name_en: str = Field(min_length=1, max_length=128)
    name_ar: str = Field(min_length=1, max_length=128)
    head_employee_id: str = Field(min_length=1, max_length=16)

    @field_validator("name_en", "name_ar", "head_employee_id", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return _strip(value)


class DepartmentUpdate(BaseModel):
    name_en: str | None = Field(default=None, min_length=1, max_length=128)
    name_ar: str | None = Field(default=None, min_length=1, max_length=128)
    head_employee_id: str | None = Field(default=None, min_length=1, max_length=16)
    active: bool | None = None

    @field_validator("name_en", "name_ar", "head_employee_id", "active", mode="before")
    @classmethod
    def reject_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("This field cannot be null")
        return _strip(value)


class DepartmentPeopleUpdate(BaseModel):
    deputy_user_ids: list[int] = Field(default_factory=list)
    viewer_user_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def disjoint(self) -> "DepartmentPeopleUpdate":
        if set(self.deputy_user_ids) & set(self.viewer_user_ids):
            raise ValueError("A user cannot be both a deputy and a viewer")
        return self


class DepartmentServicesUpdate(BaseModel):
    service_ids: list[str]


class DepartmentServiceOption(BaseModel):
    id: str
    label_en: str
    label_ar: str | None


class DepartmentExceptionRead(BaseModel):
    employee_id: str
    name_en: str
    name_ar: str | None
    # NULL = outside all departments.
    department_id: int | None
    # What the org tree alone would give this employee.
    tree_department_id: int | None
    created_by: str | None
    created_at: datetime


class DepartmentExceptionUpdate(BaseModel):
    department_id: int | None


class UnassignedEmployeeGroup(BaseModel):
    # Highest supervisor-tree ancestor of the group.
    top_employee_id: str
    top_name_en: str
    top_name_ar: str | None
    duty_unit: str | None
    count: int
    employee_ids: list[str]


class DepartmentScopingUserRead(BaseModel):
    user_id: int
    display_name: str
    email: str


class DepartmentScopingDepartmentRead(BaseModel):
    id: int
    name_en: str
    name_ar: str


class DepartmentScopingRead(BaseModel):
    enabled: bool
    records_backfilled: int = 0
    users_without_department: list[DepartmentScopingUserRead]
    # No reachable head account and no deputies.
    departments_without_receiver: list[DepartmentScopingDepartmentRead]
    departments_without_services: list[DepartmentScopingDepartmentRead]


class DepartmentScopingUpdate(BaseModel):
    enabled: bool
