"""Armory core: write transactions, actors/witnesses, shift time and projections.

Every mutation runs inside :func:`write`: ``BEGIN IMMEDIATE`` before any read
that feeds a decision, then postings, projection updates and one audit row per
mutation commit together; any failure rolls everything back. Projection
changes go through ``armory_repo``'s guarded updates via :class:`PostingWriter`.

Slice modules (``armory_catalog_service``, ``armory_custody_service``,
``armory_audit_service``, ``armory_void_service``, ``armory_read_service``)
import this module and call ``armory_service.current_time()`` through the
module attribute so tests can pin the organization clock.
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Collection, Iterable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Final, Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import AppError, ConflictError, NotFoundError, ValidationFailedError
from app.core.clock import ORGANIZATION_TIMEZONE
from app.db.base import Base
from app.db.models import (
    ArmoryAssignment,
    ArmoryAssignmentLine,
    ArmoryBatch,
    ArmoryDecision,
    ArmoryDiscrepancy,
    ArmoryGuardQualification,
    ArmoryItem,
    ArmoryKit,
    ArmoryKitItem,
    ArmoryPosting,
    ArmoryPostingLine,
    ArmorySafe,
    ArmorySerial,
    ArmoryShiftPolicy,
    Employee,
    User,
    VehicleSite,
)
from app.db.repos import armory_repo
from app.db.repos._locking import begin_immediate_if_idle
from app.db.repos.audit_repo import append_audit
from app.schemas.armory import (
    ArmoryActorRead,
    ArmoryAssignmentLineRead,
    ArmoryAssignmentRead,
    ArmoryAssignmentSummary,
    ArmoryBatchRef,
    ArmoryCustodyReceiptRead,
    ArmoryDutyPostRead,
    ArmoryHolderRead,
    ArmoryItemRef,
    ArmoryMovementLineRead,
    ArmoryPersonRead,
    ArmoryPostingRead,
    ArmoryPostingRef,
    ArmoryQualificationRead,
    ArmorySafeRead,
    ArmorySerialRead,
    ArmoryShiftPolicyRead,
    ArmoryShiftWindowRead,
    ArmorySiteRead,
)
from app.schemas.employee import WORKING_STATUSES

TIME_ZONE: Final = "Asia/Dubai"
DEFAULT_DAY_START: Final = dt.time(6, 0)
DEFAULT_NIGHT_START: Final = dt.time(18, 0)
DEFAULT_GRACE_MINUTES: Final = 30
LICENCE_EXPIRING_DAYS: Final = 30
BATCH_EXPIRING_DAYS: Final = 60
NOTE_MIN: Final = 3
PAGE_SIZE_DEFAULT: Final = 50
PAGE_SIZE_MAX: Final = 100

RECORD_PREFIX: Final[dict[str, str]] = {
    "opening": "IN",
    "receipt": "IN",
    "serial_registration": "SR",
    "shift_issue": "SO",
    "custody": "CU",
    "return": "SI",
    "shift_check": "SC",
    "monthly_count": "MC",
    "serial_state": "ST",
    "decision": "DC",
}
ASSIGNMENT_POSTING_KINDS: Final = ("shift_issue", "custody")
WITNESSED_VOID_KINDS: Final = frozenset(
    {
        "opening",
        "receipt",
        "serial_registration",
        "custody",
        "return",
        "shift_check",
        "monthly_count",
        "serial_state",
        "decision",
    }
)

_WORKING = frozenset(WORKING_STATUSES)
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_CODE = re.compile(r"[A-Z0-9][A-Z0-9._/-]{0,79}")


# ── Clock ────────────────────────────────────────────────────────────────────


def current_time() -> dt.datetime:
    """Aware UTC now. Tests monkeypatch this module attribute."""
    return dt.datetime.now(dt.UTC)


def naive_utc(value: dt.datetime) -> dt.datetime:
    """Storage form: naive UTC."""
    if value.tzinfo is None:
        return value
    return value.astimezone(dt.UTC).replace(tzinfo=None)


def aware_utc(value: dt.datetime) -> dt.datetime:
    return value.replace(tzinfo=dt.UTC) if value.tzinfo is None else value.astimezone(dt.UTC)


def local_date(value: dt.datetime) -> dt.date:
    """Organization calendar date of an instant (naive values are UTC)."""
    return aware_utc(value).astimezone(ORGANIZATION_TIMEZONE).date()


def local_today(now: dt.datetime) -> dt.date:
    return local_date(now)


# ── Errors ───────────────────────────────────────────────────────────────────


def not_found(resource: str) -> NotFoundError:
    return NotFoundError("armory_not_found", "The record was not found.", resource=resource)


def invalid(field: str, message: str = "The request is not valid.") -> ValidationFailedError:
    return ValidationFailedError("armory_invalid_input", message, field=field)


def unprocessable(code: str, message: str, **details: Any) -> ValidationFailedError:
    return ValidationFailedError(code, message, **details)


def conflict(code: str, message: str, **details: Any) -> ConflictError:
    return ConflictError(code, message, **details)


def write_conflict() -> ConflictError:
    return conflict("armory_write_conflict", "Armory records changed meanwhile; refresh and retry.")


def insufficient_stock(
    *, safe_id: int, item_id: int, batch_id: int | None, available_qty: int
) -> ConflictError:
    return conflict(
        "armory_insufficient_stock",
        "Not enough stock in this safe.",
        safe_id=safe_id,
        item_id=item_id,
        batch_id=batch_id,
        available_qty=available_qty,
    )


def serial_unavailable(serial_id: int) -> ConflictError:
    return conflict(
        "armory_serial_unavailable", "This serial is not available.", serial_id=serial_id
    )


def get_or_404[T](db: Session, model: type[T], key: Any, resource: str) -> T:
    row = db.get(model, key)
    if row is None:
        raise not_found(resource)
    return row


# ── Transactions ─────────────────────────────────────────────────────────────


@contextmanager
def write(db: Session) -> Iterator[None]:
    """Lock, read, check and write as one serial step; roll back on any failure.

    A residual constraint violation (a race the service checks did not see,
    which ``BEGIN IMMEDIATE`` should make impossible) becomes a 409 with the
    closest stable code, never a 500.
    """
    if begin_immediate_if_idle(db):
        # Rows cached before the lock may predate another writer's commit
        # (sessions use expire_on_commit=False); re-read everything under it.
        db.expire_all()
    try:
        yield
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _integrity_error(str(exc.orig)) from exc
    except BaseException:
        db.rollback()
        raise


def _integrity_error(message: str) -> AppError:
    if "armory_serials.serial_code" in message or "uq_armory_serials_live_code" in message:
        return conflict(
            "armory_duplicate_serial", "This serial is already registered.", serial_code=None
        )
    if "uq_armory_assignments_open_firearm" in message:
        return conflict(
            "armory_firearm_already_held",
            "This person already holds a firearm.",
            assignment_id=None,
            assignment_kind=None,
            serial_id=None,
        )
    if "armory_postings.period_key" in message or "uq_armory_postings_live_period" in message:
        return conflict(
            "armory_period_already_recorded", "This period is already recorded.", count_id=None
        )
    if "armory_safes." in message or "uq_armory_safes" in message:
        return conflict("armory_duplicate_safe", "A safe with this name exists.", field=None)
    if "ck_armory_stock_on_hand" in message:
        return conflict(
            "armory_insufficient_stock",
            "Not enough stock in this safe.",
            safe_id=None,
            item_id=None,
            batch_id=None,
            available_qty=None,
        )
    return write_conflict()


# ── Normalization ────────────────────────────────────────────────────────────


def normalize_code(raw: str, field: str) -> str:
    """Serial/batch code: Eastern digits to ASCII, trimmed, uppercased, validated."""
    value = raw.translate(_DIGITS).strip().upper()
    if not _CODE.fullmatch(value):
        raise invalid(field, "Codes use letters, digits and . _ / - (up to 80 characters).")
    return value


def normalize_search(raw: str | None, *, max_length: int = 120) -> str:
    """Search text: Eastern digits to ASCII, trimmed and case-folded."""
    return (raw or "").translate(_DIGITS).strip().casefold()[:max_length]


def clean_text(value: str | None, field: str, *, min_length: int = 0, max_length: int = 500) -> str:
    text = (value or "").strip()
    if len(text) < max(min_length, 1) or len(text) > max_length:
        raise invalid(field)
    return text


def optional_text(value: str | None, field: str, *, max_length: int = 500) -> str | None:
    text = (value or "").strip()
    if not text:
        return None
    if len(text) > max_length:
        raise invalid(field)
    return text


def name_key(value: str) -> str:
    """Case-folded uniqueness key for English names."""
    return " ".join(value.split()).casefold()


def page_bounds(page: int, page_size: int) -> tuple[int, int, int]:
    """Validated ``(page, page_size, offset)``; out-of-range values are 422s."""
    if page < 1:
        raise invalid("page")
    if not 1 <= page_size <= PAGE_SIZE_MAX:
        raise invalid("page_size")
    return page, page_size, (page - 1) * page_size


def require_version(if_match: str | None, version: int) -> None:
    """Writes need ``If-Match: "<version>"`` (``"0"`` before a record exists)."""
    supplied = (if_match or "").strip()
    if supplied.startswith("W/"):
        supplied = supplied[2:]
    if supplied.strip('"') != str(version) or not supplied:
        raise AppError(
            "armory_version_mismatch",
            "This record changed; reload it and review before saving.",
            http_status=412,
            details={"version": version},
        )


def etag(version: int) -> str:
    return f'"{version}"'


# ── People: actors and witnesses ─────────────────────────────────────────────


def is_working(employee: Employee) -> bool:
    return employee.status in _WORKING


@dataclass(frozen=True, slots=True)
class Actor:
    """The authenticated user and their linked employee (if any)."""

    user: User
    employee: Employee | None

    @property
    def employee_id(self) -> str | None:
        return self.employee.id if self.employee is not None else None


def actor_for(db: Session, user: User, *, require_employee: bool) -> Actor:
    """Derive the acting identity from authentication, never from the request."""
    employee = db.get(Employee, user.employee_id) if user.employee_id else None
    if require_employee and (employee is None or not is_working(employee)):
        raise unprocessable(
            "armory_actor_employee_required",
            "Your account must be linked to an active employee to record this.",
        )
    return Actor(user=user, employee=employee)


def active_employee(db: Session, employee_id: str, *, resource: str = "employee") -> Employee:
    """An existing employee in a working status (holders, supervisors)."""
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise not_found(resource)
    if not is_working(employee):
        raise invalid(resource, "Former employees cannot receive new holdings.")
    return employee


def witness(
    db: Session,
    employee_id: str | None,
    *,
    actor: Actor,
    excluded: Collection[str | None] = (),
    required: bool = True,
) -> Employee | None:
    """An independent witness: active, not the actor's employee, not an involved person."""
    if employee_id is None:
        if required:
            raise unprocessable(
                "armory_invalid_witness",
                "An independent witness is required.",
                witness_employee_id=None,
            )
        return None
    employee = db.get(Employee, employee_id)
    blocked = {value for value in excluded if value}
    if actor.employee_id:
        blocked.add(actor.employee_id)
    if employee is None or not is_working(employee) or employee.id in blocked:
        raise unprocessable(
            "armory_invalid_witness",
            "Choose an active employee who is not the recorder or an involved person.",
            witness_employee_id=employee_id,
        )
    return employee


