from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.db.models import Employee, User
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluationQueue,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendanceSyncState,
    WorkAttendancePolicy,
    WorkShiftDefinition,
    WorkShiftOverride,
)
from app.services.attendance_provider import ProviderPage, ProviderPerson, ProviderPunch
from app.services.attendance_sync_service import (
    ProviderContractDriftError,
    sync_people,
    sync_punches,
)

NOW = datetime(2026, 8, 17, 12, tzinfo=UTC)
WINDOW_START = NOW - timedelta(hours=8)
WINDOW_END = NOW - timedelta(hours=2)
LATER = NOW + timedelta(hours=4)


@dataclass
class _ScriptedAttendanceProvider:
    """Deterministic protocol fake; it has no network transport or wall clock."""

    people_pages: dict[str | None, ProviderPage[ProviderPerson]] = field(default_factory=dict)
    punch_pages: dict[str | None, ProviderPage[ProviderPunch]] = field(default_factory=dict)
    people_calls: list[str | None] = field(default_factory=list)
    punch_calls: list[tuple[str | None, datetime | None, datetime]] = field(default_factory=list)
    code: str = "biotime"

    def test_connection(self):  # pragma: no cover - sync must not need a health probe.
        raise AssertionError("sync must only call the requested list operation")

    def list_people(self, *, cursor: str | None) -> ProviderPage[ProviderPerson]:
        self.people_calls.append(cursor)
        return self.people_pages[cursor]

    def list_punches(
        self,
        *,
        cursor: str | None,
        since: datetime | None,
        until: datetime,
    ) -> ProviderPage[ProviderPunch]:
        self.punch_calls.append((cursor, since, until))
        return self.punch_pages[cursor]


def _provider_person(db_session, *, external_id: str = "bio-1") -> AttendanceProviderPerson:
    row = AttendanceProviderPerson(
        provider="biotime",
        external_person_id=external_id,
        mapping_state="unmapped",
        active=True,
        first_seen_at=WINDOW_START,
        last_seen_at=WINDOW_START,
    )
    db_session.add(row)
    db_session.commit()
    return row


def _punch(
    *,
    event_id: str,
    external_person_id: str = "bio-1",
    occurred_at: datetime = WINDOW_START + timedelta(minutes=30),
    direction: str = "in",
    device_name: str | None = None,
) -> ProviderPunch:
    return ProviderPunch(
        external_event_id=event_id,
        external_person_id=external_person_id,
        occurred_at=occurred_at,
        direction=direction,
        device_id="gate-a",
        device_name=device_name,
        source_updated_at=occurred_at,
    )


