"""Page-atomic import of normalized attendance provider facts.

The importer has no network knowledge and never commits its caller's transaction.  A
production provider is deliberately not resolved here; callers must supply a verified
adapter implementing :class:`AttendanceProvider`.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.workforce_models import (
    AttendanceCase,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendanceSyncState,
)
from app.services.attendance_provider import (
    AttendanceProvider,
    ProviderPage,
    ProviderPerson,
    ProviderPunch,
)

T = TypeVar("T")


class ProviderContractDriftError(RuntimeError):
    """A supposedly immutable provider event changed under its stable identity."""

    code = "PROVIDER_CONTRACT_DRIFT"

    def __init__(self) -> None:
        super().__init__("Provider contract drift detected for an immutable event")


class ProviderSyncFailedError(RuntimeError):
    """A provider transport/protocol failure, stripped of vendor detail.

    The original exception is deliberately NOT chained: HTTP client errors
    embed the request URL (and often the response body) in their message, and
    the caller logs failures with a traceback. Raising this instead keeps the
    provider endpoint and any URL- or body-borne secret out of the log sink,
    matching the sanitized summary already written to the sync-state row.
    """

    code = "PROVIDER_SYNC_FAILED"

    def __init__(self, stream: str) -> None:
        self.stream = stream
        super().__init__(f"Provider {stream} page import failed")


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _naive_utc(value: datetime) -> datetime:
    return _aware_utc(value).replace(tzinfo=None)


def _state(db: Session, *, provider: str, stream: str) -> AttendanceSyncState:
    state = db.get(AttendanceSyncState, {"provider": provider, "stream": stream})
    if state is None:
        state = AttendanceSyncState(provider=provider, stream=stream)
        db.add(state)
    return state


def _normalize_direction(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    return normalized if normalized in {"in", "out"} else "unknown"


def _normalized_punch_hash(punch: ProviderPunch) -> str:
    """Hash only the normalized immutable contract fields, never a vendor payload."""

    payload = {
        "device_id": punch.device_id,
        "device_name": punch.device_name,
        "direction": _normalize_direction(punch.direction),
        "external_event_id": punch.external_event_id,
        "external_person_id": punch.external_person_id,
        "occurred_at": _aware_utc(punch.occurred_at).isoformat(),
        "source_updated_at": (
            _aware_utc(punch.source_updated_at).isoformat()
            if punch.source_updated_at is not None
            else None
        ),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256(encoded.encode("utf-8")).hexdigest()


def _advance_fresh_through(
    state: AttendanceSyncState, fresh_through: datetime | None
) -> tuple[datetime | None, datetime | None]:
    previous = state.fresh_through
    if fresh_through is None:
        return previous, previous
    candidate = _naive_utc(fresh_through)
    if previous is None or _aware_utc(candidate) > _aware_utc(previous):
        state.fresh_through = candidate
    return previous, state.fresh_through


def _finish_success(
    state: AttendanceSyncState, *, now: datetime, imported_count: int
) -> None:
    state.last_success_at = _naive_utc(now)
    state.last_import_count = imported_count
    state.last_error_code = None
    state.last_error_summary = None
    state.consecutive_failures = 0


def _record_failure(state: AttendanceSyncState, *, code: str, summary: str) -> None:
    state.last_error_code = code
    state.last_error_summary = summary
    state.consecutive_failures += 1


def _validate_page[T](page: ProviderPage[T]) -> None:
    """Reject cursor states which cannot be safely resumed by a bounded importer."""

    if page.exhausted and page.next_cursor is not None:
        raise ValueError("Provider page marked exhausted with a next cursor")
    if not page.exhausted and page.next_cursor is None:
        raise ValueError("Provider page is not exhausted but has no next cursor")


def _upsert_person(
    db: Session, *, provider: str, person: ProviderPerson, seen_at: datetime
) -> AttendanceProviderPerson:
    row = db.scalar(
        select(AttendanceProviderPerson).where(
            AttendanceProviderPerson.provider == provider,
            AttendanceProviderPerson.external_person_id == person.external_person_id,
        )
    )
    if row is None:
        row = AttendanceProviderPerson(
            provider=provider,
            external_person_id=person.external_person_id,
            external_employee_code=person.external_employee_code,
            display_name_snapshot=person.display_name_snapshot,
            mapping_state="unmapped",
            active=person.active,
            first_seen_at=seen_at,
            last_seen_at=seen_at,
        )
        db.add(row)
        return row

    # Provider refreshes only provider-owned snapshots.  No import can infer, clear, or replace a
    # Sentinel mapping; verified state and its audit fields are therefore left untouched.
    row.external_employee_code = person.external_employee_code
    row.display_name_snapshot = person.display_name_snapshot
    row.active = person.active
    row.last_seen_at = seen_at
    return row


def _provider_person_for_punch(
    db: Session, *, provider: str, external_person_id: str, seen_at: datetime
) -> AttendanceProviderPerson:
    row = db.scalar(
        select(AttendanceProviderPerson).where(
            AttendanceProviderPerson.provider == provider,
            AttendanceProviderPerson.external_person_id == external_person_id,
        )
    )
    if row is not None:
        row.last_seen_at = seen_at
        return row

    # A punch may arrive before its people page.  Preserve the immutable fact under an explicit,
    # unmapped mirror instead of dropping it or trusting an employee-code heuristic.
    row = AttendanceProviderPerson(
        provider=provider,
        external_person_id=external_person_id,
        mapping_state="unmapped",
        active=True,
        first_seen_at=seen_at,
        last_seen_at=seen_at,
    )
    db.add(row)
    db.flush()
    return row


def _enqueue_imported_punch(db: Session, *, punch: AttendancePunch, now: datetime) -> None:
    """Queue the presently selected case without inventing a broad evaluation window."""

    from app.services.attendance_punch_service import select_punch_case

    case = select_punch_case(db, punch=punch)
    if case is None:
        return
    from app.services.attendance_queue_service import enqueue_evaluation
    enqueue_evaluation(
        db,
        employee_id=case.employee_id,
        window_start_at=_aware_utc(case.scheduled_start_at),
        window_end_at=_aware_utc(case.scheduled_end_at),
        reason_code="PUNCH_IMPORTED",
        now=now,
    )


def _enqueue_completed_freshness_crossing(
    db: Session,
    *,
    previous_fresh_through: datetime | None,
    fresh_through: datetime | None,
    now: datetime,
) -> None:
    if fresh_through is None:
        return
    if previous_fresh_through is not None and _aware_utc(fresh_through) <= _aware_utc(
        previous_fresh_through
    ):
        return

    employee_ids = db.scalars(select(AttendanceCase.employee_id).distinct()).all()
    if not employee_ids:
        return

    from app.services.attendance_queue_service import enqueue_freshness_boundary_crossings

    for employee_id in employee_ids:
        enqueue_freshness_boundary_crossings(
            db,
            employee_id=employee_id,
            previous_fresh_through=(
                _aware_utc(previous_fresh_through)
                if previous_fresh_through is not None
                else None
            ),
            fresh_through=_aware_utc(fresh_through),
            now=now,
        )


def sync_people(db: Session, *, provider: AttendanceProvider, now: datetime) -> int:
    """Import exactly one provider people page and atomically advance its cursor."""

    provider_code = provider.code
    persisted_now = _naive_utc(now)
    state = _state(db, provider=provider_code, stream="people")
    state.last_attempt_at = persisted_now
    cursor = state.cursor
    try:
        page = provider.list_people(cursor=cursor)
        _validate_page(page)
        with db.begin_nested():
            for person in page.items:
                _upsert_person(db, provider=provider_code, person=person, seen_at=persisted_now)
            state.cursor = None if page.exhausted else page.next_cursor
            _advance_fresh_through(state, page.fresh_through)
            _finish_success(state, now=now, imported_count=len(page.items))
            db.flush()
    except ProviderContractDriftError:
        raise
    except Exception:
        _record_failure(
            state,
            code="PROVIDER_SYNC_FAILED",
            summary="Provider people page import failed",
        )
        db.flush()
        # `from None` on purpose: the vendor exception may carry the provider
        # URL or response body, and the caller logs with a traceback.
        raise ProviderSyncFailedError("people") from None
    return len(page.items)


#: One window is paged to exhaustion before the next one opens, so an initial
#: backfill of months walks forward in bounded steps instead of asking the
#: provider for its whole history in a single frozen window.
MAX_PUNCH_WINDOW = timedelta(days=7)


def _open_or_resume_punch_window(
    state: AttendanceSyncState, *, now: datetime, backfill_start: datetime
) -> tuple[datetime, datetime] | None:
    """Resume the frozen window, or open the next one; ``None`` when caught up.

    A stream that has never been fresh starts at the configured initial backfill
    bound. Afterwards it resumes exactly where freshness ended, so no interval is
    ever skipped and none is imported twice.
    """
    if (state.window_since is None) != (state.window_until is None):
        raise ValueError("Attendance punch sync state has an incomplete frozen window")
    if state.window_since is not None and state.window_until is not None:
        return _aware_utc(state.window_since), _aware_utc(state.window_until)

    since = (
        _aware_utc(state.fresh_through)
        if state.fresh_through is not None
        else _aware_utc(backfill_start)
    )
    until = min(_aware_utc(now), since + MAX_PUNCH_WINDOW)
    if until <= since:
        return None
    state.window_since = _naive_utc(since)
    state.window_until = _naive_utc(until)
    return since, until


def sync_punches(
    db: Session,
    *,
    provider: AttendanceProvider,
    now: datetime,
    backfill_start: datetime,
) -> int:
    """Import one frozen punch page, retaining the cursor on immutable-contract drift.

    ``backfill_start`` is the configured bound the very first window opens at; a
    stream that is already fresh resumes from its own high-water mark instead.
    """

    provider_code = provider.code
    persisted_now = _naive_utc(now)
    state = _state(db, provider=provider_code, stream="punches")
    state.last_attempt_at = persisted_now
    window = _open_or_resume_punch_window(state, now=now, backfill_start=backfill_start)
    if window is None:
        # Freshness already reaches `now`: there is no interval to ask for, and
        # opening an empty window would violate the persisted window invariant.
        _finish_success(state, now=now, imported_count=0)
        db.flush()
        return 0
    since, until = window
    cursor = state.cursor
    try:
        page = provider.list_punches(cursor=cursor, since=since, until=until)
        _validate_page(page)
        with db.begin_nested():
            imported_count = 0
            imported_punches: list[AttendancePunch] = []
            for provider_punch in page.items:
                payload_hash = _normalized_punch_hash(provider_punch)
                existing = db.scalar(
                    select(AttendancePunch).where(
                        AttendancePunch.provider == provider_code,
                        AttendancePunch.external_event_id == provider_punch.external_event_id,
                    )
                )
                if existing is not None:
                    if existing.normalized_payload_hash != payload_hash:
                        raise ProviderContractDriftError()
                    continue

                provider_person = _provider_person_for_punch(
                    db,
                    provider=provider_code,
                    external_person_id=provider_punch.external_person_id,
                    seen_at=persisted_now,
                )
                punch = AttendancePunch(
                    provider=provider_code,
                    external_event_id=provider_punch.external_event_id,
                    provider_person_id=provider_person.id,
                    occurred_at=_naive_utc(provider_punch.occurred_at),
                    direction=_normalize_direction(provider_punch.direction),
                    device_id=provider_punch.device_id,
                    device_name=provider_punch.device_name,
                    source_updated_at=(
                        _naive_utc(provider_punch.source_updated_at)
                        if provider_punch.source_updated_at is not None
                        else None
                    ),
                    imported_at=persisted_now,
                    normalized_payload_hash=payload_hash,
                )
                db.add(punch)
                db.flush()
                imported_punches.append(punch)
                imported_count += 1
                if state.last_event_at is None or _aware_utc(punch.occurred_at) > _aware_utc(
                    state.last_event_at
                ):
                    state.last_event_at = punch.occurred_at

            previous_fresh_through, fresh_through = _advance_fresh_through(
                state, page.fresh_through
            )
            state.cursor = None if page.exhausted else page.next_cursor
            if page.exhausted:
                state.window_since = None
                state.window_until = None
            _finish_success(state, now=now, imported_count=imported_count)
            for punch in imported_punches:
                _enqueue_imported_punch(db, punch=punch, now=now)
            if page.exhausted:
                _enqueue_completed_freshness_crossing(
                    db,
                    previous_fresh_through=previous_fresh_through,
                    fresh_through=fresh_through,
                    now=now,
                )
            db.flush()
    except ProviderContractDriftError:
        # The nested page is rolled back first, then the safe error state is recorded outside it.
        _record_failure(
            state,
            code=ProviderContractDriftError.code,
            summary="Provider contract drift detected for an immutable event",
        )
        db.flush()
        raise
    except Exception:
        _record_failure(
            state,
            code="PROVIDER_SYNC_FAILED",
            summary="Provider punch page import failed",
        )
        db.flush()
        # `from None` on purpose: the vendor exception may carry the provider
        # URL or response body, and the caller logs with a traceback.
        raise ProviderSyncFailedError("punches") from None
    return imported_count