# ── Shift time ───────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class ShiftPolicy:
    id: int
    effective_on: dt.date | None
    day_start: dt.time
    night_start: dt.time
    grace_minutes: int


DEFAULT_POLICY: Final = ShiftPolicy(
    id=0,
    effective_on=None,
    day_start=DEFAULT_DAY_START,
    night_start=DEFAULT_NIGHT_START,
    grace_minutes=DEFAULT_GRACE_MINUTES,
)


@dataclass(frozen=True, slots=True)
class ShiftWindow:
    shift_date: dt.date
    shift_kind: Literal["day", "night"]
    starts_at: dt.datetime  # aware, organization zone
    ends_at: dt.datetime
    next_ends_at: dt.datetime
    grace_minutes: int

    @property
    def period_key(self) -> str:
        return f"{self.shift_date.isoformat()}:{self.shift_kind}"

    def contains(self, now: dt.datetime) -> bool:
        return self.starts_at <= aware_utc(now) < self.ends_at


def _policy(row: ArmoryShiftPolicy) -> ShiftPolicy:
    return ShiftPolicy(
        id=row.id,
        effective_on=row.effective_on,
        day_start=row.day_start,
        night_start=row.night_start,
        grace_minutes=row.grace_minutes,
    )


def policy_on(db: Session, day: dt.date) -> ShiftPolicy:
    """Settings in force on a local date: latest effective date, latest id wins."""
    row = db.scalar(
        select(ArmoryShiftPolicy)
        .where(ArmoryShiftPolicy.effective_on <= day)
        .order_by(ArmoryShiftPolicy.effective_on.desc(), ArmoryShiftPolicy.id.desc())
        .limit(1)
    )
    return DEFAULT_POLICY if row is None else _policy(row)


