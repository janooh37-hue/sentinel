from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal, Protocol

DocType = Literal["uae_id", "passport"]
Bucket = Literal["expired", "critical", "soon"]


class _Emp(Protocol):
    id: str
    name_en: str
    name_ar: str | None
    status: str
    uae_id_expiry: date | None
    passport_expiry: date | None


@dataclass(frozen=True)
class ExpiryItem:
    employee_id: str
    name_en: str
    name_ar: str | None
    doc_type: DocType
    expiry_date: date
    days_remaining: int
    bucket: Bucket


def _bucket(days: int) -> Bucket:
    if days < 0:
        return "expired"
    if days <= 30:
        return "critical"
    return "soon"


def compute_expiry(
    employees: list[_Emp],
    *,
    today: date,
    within: int = 90,
    doc_type: DocType | Literal["all"] = "all",
) -> list[ExpiryItem]:
    """Active employees with a non-null expiry whose days_remaining <= within
    (expired always included). Sorted soonest-first."""
    out: list[ExpiryItem] = []
    fields: tuple[tuple[DocType, str], ...] = (
        ("uae_id", "uae_id_expiry"),
        ("passport", "passport_expiry"),
    )
    for emp in employees:
        if emp.status != "Active":
            continue
        for dt, attr in fields:
            if doc_type != "all" and dt != doc_type:
                continue
            exp = getattr(emp, attr)
            if exp is None:
                continue
            days = (exp - today).days
            if days > within:
                continue
            out.append(
                ExpiryItem(emp.id, emp.name_en, emp.name_ar, dt, exp, days, _bucket(days))
            )
    out.sort(key=lambda i: i.days_remaining)
    return out
