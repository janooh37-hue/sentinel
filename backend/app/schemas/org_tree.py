"""Schemas for the employee reporting hierarchy."""

from __future__ import annotations

from pydantic import BaseModel

from app.schemas._base import ORMBase


class OrgNode(ORMBase):
    id: str
    name_en: str
    name_ar: str | None
    position: str | None
    position_ar: str | None
    department: str | None
    duty_unit: str | None
    duty_post: str | None
    status: str
    supervisor_id: str | None


class OrgSupervisorUpdate(BaseModel):
    supervisor_id: str | None = None