def pending_policy(db: Session, today: dt.date) -> ShiftPolicy | None:
    row = db.scalar(
        select(ArmoryShiftPolicy)
        .where(ArmoryShiftPolicy.effective_on > today)
        .order_by(ArmoryShiftPolicy.effective_on.desc(), ArmoryShiftPolicy.id.desc())
        .limit(1)
    )
    return None if row is None else _policy(row)


def settings_version(db: Session) -> int:
    latest = db.scalar(select(ArmoryShiftPolicy.id).order_by(ArmoryShiftPolicy.id.desc()))
    return int(latest or 0)


def policy_read(policy: ShiftPolicy) -> ArmoryShiftPolicyRead:
    return ArmoryShiftPolicyRead(
        day_start=policy.day_start.strftime("%H:%M"),
        night_start=policy.night_start.strftime("%H:%M"),
        grace_minutes=policy.grace_minutes,
        effective_on=policy.effective_on,
    )


def _at(day: dt.date, clock: dt.time) -> dt.datetime:
    return dt.datetime.combine(day, clock, tzinfo=ORGANIZATION_TIMEZONE)


def _bounds(
    db: Session, shift_date: dt.date, kind: Literal["day", "night"]
) -> tuple[dt.datetime, dt.datetime, int]:
    policy = policy_on(db, shift_date)
    if kind == "day":
        return (
            _at(shift_date, policy.day_start),
            _at(shift_date, policy.night_start),
            policy.grace_minutes,
        )
    following = policy_on(db, shift_date + dt.timedelta(days=1))
    return (
        _at(shift_date, policy.night_start),
        _at(shift_date + dt.timedelta(days=1), following.day_start),
        policy.grace_minutes,
    )


def window_for(db: Session, shift_date: dt.date, kind: Literal["day", "night"]) -> ShiftWindow:
    """One shift occurrence. Night belongs to its start date and ends at the next day start."""
    starts_at, ends_at, grace = _bounds(db, shift_date, kind)
    if kind == "day":
        _, next_ends_at, _ = _bounds(db, shift_date, "night")
    else:
        _, next_ends_at, _ = _bounds(db, shift_date + dt.timedelta(days=1), "day")
    return ShiftWindow(
        shift_date=shift_date,
        shift_kind=kind,
        starts_at=starts_at,
        ends_at=ends_at,
        next_ends_at=next_ends_at,
        grace_minutes=grace,
    )


def window_at(db: Session, now: dt.datetime) -> ShiftWindow:
    """The shift window ``[start, end)`` containing ``now``."""
    local = aware_utc(now).astimezone(ORGANIZATION_TIMEZONE)
    today = local.date()
    day = window_for(db, today, "day")
    if local < day.starts_at:
        return window_for(db, today - dt.timedelta(days=1), "night")
    if local < day.ends_at:
        return day
    return window_for(db, today, "night")


def previous_windows(db: Session, now: dt.datetime, *, days: int = 7) -> list[ShiftWindow]:
    """Windows starting on the last ``days`` local dates that have begun, newest first."""
    today = local_today(now)
    windows: list[ShiftWindow] = []
    for offset in range(days):
        day = today - dt.timedelta(days=offset)
        for kind in ("night", "day"):
            window = window_for(db, day, kind)
            if window.starts_at <= aware_utc(now):
                windows.append(window)
    return windows


def window_read(window: ShiftWindow) -> ArmoryShiftWindowRead:
    return ArmoryShiftWindowRead(
        time_zone=TIME_ZONE,
        shift_date=window.shift_date,
        shift_kind=window.shift_kind,
        starts_at=window.starts_at,
        ends_at=window.ends_at,
        next_ends_at=window.next_ends_at,
        grace_minutes=window.grace_minutes,
    )


def window_json(window: ShiftWindow) -> dict[str, Any]:
    """Immutable snapshot stored on issues and checks."""
    return {
        "time_zone": TIME_ZONE,
        "shift_date": window.shift_date.isoformat(),
        "shift_kind": window.shift_kind,
        "starts_at": window.starts_at.isoformat(),
        "ends_at": window.ends_at.isoformat(),
        "next_ends_at": window.next_ends_at.isoformat(),
        "grace_minutes": window.grace_minutes,
    }


def window_from_json(value: dict[str, Any]) -> ArmoryShiftWindowRead:
    return ArmoryShiftWindowRead.model_validate(value)


# ── Licence evidence ─────────────────────────────────────────────────────────


LicenceStatus = Literal["missing", "expired", "expiring", "valid"]


def licence_status(qualification: ArmoryGuardQualification | None, today: dt.date) -> LicenceStatus:
    """Expired before today; expiring today through +30 days inclusive."""
    if qualification is None or qualification.licence_expires_on is None:
        return "missing"
    expires = qualification.licence_expires_on
    if expires < today:
        return "expired"
    if expires <= today + dt.timedelta(days=LICENCE_EXPIRING_DAYS):
        return "expiring"
    return "valid"