def _state(db_session, stream: str) -> AttendanceSyncState:
    return db_session.get(AttendanceSyncState, {"provider": "biotime", "stream": stream})


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _add_case(
    db_session,
    *,
    employee_id: str,
    starts_at: datetime,
    ends_at: datetime,
    suffix: str,
) -> AttendanceCase:
    """Persist a case against an auditable schedule source."""

    actor_id = db_session.scalar(select(User.id))
    assert actor_id is not None
    shift = WorkShiftDefinition(
        code=f"fixture-{suffix}",
        start_local_time=starts_at.time().replace(tzinfo=None),
        duration_minutes=int((ends_at - starts_at).total_seconds() // 60),
    )
    db_session.add(shift)
    db_session.flush()
    override = WorkShiftOverride(
        employee_id=employee_id,
        assignment_kind="work",
        reason_kind="other",
        starts_at=starts_at,
        ends_at=ends_at,
        shift_definition_id=shift.id,
        reason="Attendance sync test fixture",
        created_by_user_id=actor_id,
    )
    db_session.add(override)
    db_session.flush()
    case = AttendanceCase(
        employee_id=employee_id,
        shift_override_id=override.id,
        scheduled_start_at=starts_at,
        scheduled_end_at=ends_at,
        operational_date=starts_at.date(),
        employee_status_snapshot="Active",
        organization_snapshot_state="captured",
        crew_code_snapshot=f"crew-{suffix}",
        crew_name_snapshot=f"Crew {suffix}",
        shift_code_snapshot="day",
    )
    db_session.add(case)
    db_session.flush()
    return case


def _add_approved_policy(db_session, admin_user) -> None:
    policy = WorkAttendancePolicy(
        shift_definition_id=None,
        grace_minutes=15,
        absence_after_minutes=30,
        early_exit_grace_minutes=15,
        match_before_minutes=30,
        match_after_minutes=30,
        require_checkout=True,
        effective_from=date(2026, 8, 1),
        effective_to=None,
        created_by_user_id=admin_user.id,
        approved_by_user_id=admin_user.id,
        approved_at=WINDOW_START,
    )
    db_session.add(policy)
    db_session.commit()


def test_people_and_punch_streams_keep_independent_cursors(db_session):
    db_session.add_all(
        [
            AttendanceSyncState(provider="biotime", stream="people", cursor="people-1"),
            AttendanceSyncState(
                provider="biotime",
                stream="punches",
                cursor="punch-1",
                window_since=WINDOW_START,
                window_until=WINDOW_END,
            ),
        ]
    )
    db_session.commit()
    provider = _ScriptedAttendanceProvider(
        people_pages={
            "people-1": ProviderPage(
                items=[], next_cursor="people-2", exhausted=False, fresh_through=None
            )
        },
        punch_pages={
            "punch-1": ProviderPage(
                items=[], next_cursor="punch-2", exhausted=False, fresh_through=None
            )
        },
    )

    sync_people(db_session, provider=provider, now=NOW)
    sync_punches(db_session, provider=provider, now=NOW)

    assert provider.people_calls == ["people-1"]
    assert provider.punch_calls == [("punch-1", WINDOW_START, WINDOW_END)]
    assert _state(db_session, "people").cursor == "people-2"
    punch_state = _state(db_session, "punches")
    assert punch_state.cursor == "punch-2"
    assert _as_utc(punch_state.window_since) == WINDOW_START
    assert _as_utc(punch_state.window_until) == WINDOW_END


def test_punch_sync_reuses_frozen_window_and_idempotently_replays_pages(db_session):
    _provider_person(db_session)
    db_session.add(
        AttendanceSyncState(
            provider="biotime",
            stream="punches",
            cursor=None,
            window_since=WINDOW_START,
            window_until=WINDOW_END,
            fresh_through=WINDOW_START,
        )
    )
    db_session.commit()
    first = _punch(event_id="event-1")
    second = _punch(event_id="event-2", occurred_at=WINDOW_START + timedelta(hours=1))
    provider = _ScriptedAttendanceProvider(
        punch_pages={
            None: ProviderPage(
                items=[first], next_cursor="page-2", exhausted=False, fresh_through=None
            ),
            "page-2": ProviderPage(
                items=[first, second],
                next_cursor=None,
                exhausted=True,
                fresh_through=WINDOW_END,
            ),
        }
    )

    sync_punches(db_session, provider=provider, now=NOW)
    sync_punches(db_session, provider=provider, now=LATER)

    assert provider.punch_calls == [
        (None, WINDOW_START, WINDOW_END),
        ("page-2", WINDOW_START, WINDOW_END),
    ]
    assert db_session.scalar(select(func.count()).select_from(AttendancePunch)) == 2
    state = _state(db_session, "punches")
    assert state.cursor is None
    assert state.window_since is None and state.window_until is None
    assert _as_utc(state.fresh_through) == WINDOW_END


def test_hash_drift_rolls_back_the_entire_page_and_preserves_cursor(db_session):
    _provider_person(db_session)
    db_session.add(
        AttendanceSyncState(
            provider="biotime",
            stream="punches",
            cursor=None,
            window_since=WINDOW_START,
            window_until=WINDOW_END,
            fresh_through=WINDOW_START,
        )
    )
    db_session.commit()
    provider = _ScriptedAttendanceProvider(
        punch_pages={
            None: ProviderPage(
                items=[_punch(event_id="immutable-event", device_name="original-device")],
                next_cursor="page-2",
                exhausted=False,
                fresh_through=None,
            ),
            "page-2": ProviderPage(
                items=[
                    _punch(event_id="new-event", device_name="would-be-imported"),
                    _punch(event_id="immutable-event", device_name="changed-device"),
                ],
                next_cursor=None,
                exhausted=True,
                fresh_through=WINDOW_END,
            ),
        }
    )

    sync_punches(db_session, provider=provider, now=NOW)
    original = db_session.scalar(
        select(AttendancePunch).where(AttendancePunch.external_event_id == "immutable-event")
    )
    original_hash = original.normalized_payload_hash
    with pytest.raises(ProviderContractDriftError):
        sync_punches(db_session, provider=provider, now=NOW)

    db_session.expire_all()
    assert db_session.scalar(select(func.count()).select_from(AttendancePunch)) == 1
    persisted = db_session.scalar(
        select(AttendancePunch).where(AttendancePunch.external_event_id == "immutable-event")
    )
    assert persisted.normalized_payload_hash == original_hash
    state = _state(db_session, "punches")
    assert state.cursor == "page-2"
    assert _as_utc(state.fresh_through) == WINDOW_START
    assert state.last_error_code == "PROVIDER_CONTRACT_DRIFT"
    assert "changed-device" not in (state.last_error_summary or "")


def test_people_sync_does_not_auto_map_an_exact_employee_code(db_session):
    db_session.add(Employee(id="G100", name_en="Matching code", name_ar="مطابق"))
    db_session.commit()
    provider = _ScriptedAttendanceProvider(
        people_pages={
            None: ProviderPage(
                items=[
                    ProviderPerson(
                        external_person_id="person-100",
                        external_employee_code="G100",
                        display_name_snapshot="Matching code",
                        active=True,
                        source_updated_at=NOW,
                    )
                ],
                next_cursor=None,
                exhausted=True,
                fresh_through=NOW,
            )
        }
    )

    sync_people(db_session, provider=provider, now=NOW)

    imported = db_session.scalar(
        select(AttendanceProviderPerson).where(
            AttendanceProviderPerson.external_person_id == "person-100"
        )
    )
    assert imported.mapping_state == "unmapped"
    assert imported.employee_id is None


def test_people_sync_refreshes_provider_fields_without_overwriting_verified_mapping(
    db_session, admin_user
):
    db_session.add_all(
        [
            Employee(id="G200", name_en="Verified", name_ar="موثق"),
            Employee(id="G201", name_en="Different", name_ar="آخر"),
        ]
    )
    db_session.flush()
    mapped = AttendanceProviderPerson(
        provider="biotime",
        external_person_id="person-200",
        external_employee_code="G200",
        display_name_snapshot="Old snapshot",
        employee_id="G200",
        mapping_state="verified",
        verified_by_user_id=admin_user.id,
        verified_at=WINDOW_START,
        active=True,
        first_seen_at=WINDOW_START,
        last_seen_at=WINDOW_START,
    )
    db_session.add(mapped)
    db_session.commit()
    provider = _ScriptedAttendanceProvider(
        people_pages={
            None: ProviderPage(
                items=[
                    ProviderPerson(
                        external_person_id="person-200",
                        external_employee_code="G201",
                        display_name_snapshot="New provider snapshot",
                        active=False,
                        source_updated_at=NOW,
                    )
                ],
                next_cursor=None,
                exhausted=True,
                fresh_through=NOW,
            )
        }
    )

    sync_people(db_session, provider=provider, now=NOW)

    db_session.refresh(mapped)
    assert mapped.mapping_state == "verified"
    assert mapped.employee_id == "G200"
    assert mapped.verified_by_user_id == admin_user.id
    assert _as_utc(mapped.verified_at) == WINDOW_START
    assert mapped.external_employee_code == "G201"
    assert mapped.display_name_snapshot == "New provider snapshot"
    assert mapped.active is False


def test_completed_empty_punch_page_enqueues_each_crossed_freshness_boundary(
    db_session, admin_user
):
    employees = [
        Employee(id="G300", name_en="Queue start", name_ar="بداية"),
        Employee(id="G301", name_en="Queue absence", name_ar="غياب"),
        Employee(id="G302", name_en="Queue end", name_ar="نهاية"),
        Employee(id="G303", name_en="Queue checkout", name_ar="مغادرة"),
    ]
    db_session.add_all(employees)
    db_session.flush()
    _add_approved_policy(db_session, admin_user)
    _add_case(
        db_session,
        employee_id=employees[0].id,
        starts_at=NOW - timedelta(hours=4),
        ends_at=NOW + timedelta(hours=5),
        suffix="start",
    )
    _add_case(
        db_session,
        employee_id=employees[1].id,
        starts_at=NOW - timedelta(hours=3, minutes=30),
        ends_at=NOW + timedelta(hours=5),
        suffix="absence",
    )
    _add_case(
        db_session,
        employee_id=employees[2].id,
        starts_at=NOW - timedelta(hours=8),
        ends_at=NOW - timedelta(hours=1),
        suffix="end",
    )
    _add_case(
        db_session,
        employee_id=employees[3].id,
        starts_at=NOW - timedelta(hours=9),
        ends_at=NOW - timedelta(hours=2, minutes=30),
        suffix="checkout",
    )
    old_fresh = NOW - timedelta(hours=4, minutes=15)
    new_fresh = NOW
    db_session.add(
        AttendanceSyncState(
            provider="biotime",
            stream="punches",
            cursor=None,
            window_since=old_fresh,
            window_until=new_fresh,
            fresh_through=old_fresh,
        )
    )
    db_session.commit()
    provider = _ScriptedAttendanceProvider(
        punch_pages={
            None: ProviderPage(
                items=[], next_cursor=None, exhausted=True, fresh_through=new_fresh
            )
        }
    )

    sync_punches(db_session, provider=provider, now=new_fresh)

    queued = db_session.scalars(
        select(AttendanceEvaluationQueue).where(
            AttendanceEvaluationQueue.employee_id.in_([employee.id for employee in employees])
        )
    ).all()
    assert len(queued) == 4
    assert {row.employee_id for row in queued} == {employee.id for employee in employees}
