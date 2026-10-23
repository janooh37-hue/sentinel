"""Department administration and scoping rollout contracts."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

DepartmentRole = Literal["head", "deputy", "member"]


class UserDepartmentRead(BaseModel):
    department_id: int
    name_en: str
    name_ar: str
    role: DepartmentRole
    is_primary: bool


class DepartmentPersonRead(BaseModel):
    user_id: int
    display_name: str
    role: DepartmentRole


class DepartmentMemberRead(DepartmentPersonRead):
    email: str
    is_primary: bool


class DepartmentRead(BaseModel):
    id: int
    name_en: str
    name_ar: str
    parent_id: int | None
    active: bool
    member_count: int
    employee_count: int
    service_ids: list[str]
    heads: list[DepartmentPersonRead]


class DepartmentCreate(BaseModel):
    name_en: str = Field(min_length=1, max_length=128)
    name_ar: str = Field(min_length=1, max_length=128)
    parent_id: int | None = None

    @field_validator("name_en", "name_ar", mode="before")
    @classmethod
    def strip_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DepartmentUpdate(BaseModel):
    name_en: str | None = Field(default=None, min_length=1, max_length=128)
    name_ar: str | None = Field(default=None, min_length=1, max_length=128)
    parent_id: int | None = None
    active: bool | None = None

    @field_validator("name_en", "name_ar", "active", mode="before")
    @classmethod
    def reject_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("This field cannot be null")
        return value.strip() if isinstance(value, str) else value


class DepartmentServicesUpdate(BaseModel):
    service_ids: list[str]


class DepartmentServiceOption(BaseModel):
    id: str
    label_en: str
    label_ar: str | None


class DepartmentMembership(BaseModel):
    department_id: int
    role: DepartmentRole
    is_primary: bool


class DepartmentMembershipsUpdate(BaseModel):
    memberships: list[DepartmentMembership]


class UnassignedEmployeeGroup(BaseModel):
    duty_unit: str | None
    legacy_department: str | None
    employee_ids: list[str]
    count: int


class DepartmentAssignEmployees(BaseModel):
    employee_ids: list[str] = Field(min_length=1, max_length=1000)
    department_id: int | None


class DepartmentAssignmentResult(BaseModel):
    updated: int


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
    users_without_department: list[DepartmentScopingUserRead]
    departments_without_head: list[DepartmentScopingDepartmentRead]
    departments_without_services: list[DepartmentScopingDepartmentRead]


class DepartmentScopingUpdate(BaseModel):
    enabled: bool