def qualification_read(
    qualification: ArmoryGuardQualification | None, today: dt.date
) -> ArmoryQualificationRead:
    if qualification is None:
        return ArmoryQualificationRead(
            version=0,
            course_round=None,
            licence_number=None,
            licence_expires_on=None,
            licence_status="missing",
            licence_days_left=None,
            updated_at=None,
        )
    expires = qualification.licence_expires_on
    return ArmoryQualificationRead(
        version=qualification.version,
        course_round=qualification.course_round,
        licence_number=qualification.licence_number,
        licence_expires_on=expires,
        licence_status=licence_status(qualification, today),
        licence_days_left=None if expires is None else (expires - today).days,
        updated_at=qualification.updated_at,
    )


def batch_status(expires_on: dt.date, today: dt.date) -> Literal["expired", "expiring", "valid"]:
    """Expired before today; expiring today through +60 days inclusive."""
    if expires_on < today:
        return "expired"
    if expires_on <= today + dt.timedelta(days=BATCH_EXPIRING_DAYS):
        return "expiring"
    return "valid"


# ── Postings and guarded effects ─────────────────────────────────────────────


def record_ref(kind: str, posting_id: int) -> str:
    return f"{RECORD_PREFIX[kind]}-{posting_id:04d}"


def assignment_kind(posting_kind: str) -> Literal["shift", "custody"]:
    return "shift" if posting_kind == "shift_issue" else "custody"


class PostingWriter:
    """Builds one posting's evidence lines and applies their guarded effects.

    Use inside :func:`write`. Call :meth:`finish` once after the last line to
    bump ``stock_revision`` for every affected safe.
    """

    def __init__(self, db: Session, posting: ArmoryPosting) -> None:
        self.db = db
        self.posting = posting
        self.position = 0
        self.revised: set[int] = set()

    def _line(self, **values: Any) -> ArmoryPostingLine:
        self.position += 1
        line = ArmoryPostingLine(posting_id=self.posting.id, position=self.position, **values)
        self.db.add(line)
        self.db.flush()
        return line

    def stock(
        self,
        *,
        item_id: int,
        qty: int,
        delta: int,
        batch_id: int | None = None,
        safe_id: int | None = None,
        assignment_line_id: int | None = None,
        remaining_before: int | None = None,
        remaining_after: int | None = None,
        condition: str | None = None,
        fault_note: str | None = None,
    ) -> ArmoryPostingLine:
        """A quantity line; ``delta`` applies to the bucket of ``safe_id`` (default posting's)."""
        target = self.posting.safe_id if safe_id is None else safe_id
        row = armory_repo.stock_row(self.db, safe_id=target, item_id=item_id, batch_id=batch_id)
        available = row.on_hand
        moved = armory_repo.apply_stock_delta(self.db, row.id, delta)
        if moved is None:
            if delta < 0:
                raise insufficient_stock(
                    safe_id=target, item_id=item_id, batch_id=batch_id, available_qty=available
                )
            raise invalid("qty", "The quantity is too large.")
        if delta:
            self.revised.add(target)
        return self._line(
            item_id=item_id,
            batch_id=batch_id,
            qty=qty,
            stock_delta=delta,
            before_on_hand=moved[0],
            after_on_hand=moved[1],
            assignment_line_id=assignment_line_id,
            remaining_before=remaining_before,
            remaining_after=remaining_after,
            condition=condition,
            fault_note=fault_note,
        )

    def evidence(self, *, item_id: int, qty: int, **values: Any) -> ArmoryPostingLine:
        """A line with no stock or serial effect (e.g. a zero-count rounds return)."""
        return self._line(item_id=item_id, qty=qty, stock_delta=0, **values)

    def create_serial(self, *, item_id: int, code: str, at: dt.datetime) -> ArmorySerial:
        """Register a new in-safe serial at the posting's safe."""
        if armory_repo.live_serial_by_code(self.db, code) is not None:
            raise conflict(
                "armory_duplicate_serial", "This serial is already registered.", serial_code=code
            )
        serial = ArmorySerial(
            item_id=item_id,
            serial_code=code,
            safe_id=self.posting.safe_id,
            state="in_safe",
            state_at=naive_utc(at),
            last_posting_id=self.posting.id,
        )
        self.db.add(serial)
        self.db.flush()
        self._line(
            item_id=item_id,
            serial_id=serial.id,
            qty=1,
            stock_delta=0,
            before_state=None,
            after_state="in_safe",
            before_safe_id=None,
            after_safe_id=self.posting.safe_id,
        )
        self.revised.add(self.posting.safe_id)
        return serial

    def serial(
        self,
        serial: ArmorySerial,
        *,
        state: str,
        safe_id: int,
        at: dt.datetime,
        expected_state: str | None = None,
        expected_safe_id: int | None = None,
        expected_last_posting_id: int | None = None,
        assignment_line_id: int | None = None,
        remaining_before: int | None = None,
        remaining_after: int | None = None,
        condition: str | None = None,
        fault_note: str | None = None,
    ) -> ArmoryPostingLine:
        """Guarded serial transition from its current (or the stated expected) state."""
        self.db.refresh(serial)
        before_state = serial.state if expected_state is None else expected_state
        before_safe = serial.safe_id if expected_safe_id is None else expected_safe_id
        if before_state is None:
            raise serial_unavailable(serial.id)
        moved = armory_repo.transition_serial(
            self.db,
            serial.id,
            expected_state=before_state,
            expected_safe_id=before_safe,
            expected_last_posting_id=expected_last_posting_id,
            state=state,
            safe_id=safe_id,
            last_posting_id=self.posting.id,
            at=naive_utc(at),
        )
        if not moved:
            raise serial_unavailable(serial.id)
        self.revised.update(s for s in (before_safe, safe_id) if s is not None)
        return self._line(
            item_id=serial.item_id,
            serial_id=serial.id,
            qty=1,
            stock_delta=0,
            before_state=before_state,
            after_state=state,
            before_safe_id=before_safe,
            after_safe_id=safe_id,
            assignment_line_id=assignment_line_id,
            remaining_before=remaining_before,
            remaining_after=remaining_after,
            condition=condition,
            fault_note=fault_note,
        )

    def finish(self) -> None:
        armory_repo.bump_revisions(self.db, self.revised)


