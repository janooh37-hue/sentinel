"""Security-permit service — register CRUD, lifecycle actions, and audit writes.

Greenfield feature (2026-07). Mirrors the conventions in ``leave_service``:
module-level functions, ``db`` first + keyword-only args, an ``actor`` string,
services return ORM rows and the router maps them to schemas, and every
mutation writes an ``AuditLog`` row.

Whether a permit is *expired* / *expiring* is derived from ``end_date`` at read
time (never stored), so the register is correct without a nightly job.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import Select, func, or_, select, text
from sqlalchemy.orm import Session, selectinload

from app.api.errors import NotFoundError, ValidationFailedError
from app.config import get_settings
from app.db.models import (
    AuditLog,
    Book,
    Permit,
    PermitPerson,
    PermitVehicle,
    PermitVisit,
    User,
)
from app.schemas.permit import (
    PermitCreate,
    PermitListItem,
    PermitPersonCreate,
    PermitPersonRead,
    PermitRead,
    PermitUpdate,
    PermitVehicleCreate,
    PermitVehicleRead,
    PermitVisitCreate,
    PersonIdScan,
    VehicleLicenceScan,
)

log = logging.getLogger(__name__)

# A permit is "expiring" once it is this close to its end date.
EXPIRING_WITHIN_DAYS = 7


def _utcnow() -> datetime:
    # Naive UTC — matches app.db.models._utcnow so timestamps compare cleanly.
    return datetime.now(UTC).replace(tzinfo=None)


# ─── derived / computed fields ─────────────────────────────────────────────────


def _active_people(row: Permit) -> list[PermitPerson]:
    return [p for p in row.people if p.removed_at is None]


def _active_vehicles(row: Permit) -> list[PermitVehicle]:
    return [v for v in row.vehicles if v.removed_at is None]


def _basename(path: str | None) -> str | None:
    return Path(path).name if path else None


def _duration_days(row: Permit) -> int:
    return (row.end_date - row.start_date).days + 1


def _days_remaining(row: Permit, *, today: date) -> int | None:
    if row.status == "revoked":
        return None
    return (row.end_date - today).days


def _derived_status(row: Permit, *, today: date) -> str:
    if row.status == "revoked":
        return "revoked"
    if row.end_date < today:
        return "expired"
    if (row.end_date - today).days <= EXPIRING_WITHIN_DAYS:
        return "expiring"
    return "active"


def _person_read(p: PermitPerson) -> PermitPersonRead:
    return PermitPersonRead.model_validate(p).model_copy(
        update={"id_doc_name": _basename(p.id_doc_path)}
    )


def _vehicle_read(v: PermitVehicle) -> PermitVehicleRead:
    return PermitVehicleRead.model_validate(v).model_copy(
        update={"license_doc_name": _basename(v.license_doc_path)}
    )


def to_read(row: Permit, *, today: date | None = None, db: Session | None = None) -> PermitRead:
    """Build the detail schema (people + vehicles) + computed fields off a row."""
    today = today or date.today()
    people = _active_people(row)
    vehicles = _active_vehicles(row)
    book_ref: str | None = None
    if db is not None and row.book_id is not None:
        b = db.get(Book, row.book_id)
        book_ref = b.ref_number if b is not None else None
    return PermitRead.model_validate(row).model_copy(
        update={
            "derived_status": _derived_status(row, today=today),
            "duration_days": _duration_days(row),
            "days_remaining": _days_remaining(row, today=today),
            "people_count": len(people),
            "vehicle_count": len(vehicles),
            "document_name": _basename(row.document_path),
            "manager_id": row.manager_id,
            "book_id": row.book_id,
            "book_ref": book_ref,
            "people": [_person_read(p) for p in people],
            "vehicles": [_vehicle_read(v) for v in vehicles],
        }
    )


def to_list_item(row: Permit, *, today: date | None = None) -> PermitListItem:
    today = today or date.today()
    return PermitListItem.model_validate(row).model_copy(
        update={
            "derived_status": _derived_status(row, today=today),
            "duration_days": _duration_days(row),
            "days_remaining": _days_remaining(row, today=today),
            "people_count": len(_active_people(row)),
            "vehicle_count": len(_active_vehicles(row)),
            "has_document": bool(row.document_path),
        }
    )


# ─── queries ───────────────────────────────────────────────────────────────────


def _base_query(*, include_deleted: bool) -> Select[tuple[Permit]]:
    stmt = select(Permit).options(selectinload(Permit.people), selectinload(Permit.vehicles))
    if not include_deleted:
        stmt = stmt.where(Permit.deleted_at.is_(None))
    return stmt


def _apply_state_filter(
    stmt: Select[tuple[Permit]], *, state: str | None, today: date
) -> Select[tuple[Permit]]:
    """Filter by the *derived* lifecycle bucket, expressed in SQL so paging and
    totals stay correct."""
    if not state:
        return stmt
    if state == "revoked":
        return stmt.where(Permit.status == "revoked")
    if state == "expired":
        return stmt.where(Permit.status == "active", Permit.end_date < today)
    cutoff = today + timedelta(days=EXPIRING_WITHIN_DAYS)
    if state == "expiring":
        return stmt.where(
            Permit.status == "active",
            Permit.end_date >= today,
            Permit.end_date <= cutoff,
        )
    if state == "active":
        return stmt.where(Permit.status == "active", Permit.end_date > cutoff)
    if state == "valid":
        # Currently usable = not revoked, not expired.
        return stmt.where(Permit.status == "active", Permit.end_date >= today)
    raise ValidationFailedError(
        "PERMIT_BAD_STATE", f"Unknown permit state filter: {state}", state=state
    )


def list_permits(
    db: Session,
    *,
    state: str | None = None,
    zone: str | None = None,
    company: str | None = None,
    q: str | None = None,
    include_deleted: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Permit], int]:
    today = date.today()
    stmt = _base_query(include_deleted=include_deleted)
    stmt = _apply_state_filter(stmt, state=state, today=today)
    if zone:
        # Membership test over the JSON zones array (SQLite json_each).
        stmt = stmt.where(
            text(
                "EXISTS (SELECT 1 FROM json_each(permits.zones) WHERE json_each.value = :zone)"
            ).bindparams(zone=zone)
        )
    if company:
        stmt = stmt.where(Permit.company.ilike(f"%{company}%"))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Permit.company.ilike(like), Permit.permit_no.ilike(like)))

    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one())

    stmt = stmt.order_by(Permit.created_at.desc(), Permit.id.desc()).limit(limit).offset(offset)
    rows = list(db.execute(stmt).scalars().unique().all())
    return rows, total


def get_permit(db: Session, permit_id: int, *, include_deleted: bool = False) -> Permit:
    stmt = _base_query(include_deleted=include_deleted).where(Permit.id == permit_id)
    row: Permit | None = db.execute(stmt).scalars().unique().one_or_none()
    if row is None:
        raise NotFoundError("PERMIT_NOT_FOUND", f"Permit {permit_id} does not exist", id=permit_id)
    return row


# ─── mutations ─────────────────────────────────────────────────────────────────


def _validate_window(start: date, end: date) -> None:
    if end < start:
        raise ValidationFailedError(
            "PERMIT_BAD_WINDOW",
            "Permit end date must not be before its start date.",
            start_date=str(start),
            end_date=str(end),
        )


def create_permit(db: Session, payload: PermitCreate, *, actor: str | None = None) -> Permit:
    _validate_window(payload.start_date, payload.end_date)
    if not payload.people:
        raise ValidationFailedError(
            "PERMIT_NO_PEOPLE", "A permit must authorize at least one person."
        )
    row = Permit(
        company=payload.company,
        zones=list(payload.zones),
        start_date=payload.start_date,
        end_date=payload.end_date,
        purpose=payload.purpose,
        notes=payload.notes,
        status="active",
        manager_id=payload.manager_id,
    )
    for person in payload.people:
        row.people.append(_new_person(person))
    for vehicle in payload.vehicles:
        row.vehicles.append(_new_vehicle(vehicle))
    db.add(row)
    db.flush()  # assign row.id so we can stamp the reference
    row.permit_no = f"PMT-{row.id:04d}"
    db.commit()
    db.refresh(row)
    _audit(db, "permit.created", row.id, actor, {"company": row.company, "zones": list(row.zones)})
    regenerate_permit_book(db, row, actor=actor)
    return get_permit(db, row.id)


def _letter_dicts(row: Permit) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    people: list[dict[str, Any]] = [
        {"name": p.name, "uae_id": p.uae_id, "nationality": p.nationality}
        for p in _active_people(row)
    ]
    vehicles: list[dict[str, Any]] = [
        {
            "plate_no": v.plate_no,
            "plate_emirate": v.plate_emirate,
            "plate_category": v.plate_category,
            "traffic_no": v.traffic_no,
            "make_model": v.make_model,
            "colour": v.colour,
            "reg_expiry": v.reg_expiry,
        }
        for v in _active_vehicles(row)
    ]
    return people, vehicles


def regenerate_permit_book(db: Session, permit: Permit, *, actor: str | None = None) -> None:
    """Generate (or re-version) the permit's 1/5 General Book from its current
    roster. Reuses document_service.generate_document — ref allocation, Arabic
    letterhead, manager signature, PDF. Resilient: a PDF failure still commits
    the Book (pdf_path NULL), same as the rest of the app.

    ponytail: re-renders docx->PDF on each roster change (Word COM). Fine for
    infrequent admin edits; switch to regenerate-on-print if throughput matters.
    """
    from app.core.permit_letter import PERMIT_RECIPIENT, build_permit_letter_html
    from app.services import document_service

    people, vehicles = _letter_dicts(permit)
    body = build_permit_letter_html(
        company=permit.company,
        zones=list(permit.zones),
        start_date=permit.start_date,
        end_date=permit.end_date,
        people=people,
        vehicles=vehicles,
        purpose=permit.purpose,
    )
    # Clean الموضوع line; the company renders as a header line under it (see
    # build_permit_letter_html). The book stays identifiable by its 1/5 ref and
    # its body text (company) is in the search index.
    subject = "التصاريح الأمنية"
    # The issuing operator's G-number goes in the footer ({{ submitter_g }}),
    # resolved from the audit actor's User row (employee_id = G-number).
    submitter = db.scalar(select(User).where(User.email == actor)) if actor else None
    result = document_service.generate_document(
        db,
        employee_id=None,
        template_id="General Book",
        fields={"subject": subject, "body": body, "recipient_name": PERMIT_RECIPIENT},
        classification_code="5/1",
        commit=True,
        manager_id=permit.manager_id,
        revise_of_book_id=permit.book_id,  # None on first gen → fresh 1/5 ref
        current_user=submitter,
        force_manager_embed=permit.manager_id is not None,
    )
    if permit.book_id is None:
        permit.book_id = result.book_id
        db.commit()
    _audit(db, "permit.book_generated", permit.id, actor, {"book_id": permit.book_id})


def update_permit(
    db: Session, permit_id: int, payload: PermitUpdate, *, actor: str | None = None
) -> Permit:
    row = get_permit(db, permit_id)
    if row.status == "revoked":
        raise ValidationFailedError(
            "PERMIT_REVOKED", "A revoked permit cannot be edited.", id=permit_id
        )
    data = payload.model_dump(exclude_unset=True)
    new_start = data.get("start_date", row.start_date)
    new_end = data.get("end_date", row.end_date)
    _validate_window(new_start, new_end)
    for field, value in data.items():
        setattr(row, field, value)
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "permit.updated", permit_id, actor, {"fields": sorted(data.keys())})
    regenerate_permit_book(db, get_permit(db, permit_id), actor=actor)
    return get_permit(db, permit_id)


def renew_permit(
    db: Session,
    permit_id: int,
    *,
    new_end_date: date,
    reason: str | None = None,
    actor: str | None = None,
) -> Permit:
    row = get_permit(db, permit_id)
    if row.status == "revoked":
        raise ValidationFailedError(
            "PERMIT_REVOKED", "A revoked permit cannot be renewed.", id=permit_id
        )
    if new_end_date <= row.end_date:
        raise ValidationFailedError(
            "PERMIT_BAD_RENEWAL",
            "The new end date must be after the current end date.",
            current_end=str(row.end_date),
            new_end=str(new_end_date),
        )
    old_end = row.end_date
    row.end_date = new_end_date
    row.updated_at = _utcnow()
    db.commit()
    _audit(
        db,
        "permit.renewed",
        permit_id,
        actor,
        {"from": str(old_end), "to": str(new_end_date), "reason": reason},
    )
    regenerate_permit_book(db, get_permit(db, permit_id), actor=actor)
    return get_permit(db, permit_id)


def revoke_permit(
    db: Session, permit_id: int, *, reason: str | None = None, actor: str | None = None
) -> Permit:
    row = get_permit(db, permit_id)
    if row.status == "revoked":
        raise ValidationFailedError(
            "PERMIT_REVOKED", "This permit is already revoked.", id=permit_id
        )
    row.status = "revoked"
    row.revoked_at = _utcnow()
    row.revoke_reason = reason
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "permit.revoked", permit_id, actor, {"reason": reason})
    return get_permit(db, permit_id)


def soft_delete_permit(db: Session, permit_id: int, *, actor: str | None = None) -> None:
    row = get_permit(db, permit_id)
    now = _utcnow()
    row.deleted_at = now
    row.updated_at = now
    db.commit()
    _audit(db, "permit.deleted", permit_id, actor, {})


# ─── people ────────────────────────────────────────────────────────────────────


def _new_person(payload: PermitPersonCreate) -> PermitPerson:
    return PermitPerson(
        name=payload.name,
        uae_id=payload.uae_id,
        nationality=payload.nationality,
        role=payload.role,
    )


def add_person(
    db: Session, permit_id: int, payload: PermitPersonCreate, *, actor: str | None = None
) -> Permit:
    row = get_permit(db, permit_id)
    if row.status == "revoked":
        raise ValidationFailedError(
            "PERMIT_REVOKED", "Cannot add people to a revoked permit.", id=permit_id
        )
    person = _new_person(payload)
    row.people.append(person)
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "permit.person_added", permit_id, actor, {"name": payload.name})
    regenerate_permit_book(db, get_permit(db, permit_id), actor=actor)
    return get_permit(db, permit_id)


def remove_person(
    db: Session, permit_id: int, person_id: int, *, actor: str | None = None
) -> Permit:
    row = get_permit(db, permit_id)
    person = next((p for p in row.people if p.id == person_id), None)
    if person is None:
        raise NotFoundError(
            "PERMIT_PERSON_NOT_FOUND",
            f"Person {person_id} is not on permit {permit_id}",
            permit_id=permit_id,
            person_id=person_id,
        )
    if person.removed_at is not None:
        raise ValidationFailedError(
            "PERMIT_PERSON_REMOVED",
            "This person has already been removed from the permit.",
            person_id=person_id,
        )
    person.removed_at = _utcnow()
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "permit.person_removed", permit_id, actor, {"person_id": person_id})
    regenerate_permit_book(db, get_permit(db, permit_id), actor=actor)
    return get_permit(db, permit_id)


# ─── vehicles ──────────────────────────────────────────────────────────────────


def _new_vehicle(payload: PermitVehicleCreate) -> PermitVehicle:
    return PermitVehicle(
        plate_no=payload.plate_no,
        plate_emirate=payload.plate_emirate,
        make_model=payload.make_model,
        driver_name=payload.driver_name,
        colour=payload.colour,
        vehicle_type=payload.vehicle_type,
        plate_category=payload.plate_category,
        traffic_no=payload.traffic_no,
        reg_expiry=payload.reg_expiry,
    )


def add_vehicle(
    db: Session, permit_id: int, payload: PermitVehicleCreate, *, actor: str | None = None
) -> Permit:
    row = get_permit(db, permit_id)
    if row.status == "revoked":
        raise ValidationFailedError(
            "PERMIT_REVOKED", "Cannot add vehicles to a revoked permit.", id=permit_id
        )
    row.vehicles.append(_new_vehicle(payload))
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "permit.vehicle_added", permit_id, actor, {"plate_no": payload.plate_no})
    regenerate_permit_book(db, get_permit(db, permit_id), actor=actor)
    return get_permit(db, permit_id)


def remove_vehicle(
    db: Session, permit_id: int, vehicle_id: int, *, actor: str | None = None
) -> Permit:
    row = get_permit(db, permit_id)
    vehicle = next((v for v in row.vehicles if v.id == vehicle_id), None)
    if vehicle is None:
        raise NotFoundError(
            "PERMIT_VEHICLE_NOT_FOUND",
            f"Vehicle {vehicle_id} is not on permit {permit_id}",
            permit_id=permit_id,
            vehicle_id=vehicle_id,
        )
    if vehicle.removed_at is not None:
        raise ValidationFailedError(
            "PERMIT_VEHICLE_REMOVED",
            "This vehicle has already been removed from the permit.",
            vehicle_id=vehicle_id,
        )
    vehicle.removed_at = _utcnow()
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "permit.vehicle_removed", permit_id, actor, {"vehicle_id": vehicle_id})
    regenerate_permit_book(db, get_permit(db, permit_id), actor=actor)
    return get_permit(db, permit_id)


# ─── visits (gate / UAE-ID hook) ───────────────────────────────────────────────


def list_visits(db: Session, permit_id: int, *, limit: int = 100) -> list[PermitVisit]:
    get_permit(db, permit_id, include_deleted=True)  # existence check
    stmt = (
        select(PermitVisit)
        .where(PermitVisit.permit_id == permit_id)
        .order_by(PermitVisit.occurred_at.desc(), PermitVisit.id.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all())


def record_visit(
    db: Session, permit_id: int, payload: PermitVisitCreate, *, actor: str | None = None
) -> PermitVisit:
    get_permit(db, permit_id)  # existence + not-deleted check
    visit = PermitVisit(
        permit_id=permit_id,
        person_id=payload.person_id,
        direction=payload.direction,
        occurred_at=payload.occurred_at or _utcnow(),
        uae_id=payload.uae_id,
        gate=payload.gate,
        source=payload.source,
    )
    db.add(visit)
    db.commit()
    db.refresh(visit)
    _audit(
        db,
        "permit.visit_recorded",
        permit_id,
        actor,
        {"direction": visit.direction, "source": visit.source},
    )
    return visit


# ─── summary + export ──────────────────────────────────────────────────────────


def summary(db: Session) -> dict[str, int]:
    today = date.today()
    rows, _ = list_permits(db, limit=100_000, offset=0)
    active = expiring = expired = revoked = 0
    people_active = people_green = people_red = people_work = 0
    for row in rows:
        ds = _derived_status(row, today=today)
        if ds == "active":
            active += 1
        elif ds == "expiring":
            expiring += 1
        elif ds == "expired":
            expired += 1
        elif ds == "revoked":
            revoked += 1
        # Head-count only counts people on currently-valid permits.
        if ds in ("active", "expiring"):
            n = len(_active_people(row))
            zones = row.zones or []
            people_active += n
            if "green" in zones:
                people_green += n
            if "red" in zones:
                people_red += n
            if "work_residence" in zones:
                people_work += n
    return {
        "active": active,
        "expiring": expiring,
        "expired": expired,
        "revoked": revoked,
        "people_active": people_active,
        "people_green": people_green,
        "people_red": people_red,
        "people_work_residence": people_work,
    }


# ─── permit paper (issued-scan attachment) ─────────────────────────────────────

MAX_DOCUMENT_BYTES = 25 * 1024 * 1024  # 25 MiB — parity with leave certificates.

# Path separators / control chars PLUS unicode bidi-control / zero-width / BOM
# codepoints that pass ``isalnum`` but enable filename display-name spoofing.
# Escapes (not inline literals) so the class stays legible. Mirrors leave_service.
_UNSAFE_CHARS = re.compile('[\\\\/:*?"<>|\x00-\x1f​-‏‪-‮⁦-⁩﻿]')


def _safe_filename(filename: str) -> str:
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = _UNSAFE_CHARS.sub("_", name).strip().strip(".")
    return name or "permit"


def attach_document(
    db: Session, permit_id: int, filename: str, data: bytes, *, actor: str | None = None
) -> Permit:
    """Attach (or replace) the scanned paper permit. Stored under the data dir."""
    row = get_permit(db, permit_id)
    if len(data) == 0:
        raise ValidationFailedError("PERMIT_DOC_EMPTY", "Uploaded file is empty.")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValidationFailedError(
            "PERMIT_DOC_TOO_LARGE",
            f"File exceeds {MAX_DOCUMENT_BYTES // (1024 * 1024)} MiB.",
            size=len(data),
        )
    data_dir = get_settings().data_dir
    dest_dir = data_dir / "permit_documents" / str(permit_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / _safe_filename(filename)
    dest.write_bytes(data)
    row.document_path = dest.relative_to(data_dir).as_posix()
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    _audit(db, "permit.document_attached", permit_id, actor, {"filename": dest.name})
    return get_permit(db, permit_id)


def get_document_file(db: Session, permit_id: int) -> Path:
    row = get_permit(db, permit_id, include_deleted=True)
    if not row.document_path:
        raise NotFoundError(
            "PERMIT_DOC_NOT_FOUND",
            f"Permit {permit_id} has no attached document.",
            id=permit_id,
        )
    path = get_settings().data_dir / row.document_path
    if not path.exists():
        raise NotFoundError(
            "PERMIT_DOC_MISSING",
            "The attached document file is missing on disk.",
            id=permit_id,
        )
    return path


def remove_document(db: Session, permit_id: int, *, actor: str | None = None) -> Permit:
    row = get_permit(db, permit_id)
    if row.document_path:
        row.document_path = None
        row.updated_at = _utcnow()
        db.commit()
        _audit(db, "permit.document_removed", permit_id, actor, {})
    return get_permit(db, permit_id)


def _store_entity_file(permit_id: int, subdir: str, filename: str, data: bytes) -> str:
    """Validate + persist an attachment under the permit's document tree.
    Returns the data-dir-relative path to store on the owning row."""
    if len(data) == 0:
        raise ValidationFailedError("PERMIT_DOC_EMPTY", "Uploaded file is empty.")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValidationFailedError(
            "PERMIT_DOC_TOO_LARGE",
            f"File exceeds {MAX_DOCUMENT_BYTES // (1024 * 1024)} MiB.",
            size=len(data),
        )
    data_dir = get_settings().data_dir
    dest_dir = data_dir / "permit_documents" / str(permit_id) / subdir
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / _safe_filename(filename)
    dest.write_bytes(data)
    return dest.relative_to(data_dir).as_posix()


def _resolve_file(rel_path: str | None, *, missing_code: str, permit_id: int) -> Path:
    if not rel_path:
        raise NotFoundError(missing_code, "No document attached.", id=permit_id)
    path = get_settings().data_dir / rel_path
    if not path.exists():
        raise NotFoundError(
            "PERMIT_DOC_MISSING",
            "The attached document file is missing on disk.",
            id=permit_id,
        )
    return path


def _find_person(row: Permit, person_id: int) -> PermitPerson:
    person = next((p for p in row.people if p.id == person_id), None)
    if person is None or person.removed_at is not None:
        raise NotFoundError(
            "PERMIT_PERSON_NOT_FOUND",
            f"Person {person_id} is not on permit {row.id}",
            permit_id=row.id,
            person_id=person_id,
        )
    return person


def _find_vehicle(row: Permit, vehicle_id: int) -> PermitVehicle:
    vehicle = next((v for v in row.vehicles if v.id == vehicle_id), None)
    if vehicle is None or vehicle.removed_at is not None:
        raise NotFoundError(
            "PERMIT_VEHICLE_NOT_FOUND",
            f"Vehicle {vehicle_id} is not on permit {row.id}",
            permit_id=row.id,
            vehicle_id=vehicle_id,
        )
    return vehicle


def _ocr_text(data: bytes) -> str | None:
    """Best-effort OCR of an uploaded scan to text. Reuses the shared OCR
    pipeline; returns None if OCR is unavailable or fails (never raises), so an
    upload always succeeds even without the OCR engine installed."""
    try:
        from app.core.extraction.ocr import (  # local import: OCR libs are optional
            OCR_GATE,
            extract_text,
            load_image,
            text_from_pdf,
        )
    except Exception:
        return None
    try:
        with OCR_GATE:
            if data[:4] == b"%PDF":
                return text_from_pdf(data)
            return extract_text(load_image(data)).text
    except Exception:
        return None


def _extract_uae_id(data: bytes) -> str | None:
    text = _ocr_text(data)
    if not text:
        return None
    try:
        from app.core.extraction.emirates_id import extract_emirates_id

        for field in extract_emirates_id(text).fields:
            if field.key == "uae_id_no":
                return field.value
    except Exception:
        return None
    return None


# Best-effort plate read: no dedicated mulkiya parser exists, so key off a
# "Plate/Traffic No" label followed by an optional 1-3 letter code + digits.
_PLATE_RE = re.compile(
    r"(?i)(?:traffic\s+)?plate\s*(?:no\.?|number|code)?\s*[:\-]?\s*([A-Z]{0,3}\s?\d{1,6})"
)


def _extract_plate(data: bytes) -> str | None:
    text = _ocr_text(data)
    if not text:
        return None
    m = _PLATE_RE.search(text)
    return m.group(1).strip() if m else None


def attach_person_document(
    db: Session,
    permit_id: int,
    person_id: int,
    filename: str,
    data: bytes,
    *,
    actor: str | None = None,
) -> Permit:
    """Attach (or replace) a scan of the person's UAE ID card. Opportunistically
    OCR-fills the UAE ID number when it is not already set."""
    row = get_permit(db, permit_id)
    person = _find_person(row, person_id)
    person.id_doc_path = _store_entity_file(permit_id, f"person_{person_id}", filename, data)
    extracted = None
    if not person.uae_id:
        extracted = _extract_uae_id(data)
        if extracted:
            person.uae_id = extracted
    row.updated_at = _utcnow()
    db.commit()
    _audit(
        db,
        "permit.person_id_attached",
        permit_id,
        actor,
        {"person_id": person_id, "ocr_uae_id": bool(extracted)},
    )
    return get_permit(db, permit_id)


def get_person_document_file(db: Session, permit_id: int, person_id: int) -> Path:
    row = get_permit(db, permit_id, include_deleted=True)
    person = next((p for p in row.people if p.id == person_id), None)
    if person is None:
        raise NotFoundError(
            "PERMIT_PERSON_NOT_FOUND",
            f"Person {person_id} is not on permit {permit_id}",
            permit_id=permit_id,
            person_id=person_id,
        )
    return _resolve_file(
        person.id_doc_path, missing_code="PERMIT_DOC_NOT_FOUND", permit_id=permit_id
    )


def scan_vehicle_licence(data: bytes) -> VehicleLicenceScan:
    """OCR a mulkiya image/PDF and return pre-fill fields."""
    from app.core.extraction.vehicle_licence import extract_vehicle_licence

    text = _ocr_text(data) or ""
    f = extract_vehicle_licence(text)
    owner = f.get("owner_name")
    return VehicleLicenceScan(
        plate_no=f.get("plate_no"),
        plate_emirate=f.get("plate_emirate"),
        plate_category=f.get("plate_category"),
        traffic_no=f.get("traffic_no"),
        make_model=f.get("make_model"),
        vehicle_type=f.get("vehicle_type"),
        colour=f.get("colour"),
        reg_expiry=f.get("reg_expiry"),
        driver_name=owner,
    )


def scan_emirates_id(data: bytes) -> PersonIdScan:
    """OCR an Emirates ID image/PDF and return pre-fill fields."""
    from app.core.extraction.emirates_id import extract_emirates_id

    text = _ocr_text(data) or ""
    fields = {fl.key: fl.value for fl in extract_emirates_id(text).fields}
    return PersonIdScan(
        name=fields.get("name_en") or fields.get("name_ar"),
        uae_id=fields.get("uae_id_no"),
        nationality=fields.get("nationality"),
    )


def attach_vehicle_document(
    db: Session,
    permit_id: int,
    vehicle_id: int,
    filename: str,
    data: bytes,
    *,
    actor: str | None = None,
) -> Permit:
    """Attach (or replace) a scan of the vehicle licence (mulkiya).
    Opportunistically OCR-fills the plate number and extended mulkiya fields
    when they are not already set, then regenerates the permit book if anything
    changed and a book has been issued."""
    row = get_permit(db, permit_id)
    vehicle = _find_vehicle(row, vehicle_id)
    vehicle.license_doc_path = _store_entity_file(
        permit_id, f"vehicle_{vehicle_id}", filename, data
    )
    extracted = None
    if not vehicle.plate_no:
        extracted = _extract_plate(data)
        if extracted:
            vehicle.plate_no = extracted
    changed = bool(extracted)
    filled = scan_vehicle_licence(data)
    for attr in (
        "plate_emirate",
        "plate_category",
        "traffic_no",
        "make_model",
        "vehicle_type",
        "colour",
        "reg_expiry",
    ):
        if getattr(vehicle, attr) in (None, "") and getattr(filled, attr):
            setattr(vehicle, attr, getattr(filled, attr))
            changed = True
    row.updated_at = _utcnow()
    db.commit()
    _audit(
        db,
        "permit.vehicle_license_attached",
        permit_id,
        actor,
        {"vehicle_id": vehicle_id, "ocr_plate": bool(extracted)},
    )
    if changed and row.book_id:
        regenerate_permit_book(db, get_permit(db, permit_id), actor=actor)
    return get_permit(db, permit_id)


def get_vehicle_document_file(db: Session, permit_id: int, vehicle_id: int) -> Path:
    row = get_permit(db, permit_id, include_deleted=True)
    vehicle = next((v for v in row.vehicles if v.id == vehicle_id), None)
    if vehicle is None:
        raise NotFoundError(
            "PERMIT_VEHICLE_NOT_FOUND",
            f"Vehicle {vehicle_id} is not on permit {permit_id}",
            permit_id=permit_id,
            vehicle_id=vehicle_id,
        )
    return _resolve_file(
        vehicle.license_doc_path, missing_code="PERMIT_DOC_NOT_FOUND", permit_id=permit_id
    )


# ─── audit ─────────────────────────────────────────────────────────────────────


def _audit(
    db: Session, action: str, permit_id: int, actor: str | None, payload: dict[str, Any]
) -> None:
    entry = AuditLog(
        actor=actor,
        action=action,
        entity_type="permit",
        entity_id=str(permit_id),
        payload=json.dumps(payload),
    )
    db.add(entry)
    db.commit()
