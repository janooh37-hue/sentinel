"""CRUD for duty-unit supervisor designations + resolution to current holders.

A duty unit is mapped to one or more ``recipient_duty_post`` designations; the
actual recipients are resolved at send time from active employees holding those
designations (with a valid mobile), so roster moves never break routing.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.phone import normalize_phone
from app.db.models import DutySupervisor, Employee


def list_mappings(db: Session) -> list[DutySupervisor]:
    return list(
        db.scalars(
            select(DutySupervisor).order_by(
                DutySupervisor.duty_unit, DutySupervisor.recipient_duty_post
            )
        )
    )


def add_mapping(db: Session, duty_unit: str, recipient_duty_post: str) -> DutySupervisor:
    """Create the (unit, designation) mapping, or return the existing row."""
    duty_unit = duty_unit.strip()
    recipient_duty_post = recipient_duty_post.strip()
    existing = db.scalar(
        select(DutySupervisor).where(
            DutySupervisor.duty_unit == duty_unit,
            DutySupervisor.recipient_duty_post == recipient_duty_post,
        )
    )
    if existing is not None:
        return existing
    row = DutySupervisor(duty_unit=duty_unit, recipient_duty_post=recipient_duty_post)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def remove_mapping(db: Session, mapping_id: int) -> bool:
    row = db.get(DutySupervisor, mapping_id)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def resolve_supervisors(db: Session, duty_unit: str) -> list[Employee]:
    """Active employees in ``duty_unit`` whose duty_post is a configured
    designation AND whose contact normalizes to a mobile. Empty if unmapped."""
    posts = list(
        db.scalars(
            select(DutySupervisor.recipient_duty_post).where(DutySupervisor.duty_unit == duty_unit)
        )
    )
    if not posts:
        return []
    cc = get_settings().sms_country_code
    candidates = list(
        db.scalars(
            select(Employee).where(
                Employee.duty_unit == duty_unit,
                Employee.duty_post.in_(posts),
                Employee.status == "Active",
            )
        )
    )
    return [e for e in candidates if normalize_phone(e.contact, default_cc=cc)]