def new_posting(
    db: Session,
    *,
    kind: str,
    safe_id: int,
    actor: Actor,
    occurred_on: dt.date,
    occurred_at: dt.datetime | None,
    witness_employee_id: str | None = None,
    related_posting_id: int | None = None,
    reference: str | None = None,
    source: str | None = None,
    reason: str | None = None,
    note: str | None = None,
    serial_action: str | None = None,
    period_key: str | None = None,
    count_context: dict[str, Any] | None = None,
    now: dt.datetime | None = None,
) -> ArmoryPosting:
    """Stage a posting header. Pass the request's locked ``now`` (rule 8)."""
    posting = ArmoryPosting(
        kind=kind,
        safe_id=safe_id,
        related_posting_id=related_posting_id,
        occurred_on=occurred_on,
        occurred_at=None if occurred_at is None else naive_utc(occurred_at),
        created_at=naive_utc(now if now is not None else current_time()),
        created_by_id=actor.user.id,
        actor_employee_id=actor.employee_id,
        witness_employee_id=witness_employee_id,
        reference=reference,
        source=source,
        reason=reason,
        note=note,
        serial_action=serial_action,
        period_key=period_key,
        count_context=count_context,
    )
    db.add(posting)
    db.flush()
    return posting


def audit(
    db: Session,
    *,
    action: str,
    posting: ArmoryPosting | None,
    actor: Actor,
    entity_type: str = "armory_posting",
    entity_id: int | str | None = None,
    **payload: Any,
) -> None:
    """One audit row per mutation. No licence numbers, phones or raw payloads."""
    body: dict[str, Any] = {"actor_user_id": actor.user.id, "actor_employee_id": actor.employee_id}
    if posting is not None:
        body.update(
            posting_id=posting.id,
            record_ref=record_ref(posting.kind, posting.id),
            kind=posting.kind,
            safe_id=posting.safe_id,
            witness_employee_id=posting.witness_employee_id,
        )
    body.update(payload)
    append_audit(
        db,
        action=f"armory.{action}",
        entity_type=entity_type,
        entity_id=entity_id if entity_id is not None else (posting.id if posting else ""),
        actor=actor.user.email,
        payload=body,
    )


# ── Projection lookups (batch loaded, no N+1) ────────────────────────────────


class Lookup:
    """Request-scoped batch loader for labels referenced by read models.

    Call :meth:`prime` with every id a projection will touch, then use the
    accessors; unprimed ids fall back to one query each.
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        self._safes: dict[int, ArmorySafe] = {}
        self._sites: dict[int, VehicleSite] = {}
        self._employees: dict[str, Employee] = {}
        self._users: dict[int, User] = {}
        self._items: dict[int, ArmoryItem] = {}
        self._batches: dict[int, ArmoryBatch] = {}
        self._serials: dict[int, ArmorySerial] = {}
        self._kits: dict[int, ArmoryKit] = {}

    def _load(self, model: type[Base], cache: dict[Any, Any], ids: Iterable[Any]) -> None:
        missing = {key for key in ids if key is not None and key not in cache}
        if not missing:
            return
        pk = model.__mapper__.primary_key[0]
        attribute = str(pk.key)
        for row in self.db.scalars(select(model).where(pk.in_(missing))):
            cache[getattr(row, attribute)] = row

    def prime(
        self,
        *,
        safe_ids: Iterable[int | None] = (),
        employee_ids: Iterable[str | None] = (),
        user_ids: Iterable[int | None] = (),
        item_ids: Iterable[int | None] = (),
        batch_ids: Iterable[int | None] = (),
        serial_ids: Iterable[int | None] = (),
        kit_ids: Iterable[int | None] = (),
    ) -> Lookup:
        self._load(ArmorySerial, self._serials, list(serial_ids))
        self._load(ArmorySafe, self._safes, list(safe_ids))
        self._load(VehicleSite, self._sites, [s.vehicle_site_id for s in self._safes.values()])
        users = list(user_ids)
        self._load(User, self._users, users)
        self._load(
            Employee,
            self._employees,
            [*employee_ids, *(u.employee_id for u in self._users.values())],
        )
        items = [*item_ids, *(s.item_id for s in self._serials.values())]
        self._load(ArmoryBatch, self._batches, list(batch_ids))
        self._load(ArmoryItem, self._items, [*items, *(b.item_id for b in self._batches.values())])
        self._load(ArmoryKit, self._kits, list(kit_ids))
        return self

    def safe_row(self, safe_id: int) -> ArmorySafe:
        self._load(ArmorySafe, self._safes, [safe_id])
        return self._safes[safe_id]

    def safe(self, safe_id: int) -> ArmorySafeRead:
        safe = self.safe_row(safe_id)
        site = None
        if safe.vehicle_site_id is not None:
            self._load(VehicleSite, self._sites, [safe.vehicle_site_id])
            row = self._sites[safe.vehicle_site_id]
            site = ArmorySiteRead(id=row.id, name_en=row.name_en, name_ar=row.name_ar)
        duty = (
            ArmoryDutyPostRead(duty_unit=safe.duty_unit, duty_post=safe.duty_post)
            if safe.duty_unit is not None and safe.duty_post is not None
            else None
        )
        return ArmorySafeRead(
            id=safe.id,
            name_en=safe.name_en,
            name_ar=safe.name_ar,
            vehicle_site=site,
            duty_post=duty,
            created_at=safe.created_at,
        )

    def employee_row(self, employee_id: str) -> Employee | None:
        self._load(Employee, self._employees, [employee_id])
        return self._employees.get(employee_id)

    def person(self, employee_id: str | None) -> ArmoryPersonRead | None:
        if employee_id is None:
            return None
        employee = self.employee_row(employee_id)
        if employee is None:
            return None
        return person_read(employee)

    def actor(self, user_id: int | None) -> ArmoryActorRead | None:
        if user_id is None:
            return None
        self._load(User, self._users, [user_id])
        user = self._users.get(user_id)
        if user is None:
            return ArmoryActorRead(user_id=user_id, employee=None, display_name=None)
        employee = self.person(user.employee_id)
        name = user.display_name or (employee.name_en if employee else None)
        return ArmoryActorRead(user_id=user.id, employee=employee, display_name=name)

    def recorded_actor(self, posting: ArmoryPosting) -> ArmoryActorRead:
        """Recorder as posted: the user plus the employee captured on the posting.

        Relinking an account later must not rewrite who recorded the evidence.
        """
        actor = self.actor(posting.created_by_id)
        assert actor is not None
        employee = self.person(posting.actor_employee_id)
        if employee == actor.employee:
            return actor
        return actor.model_copy(update={"employee": employee})

    def item_row(self, item_id: int) -> ArmoryItem:
        self._load(ArmoryItem, self._items, [item_id])
        return self._items[item_id]

    def item(self, item_id: int) -> ArmoryItemRef:
        return item_ref(self.item_row(item_id))

    def batch(self, batch_id: int | None) -> ArmoryBatchRef | None:
        if batch_id is None:
            return None
        self._load(ArmoryBatch, self._batches, [batch_id])
        row = self._batches[batch_id]
        return ArmoryBatchRef(id=row.id, batch_ref=row.batch_ref, expires_on=row.expires_on)

    def serial_row(self, serial_id: int | None) -> ArmorySerial | None:
        if serial_id is None:
            return None
        self._load(ArmorySerial, self._serials, [serial_id])
        return self._serials.get(serial_id)

    def kit(self, kit_id: int) -> ArmoryKit:
        self._load(ArmoryKit, self._kits, [kit_id])
        return self._kits[kit_id]


def person_read(employee: Employee) -> ArmoryPersonRead:
    return ArmoryPersonRead(
        employee_id=employee.id,
        name_en=employee.name_en,
        name_ar=employee.name_ar,
        employee_status=employee.status,
        is_former=not is_working(employee),
    )


def item_ref(item: ArmoryItem) -> ArmoryItemRef:
    return ArmoryItemRef.model_validate(item)


def posting_ref(posting: ArmoryPosting) -> ArmoryPostingRef:
    return ArmoryPostingRef(
        id=posting.id,
        record_ref=record_ref(posting.kind, posting.id),
        kind=posting.kind,
        safe_id=posting.safe_id,
        occurred_on=posting.occurred_on,
        occurred_at=posting.occurred_at,
        voided_at=posting.voided_at,
    )


# ── Assignments ──────────────────────────────────────────────────────────────


def overdue_minutes(
    *, kind: str, active: bool, due_at: dt.datetime | None, grace: int | None, now: dt.datetime
) -> int | None:
    """Elapsed minutes since due, only once ``now > due + grace`` on an open shift record."""
    if kind != "shift_issue" or not active or due_at is None:
        return None
    due = aware_utc(due_at)
    if aware_utc(now) <= due + dt.timedelta(minutes=grace or 0):
        return None
    return int((aware_utc(now) - due).total_seconds() // 60)


def changed_kit(kit: ArmoryKit, lines: Sequence[ArmoryAssignmentLine]) -> bool:
    """Whether recorded non-firearm lines differ from the kit's default template."""
    if kit.firearm_item_id is None:
        return False
    defaults = {row.item_id: row.default_qty for row in kit.lines if row.role == "default"}
    substitutes = {
        row.item_id: row.substitutes_item_id for row in kit.lines if row.role == "alternative"
    }
    actual: dict[int, int] = {}
    for line in lines:
        if line.item_id == kit.firearm_item_id:
            continue
        key = substitutes.get(line.item_id) or line.item_id
        actual[key] = actual.get(key, 0) + line.qty
    return actual != defaults


@dataclass(slots=True)
class _AssignmentContext:
    posting: ArmoryPosting
    assignment: ArmoryAssignment
    lines: list[ArmoryAssignmentLine]
    returns: list[ArmoryPosting]


def _assignment_contexts(
    db: Session, assignments: Sequence[ArmoryAssignment]
) -> list[_AssignmentContext]:
    ids = [row.posting_id for row in assignments]
    if not ids:
        return []
    postings = {
        row.id: row for row in db.scalars(select(ArmoryPosting).where(ArmoryPosting.id.in_(ids)))
    }
    lines: dict[int, list[ArmoryAssignmentLine]] = {key: [] for key in ids}
    for line in db.scalars(
        select(ArmoryAssignmentLine)
        .where(ArmoryAssignmentLine.assignment_id.in_(ids))
        .order_by(ArmoryAssignmentLine.assignment_id, ArmoryAssignmentLine.position)
    ):
        lines[line.assignment_id].append(line)
    returns: dict[int, list[ArmoryPosting]] = {key: [] for key in ids}
    for row in db.scalars(
        select(ArmoryPosting)
        .where(ArmoryPosting.related_posting_id.in_(ids), ArmoryPosting.kind == "return")
        .order_by(ArmoryPosting.id)
    ):
        assert row.related_posting_id is not None
        returns[row.related_posting_id].append(row)
    return [
        _AssignmentContext(
            postings[row.posting_id], row, lines[row.posting_id], returns[row.posting_id]
        )
        for row in assignments
    ]


def assignment_state(
    posting: ArmoryPosting, lines: Sequence[ArmoryAssignmentLine]
) -> Literal["active", "ended", "voided"]:
    if posting.voided_at is not None:
        return "voided"
    return "active" if any(line.remaining_qty > 0 for line in lines) else "ended"


def _holder(lookup: Lookup, assignment: ArmoryAssignment) -> ArmoryHolderRead:
    return ArmoryHolderRead(
        kind=assignment.holder_kind,
        employee=lookup.person(assignment.holder_employee_id),
        site_safe=None
        if assignment.holder_safe_id is None
        else lookup.safe(assignment.holder_safe_id),
        supervisor=lookup.person(assignment.supervisor_employee_id),
    )


def _prime_assignments(lookup: Lookup, contexts: Sequence[_AssignmentContext]) -> None:
    lookup.prime(
        safe_ids=[
            safe for c in contexts for safe in (c.posting.safe_id, c.assignment.holder_safe_id)
        ],
        employee_ids=[
            person
            for c in contexts
            for person in (c.assignment.holder_employee_id, c.assignment.supervisor_employee_id)
        ],
        user_ids=[
            user
            for c in contexts
            for user in (
                c.posting.created_by_id,
                c.posting.voided_by_id,
                *(r.created_by_id for r in c.returns),
            )
        ],
        item_ids=[line.item_id for c in contexts for line in c.lines],
        batch_ids=[line.batch_id for c in contexts for line in c.lines],
        serial_ids=[line.serial_id for c in contexts for line in c.lines],
        kit_ids=[c.assignment.kit_id for c in contexts],
    )


def _summary(
    lookup: Lookup, context: _AssignmentContext, now: dt.datetime
) -> ArmoryAssignmentSummary:
    posting, assignment, lines = context.posting, context.assignment, context.lines
    state = assignment_state(posting, lines)
    issuer = lookup.recorded_actor(posting)
    assert issuer is not None
    line_reads = []
    for line in lines:
        serial = lookup.serial_row(line.serial_id)
        line_reads.append(
            ArmoryAssignmentLineRead(
                id=line.id,
                item=lookup.item(line.item_id),
                qty=line.qty,
                remaining_qty=line.remaining_qty,
                serial_id=line.serial_id,
                serial_code=serial.serial_code if serial else None,
                batch=lookup.batch(line.batch_id),
            )
        )
    return ArmoryAssignmentSummary(
        id=posting.id,
        record_ref=record_ref(posting.kind, posting.id),
        kind=assignment_kind(posting.kind),
        state=state,
        safe=lookup.safe(posting.safe_id),
        holder=_holder(lookup, assignment),
        issuer=issuer,
        issued_at=posting.occurred_at or posting.created_at,
        due_at=assignment.due_at,
        overdue_minutes=overdue_minutes(
            kind=posting.kind,
            active=state == "active",
            due_at=assignment.due_at,
            grace=assignment.grace_minutes,
            now=now,
        ),
        licence_warning_acknowledged=assignment.licence_warning_acknowledged,
        changed_kit=changed_kit(lookup.kit(assignment.kit_id), lines),
        lines=line_reads,
    )


def assignment_summaries(
    db: Session,
    assignments: Sequence[ArmoryAssignment],
    now: dt.datetime,
    lookup: Lookup | None = None,
) -> list[ArmoryAssignmentSummary]:
    lookup = lookup or Lookup(db)
    contexts = _assignment_contexts(db, assignments)
    _prime_assignments(lookup, contexts)
    return [_summary(lookup, context, now) for context in contexts]


def assignment_read(
    db: Session, assignment_id: int, now: dt.datetime, *, kind: str | None = None
) -> ArmoryAssignmentRead:
    """Full record; ``kind`` restricts to ``shift_issue`` or ``custody`` (else 404)."""
    assignment = db.get(ArmoryAssignment, assignment_id)
    posting = db.get(ArmoryPosting, assignment_id) if assignment else None
    resource = (
        "issue" if kind == "shift_issue" else "custody" if kind == "custody" else "assignment"
    )
    if assignment is None or posting is None or (kind is not None and posting.kind != kind):
        raise not_found(resource)
    lookup = Lookup(db)
    [context] = _assignment_contexts(db, [assignment])
    _prime_assignments(lookup, [context])
    summary = _summary(lookup, context, now)
    live_returns = [row for row in context.returns if row.voided_at is None]
    closing = live_returns[-1] if summary.state == "ended" and live_returns else None
    return ArmoryAssignmentRead(
        **summary.model_dump(),
        kit_id=assignment.kit_id,
        course_round_snapshot=assignment.course_round_snapshot,
        licence_status_at_issue=assignment.licence_status_at_issue,
        shift_window=None
        if assignment.shift_window is None
        else window_from_json(assignment.shift_window),
        grace_minutes=assignment.grace_minutes,
        off_duty_reason=assignment.off_duty_reason,
        off_duty_note=assignment.off_duty_note,
        excess_rounds_reason=assignment.excess_rounds_reason,
        condition_note=posting.note if posting.kind == "custody" else None,
        ended_at=None if closing is None else (closing.occurred_at or closing.created_at),
        ended_by=None if closing is None else lookup.recorded_actor(closing),
        return_ids=[row.id for row in context.returns],
        voided_at=posting.voided_at,
        voided_by=lookup.actor(posting.voided_by_id),
        void_reason=posting.void_reason,
        receipt=None
        if assignment.receipt_snapshot is None
        else ArmoryCustodyReceiptRead.model_validate(assignment.receipt_snapshot),
    )


# ── Serials ──────────────────────────────────────────────────────────────────


def serial_reads(
    db: Session, serials: Sequence[ArmorySerial], now: dt.datetime, lookup: Lookup | None = None
) -> list[ArmorySerialRead]:
    """Serial cards with the live holder and overdue minutes of any open line."""
    lookup = lookup or Lookup(db)
    open_lines = armory_repo.open_lines_for_serials(db, [row.id for row in serials])
    assignments = {
        row.posting_id: row
        for row in db.scalars(
            select(ArmoryAssignment).where(
                ArmoryAssignment.posting_id.in_(
                    {line.assignment_id for line in open_lines.values()}
                )
            )
        )
    }
    postings = {
        row.id: row
        for row in db.scalars(select(ArmoryPosting).where(ArmoryPosting.id.in_(list(assignments))))
    }
    lookup.prime(
        safe_ids=[
            *(row.safe_id for row in serials),
            *(row.holder_safe_id for row in assignments.values()),
        ],
        employee_ids=[
            person
            for row in assignments.values()
            for person in (row.holder_employee_id, row.supervisor_employee_id)
        ],
        item_ids=[row.item_id for row in serials],
    )
    reads = []
    for serial in serials:
        line = open_lines.get(serial.id)
        assignment = assignments.get(line.assignment_id) if line else None
        posting = postings.get(assignment.posting_id) if assignment else None
        reads.append(
            ArmorySerialRead(
                id=serial.id,
                item=lookup.item(serial.item_id),
                serial_code=serial.serial_code,
                safe=None if serial.safe_id is None else lookup.safe(serial.safe_id),
                state=serial.state,
                state_at=serial.state_at,
                last_posting_id=serial.last_posting_id,
                assignment_id=assignment.posting_id if assignment else None,
                holder=_holder(lookup, assignment) if assignment else None,
                overdue_minutes=None
                if posting is None or assignment is None
                else overdue_minutes(
                    kind=posting.kind,
                    active=posting.voided_at is None,
                    due_at=assignment.due_at,
                    grace=assignment.grace_minutes,
                    now=now,
                ),
            )
        )
    return reads


# ── Postings ─────────────────────────────────────────────────────────────────


def posting_reads(
    db: Session, postings: Sequence[ArmoryPosting], lookup: Lookup | None = None
) -> list[ArmoryPostingRead]:
    """Movement detail with lines, people and linked discrepancy ids, batch loaded."""
    lookup = lookup or Lookup(db)
    ids = [row.id for row in postings]
    lines: dict[int, list[ArmoryPostingLine]] = {key: [] for key in ids}
    for line in db.scalars(
        select(ArmoryPostingLine)
        .where(ArmoryPostingLine.posting_id.in_(ids))
        .order_by(ArmoryPostingLine.posting_id, ArmoryPostingLine.position)
    ):
        lines[line.posting_id].append(line)
    discrepancy_ids: dict[int, list[int]] = {key: [] for key in ids}
    for discrepancy_id, source_id in db.execute(
        select(ArmoryDiscrepancy.id, ArmoryDiscrepancy.source_posting_id)
        .where(ArmoryDiscrepancy.source_posting_id.in_(ids))
        .order_by(ArmoryDiscrepancy.id)
    ):
        discrepancy_ids[source_id].append(discrepancy_id)
    decisions = {
        row.posting_id: row
        for row in db.scalars(select(ArmoryDecision).where(ArmoryDecision.posting_id.in_(ids)))
    }
    decided = {
        row.id: row
        for row in db.scalars(
            select(ArmoryDiscrepancy).where(
                ArmoryDiscrepancy.id.in_({row.discrepancy_id for row in decisions.values()})
            )
        )
    }
    assignment_ids = {
        row.id if row.kind in ASSIGNMENT_POSTING_KINDS else row.related_posting_id
        for row in postings
        if row.kind in (*ASSIGNMENT_POSTING_KINDS, "return")
    }
    assignments = {
        row.posting_id: row
        for row in db.scalars(
            select(ArmoryAssignment).where(ArmoryAssignment.posting_id.in_(assignment_ids))
        )
    }
    all_lines = [line for group in lines.values() for line in group]
    lookup.prime(
        safe_ids=[
            *(row.safe_id for row in postings),
            *(line.after_safe_id for line in all_lines),
        ],
        employee_ids=[
            person
            for row in postings
            for person in (row.witness_employee_id, row.void_witness_employee_id)
        ]
        + [
            person
            for row in assignments.values()
            for person in (row.holder_employee_id, row.supervisor_employee_id)
        ]
        + [row.involved_employee_id for row in decided.values()],
        user_ids=[user for row in postings for user in (row.created_by_id, row.voided_by_id)],
        item_ids=[line.item_id for line in all_lines],
        batch_ids=[line.batch_id for line in all_lines],
        serial_ids=[line.serial_id for line in all_lines],
    )
    reads = []
    for posting in postings:
        person_id: str | None = None
        if posting.kind in (*ASSIGNMENT_POSTING_KINDS, "return"):
            key = (
                posting.id
                if posting.kind in ASSIGNMENT_POSTING_KINDS
                else posting.related_posting_id
            )
            assignment = assignments.get(key) if key is not None else None
            if assignment is not None:
                person_id = assignment.holder_employee_id or assignment.supervisor_employee_id
        decision = decisions.get(posting.id)
        if decision is not None:
            person_id = decided[decision.discrepancy_id].involved_employee_id
        destination = next(
            (
                line.after_safe_id
                for line in lines[posting.id]
                if posting.serial_action == "transfer"
                and line.after_safe_id is not None
                and line.after_safe_id != posting.safe_id
            ),
            None,
        )
        actor = lookup.recorded_actor(posting)
        assert actor is not None
        reads.append(
            ArmoryPostingRead(
                **posting_ref(posting).model_dump(),
                safe=lookup.safe(posting.safe_id),
                destination_safe=None if destination is None else lookup.safe(destination),
                related_posting_id=posting.related_posting_id,
                created_at=posting.created_at,
                actor=actor,
                witness=lookup.person(posting.witness_employee_id),
                person=lookup.person(person_id),
                reference=posting.reference,
                source=posting.source,
                reason=posting.reason,
                note=posting.note,
                serial_action=posting.serial_action,
                decision_outcome=None if decision is None else decision.outcome,
                voided_by=lookup.actor(posting.voided_by_id),
                void_reason=posting.void_reason,
                void_witness=lookup.person(posting.void_witness_employee_id),
                lines=[_movement_line(lookup, line) for line in lines[posting.id]],
                discrepancy_ids=(
                    discrepancy_ids[posting.id] if decision is None else [decision.discrepancy_id]
                ),
            )
        )
    return reads


def _movement_line(lookup: Lookup, line: ArmoryPostingLine) -> ArmoryMovementLineRead:
    serial = lookup.serial_row(line.serial_id)
    return ArmoryMovementLineRead(
        id=line.id,
        item=lookup.item(line.item_id),
        qty=line.qty,
        serial_id=line.serial_id,
        serial_code=serial.serial_code if serial else None,
        batch=lookup.batch(line.batch_id),
        stock_delta=line.stock_delta,
        before_on_hand=line.before_on_hand,
        after_on_hand=line.after_on_hand,
        before_state=line.before_state,
        after_state=line.after_state,
        before_safe_id=line.before_safe_id,
        after_safe_id=line.after_safe_id,
        assignment_line_id=line.assignment_line_id,
        remaining_before=line.remaining_before,
        remaining_after=line.remaining_after,
        condition=line.condition,
        fault_note=line.fault_note,
    )


def posting_read(db: Session, posting_id: int) -> ArmoryPostingRead:
    posting = get_or_404(db, ArmoryPosting, posting_id, "movement")
    return posting_reads(db, [posting])[0]


def kit_lines(db: Session, kit_id: int) -> list[ArmoryKitItem]:
    return list(
        db.scalars(
            select(ArmoryKitItem)
            .where(ArmoryKitItem.kit_id == kit_id)
            .order_by(ArmoryKitItem.item_id)
        )
    )
