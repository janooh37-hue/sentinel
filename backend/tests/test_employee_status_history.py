"""Employee status history: every writer logs, no-ops don't, Transferred rules."""

from __future__ import annotations

import contextlib
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, select, text

from app.api.errors import ValidationFailedError
from app.db.models import Employee, EmployeeStatusEvent, User
from app.schemas.employee import EmployeeCreate, EmployeeUpdate
from app.services import employee_activity_service, employee_service
from app.services import scheduler_service as sched
from app.services.document_service import _record_pending_resignation

ROOT = Path(__file__).resolve().parents[2]
TODAY = date.today()
FUTURE = TODAY + timedelta(days=10)
LATER = TODAY + timedelta(days=40)


def _emp(db, employee_id: str = "G7001", **kw) -> Employee:
    kw.setdefault("status", "Active")
    row = Employee(id=employee_id, name_en=f"Emp {employee_id}", **kw)
    db.add(row)
    db.commit()
    return row


def _events(db, employee_id: str = "G7001") -> list[EmployeeStatusEvent]:
    return list(
        db.scalars(
            select(EmployeeStatusEvent)
            .where(EmployeeStatusEvent.employee_id == employee_id)
            .order_by(EmployeeStatusEvent.id)
        )
    )


def _user(db) -> User:
    user = User(
        email="hr@example.ae",
        password_hash="x",
        role="admin",
        status="active",
        display_name="HR Admin",
    )
    db.add(user)
    db.commit()
    return user


# --- validation ---------------------------------------------------------------


def test_transfer_requires_site(db_session):
    _emp(db_session)
    with pytest.raises(ValidationFailedError):
        employee_service.update_employee(
            db_session, "G7001", EmployeeUpdate(status="Transferred", end_date=TODAY)
        )
    with pytest.raises(ValidationFailedError):
        employee_service.update_employee(
            db_session,
            "G7001",
            EmployeeUpdate(status="Transferred", end_date=TODAY, transfer_site="  "),
        )
    assert _events(db_session) == []


def test_transfer_requires_date(db_session):
    _emp(db_session)
    with pytest.raises(ValidationFailedError):
        employee_service.update_employee(
            db_session, "G7001", EmployeeUpdate(status="Transferred", transfer_site="Dubai")
        )


def test_return_date_must_be_after_effective_date(db_session):
    _emp(db_session)
    with pytest.raises(ValidationFailedError):
        employee_service.update_employee(
            db_session,
            "G7001",
            EmployeeUpdate(
                status="Transferred",
                end_date=TODAY,
                transfer_site="Dubai",
                transfer_return_date=TODAY,
            ),
        )


def test_return_date_only_valid_for_transferred(db_session):
    _emp(db_session)
    with pytest.raises(ValidationFailedError):
        employee_service.update_employee(
            db_session,
            "G7001",
            EmployeeUpdate(status="Resigned", end_date=TODAY, transfer_return_date=LATER),
        )


# --- update_employee events ---------------------------------------------------


def test_immediate_transfer_logs_changed_with_actor_and_site(db_session):
    user = _user(db_session)
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G7001",
        EmployeeUpdate(
            status="Transferred",
            end_date=TODAY,
            transfer_site="Dubai Branch",
            transfer_return_date=LATER,
        ),
        actor_user_id=user.id,
    )
    row = db_session.get(Employee, "G7001")
    assert row.status == "Transferred"
    assert (row.transfer_site, row.transfer_return_date) == ("Dubai Branch", LATER)
    (ev,) = _events(db_session)
    assert (ev.from_status, ev.to_status, ev.kind, ev.source) == (
        "Active",
        "Transferred",
        "changed",
        "manual",
    )
    assert ev.effective_date == TODAY
    assert ev.site == "Dubai Branch"
    assert ev.return_date == LATER
    assert ev.actor_user_id == user.id


def test_future_transfer_schedules(db_session):
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G7001",
        EmployeeUpdate(status="Transferred", end_date=FUTURE, transfer_site="Abu Dhabi"),
    )
    row = db_session.get(Employee, "G7001")
    assert row.status == "Active"
    assert row.pending_status == "Transferred"
    assert row.transfer_site == "Abu Dhabi"
    (ev,) = _events(db_session)
    assert (ev.kind, ev.to_status, ev.effective_date) == ("scheduled", "Transferred", FUTURE)


def test_rescheduling_records_again_but_resending_same_does_not(db_session):
    _emp(db_session)
    payload = dict(status="Transferred", end_date=FUTURE, transfer_site="Abu Dhabi")
    employee_service.update_employee(db_session, "G7001", EmployeeUpdate(**payload))
    employee_service.update_employee(db_session, "G7001", EmployeeUpdate(**payload))
    assert len(_events(db_session)) == 1
    payload["end_date"] = LATER
    employee_service.update_employee(db_session, "G7001", EmployeeUpdate(**payload))
    assert [e.kind for e in _events(db_session)] == ["scheduled", "scheduled"]


def test_cancel_scheduled_logs_and_clears_transfer_fields(db_session):
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G7001",
        EmployeeUpdate(
            status="Transferred",
            end_date=FUTURE,
            transfer_site="Abu Dhabi",
            transfer_return_date=LATER,
        ),
    )
    employee_service.update_employee(db_session, "G7001", EmployeeUpdate(end_date=None))
    row = db_session.get(Employee, "G7001")
    assert row.pending_status is None
    assert row.end_date is None
    assert row.transfer_site is None and row.transfer_return_date is None
    ev = _events(db_session)[-1]
    assert (ev.kind, ev.from_status, ev.to_status, ev.effective_date) == (
        "scheduled_cancelled",
        "Active",
        "Transferred",
        FUTURE,
    )


def test_reactivation_logs_return_date_and_clears_transfer_fields(db_session):
    _emp(
        db_session,
        status="Transferred",
        end_date=TODAY - timedelta(days=20),
        transfer_site="Dubai Branch",
        transfer_return_date=LATER,
    )
    back = TODAY - timedelta(days=2)
    employee_service.update_employee(
        db_session,
        "G7001",
        EmployeeUpdate(status="Active", end_date=None, effective_date=back),
    )
    row = db_session.get(Employee, "G7001")
    assert row.status == "Active" and row.end_date is None
    assert row.transfer_site is None and row.transfer_return_date is None
    assert not hasattr(row, "effective_date")
    (ev,) = _events(db_session)
    assert (ev.kind, ev.from_status, ev.to_status) == ("changed", "Transferred", "Active")
    assert ev.effective_date == back
    assert ev.site == "Dubai Branch"


def test_reactivation_defaults_to_today(db_session):
    _emp(db_session, status="Resigned", end_date=TODAY - timedelta(days=5))
    employee_service.update_employee(
        db_session, "G7001", EmployeeUpdate(status="Active", end_date=None)
    )
    (ev,) = _events(db_session)
    assert ev.effective_date == TODAY


def test_leaving_transferred_clears_transfer_fields(db_session):
    _emp(
        db_session,
        status="Transferred",
        end_date=TODAY - timedelta(days=3),
        transfer_site="Dubai Branch",
        transfer_return_date=LATER,
    )
    employee_service.update_employee(
        db_session, "G7001", EmployeeUpdate(status="Terminated", end_date=TODAY)
    )
    row = db_session.get(Employee, "G7001")
    assert row.status == "Terminated"
    assert row.transfer_site is None and row.transfer_return_date is None
    (ev,) = _events(db_session)
    assert (ev.from_status, ev.to_status, ev.kind) == ("Transferred", "Terminated", "changed")


def test_future_departure_from_transferred_applies_immediately(db_session):
    # Already off this roster: no Active notice period, no pending marker.
    _emp(
        db_session,
        status="Transferred",
        end_date=TODAY - timedelta(days=3),
        transfer_site="Dubai Branch",
    )
    employee_service.update_employee(
        db_session, "G7001", EmployeeUpdate(status="Resigned", end_date=FUTURE)
    )
    row = db_session.get(Employee, "G7001")
    assert (row.status, row.pending_status, row.end_date) == ("Resigned", None, FUTURE)
    assert row.transfer_site is None
    (ev,) = _events(db_session)
    assert (ev.from_status, ev.to_status, ev.kind) == ("Transferred", "Resigned", "changed")


def test_noop_form_resend_logs_nothing(db_session):
    _emp(db_session, name_ar="س", nationality="1")
    # EmployeeForm re-sends status/end_date untouched.
    employee_service.update_employee(
        db_session, "G7001", EmployeeUpdate(status="Active", end_date=None, nationality="2")
    )
    _emp(
        db_session,
        "G7002",
        status="Transferred",
        end_date=TODAY - timedelta(days=3),
        transfer_site="Dubai",
    )
    employee_service.update_employee(
        db_session,
        "G7002",
        EmployeeUpdate(status="Transferred", end_date=TODAY - timedelta(days=3), nationality="3"),
    )
    # Editing only the site/return of an already-Transferred employee: allowed,
    # no history row.
    employee_service.update_employee(
        db_session,
        "G7002",
        EmployeeUpdate(transfer_site="Sharjah", transfer_return_date=LATER),
    )
    row = db_session.get(Employee, "G7002")
    assert (row.transfer_site, row.transfer_return_date) == ("Sharjah", LATER)
    assert _events(db_session, "G7001") == [] and _events(db_session, "G7002") == []


def test_pending_departure_untouched_by_form_resend(db_session):
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G7001",
        EmployeeUpdate(status="Transferred", end_date=FUTURE, transfer_site="Abu Dhabi"),
    )
    employee_service.update_employee(
        db_session, "G7001", EmployeeUpdate(status="Active", end_date=FUTURE, nationality="9")
    )
    row = db_session.get(Employee, "G7001")
    assert row.pending_status == "Transferred" and row.transfer_site == "Abu Dhabi"
    assert len(_events(db_session)) == 1


# --- create -------------------------------------------------------------------


def test_create_active_logs_nothing(db_session):
    employee_service.create_employee(db_session, EmployeeCreate(id="G7010", name_en="A"))
    assert _events(db_session, "G7010") == []


def test_create_non_active_logs_changed(db_session):
    employee_service.create_employee(
        db_session,
        EmployeeCreate(
            id="G7011",
            name_en="A",
            status="Transferred",
            end_date=TODAY,
            transfer_site="Dubai",
        ),
        actor_user_id=None,
    )
    (ev,) = _events(db_session, "G7011")
    assert (ev.kind, ev.from_status, ev.to_status, ev.site) == (
        "changed",
        "Active",
        "Transferred",
        "Dubai",
    )


def test_create_future_departure_schedules(db_session):
    employee_service.create_employee(
        db_session,
        EmployeeCreate(id="G7012", name_en="A", status="Resigned", end_date=FUTURE),
    )
    row = db_session.get(Employee, "G7012")
    assert (row.status, row.pending_status) == ("Active", "Resigned")
    (ev,) = _events(db_session, "G7012")
    assert (ev.kind, ev.to_status) == ("scheduled", "Resigned")


# --- resignation letter -------------------------------------------------------


def test_resignation_letter_logs_scheduled_and_changed(db_session):
    a = _emp(db_session, "G7020")
    b = _emp(db_session, "G7021")
    _record_pending_resignation(
        db_session, a, {"resignation_date": FUTURE.isoformat()}, actor_user_id=None
    )
    _record_pending_resignation(db_session, b, {"resignation_date": TODAY.isoformat()})
    db_session.commit()
    (ea,) = _events(db_session, "G7020")
    (eb,) = _events(db_session, "G7021")
    assert (ea.kind, ea.source, ea.to_status) == ("scheduled", "resignation_letter", "Resigned")
    assert (eb.kind, eb.source, eb.effective_date) == ("changed", "resignation_letter", TODAY)


# --- scheduler ----------------------------------------------------------------


def test_apply_due_departures_logs_applied_with_site(db_session):
    _emp(
        db_session,
        status="Active",
        end_date=TODAY,
        pending_status="Transferred",
        transfer_site="Dubai Branch",
        transfer_return_date=LATER,
    )
    moved = employee_service.apply_due_departures(db_session)
    assert [m.id for m in moved] == ["G7001"]
    assert moved[0].status == "Transferred"
    assert moved[0].transfer_site == "Dubai Branch"
    (ev,) = _events(db_session)
    assert (ev.kind, ev.source, ev.from_status, ev.to_status) == (
        "applied",
        "scheduler",
        "Active",
        "Transferred",
    )
    assert (ev.effective_date, ev.site, ev.return_date) == (TODAY, "Dubai Branch", LATER)


def test_apply_due_transfer_returns(db_session):
    _emp(
        db_session,
        status="Transferred",
        end_date=TODAY - timedelta(days=30),
        transfer_site="Dubai Branch",
        transfer_return_date=TODAY,
    )
    _emp(
        db_session,
        "G7002",
        status="Transferred",
        end_date=TODAY - timedelta(days=30),
        transfer_site="X",
        transfer_return_date=FUTURE,
    )
    _emp(db_session, "G7003", status="Transferred", end_date=TODAY, transfer_site="Open")
    moved = employee_service.apply_due_transfer_returns(db_session)
    assert [(e.id, d, s) for e, d, s in moved] == [("G7001", TODAY, "Dubai Branch")]
    row = db_session.get(Employee, "G7001")
    assert row.status == "Active"
    assert row.end_date is None and row.transfer_site is None
    assert row.transfer_return_date is None and row.pending_status is None
    assert db_session.get(Employee, "G7002").status == "Transferred"
    assert db_session.get(Employee, "G7003").status == "Transferred"
    (ev,) = _events(db_session)
    assert (ev.kind, ev.source, ev.from_status, ev.to_status) == (
        "applied",
        "scheduler",
        "Transferred",
        "Active",
    )
    assert (ev.effective_date, ev.site) == (TODAY, "Dubai Branch")
    assert employee_service.apply_due_transfer_returns(db_session) == []


def _job_harness(monkeypatch, moved, returned):
    @contextlib.contextmanager
    def fake_session():
        yield SimpleNamespace()

    monkeypatch.setattr(sched, "SessionLocal", fake_session)
    monkeypatch.setattr(sched.employee_service, "apply_due_departures", lambda db, **kw: moved)
    monkeypatch.setattr(
        sched.employee_service, "apply_due_transfer_returns", lambda db, **kw: returned
    )
    monkeypatch.setattr(sched.admin_notify, "active_admins", lambda db: [SimpleNamespace(id=1)])
    sent: list[dict] = []
    monkeypatch.setattr(
        sched.push_service, "send_to_user", lambda db, uid, messages, url: sent.append(messages)
    )
    return sent


def test_job_pushes_transfer_applied_with_isolated_site(monkeypatch):
    emp = SimpleNamespace(
        id="G7001",
        name_en="Ali",
        name_ar="علي",
        status="Transferred",
        transfer_site="Dubai Branch",
    )
    sent = _job_harness(monkeypatch, [emp], [])
    sched._run_pending_departure_flip()
    (msg,) = sent
    assert msg["en"][1] == "Transfer applied\nAli (G7001) transferred to Dubai Branch"
    fsi, pdi = "\u2068", "\u2069"
    assert msg["ar"][1].startswith("تم تطبيق النقل\n")
    assert f"{fsi}Dubai Branch{pdi}" in msg["ar"][1]
    assert f"{fsi}(G7001){pdi}" in msg["ar"][1]


def test_job_pushes_transfer_ended(monkeypatch):
    emp = SimpleNamespace(id="G7001", name_en="Ali", name_ar=None, status="Active")
    sent = _job_harness(monkeypatch, [], [(emp, TODAY, "Dubai Branch")])
    sched._run_pending_departure_flip()
    (msg,) = sent
    assert msg["en"][1] == "Transfer ended\nAli (G7001) returned to Active"
    assert msg["ar"][1].startswith("انتهى النقل\n")
    assert msg["ar"][1] == "انتهى النقل\n\u2068Ali\u2069 \u2068(G7001)\u2069 عاد إلى الخدمة"


def test_job_return_failure_does_not_block_departure_notices(monkeypatch):
    emp = SimpleNamespace(id="G7001", name_en="Ali", name_ar=None, status="Resigned")
    sent = _job_harness(monkeypatch, [emp], [])

    def boom(db, **kw):
        raise RuntimeError("locked")

    monkeypatch.setattr(sched.employee_service, "apply_due_transfer_returns", boom)
    sched._run_pending_departure_flip()
    assert len(sent) == 1


# --- activity -----------------------------------------------------------------


def test_activity_returns_status_items_with_actor_name(db_session):
    user = _user(db_session)
    _emp(db_session, status="Resigned", end_date=TODAY)  # no event yet
    _emp(db_session, "G7002")
    employee_service.update_employee(
        db_session,
        "G7002",
        EmployeeUpdate(status="Transferred", end_date=TODAY, transfer_site="Dubai"),
        actor_user_id=user.id,
    )
    employee_service.apply_due_transfer_returns(db_session, today=TODAY + timedelta(days=1))
    result = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=user.id, employee_id="G7002", kind="status"
    )
    assert [i.kind for i in result.items] == ["status"]
    item = result.items[0]
    assert (item.from_status, item.to_status, item.site) == ("Active", "Transferred", "Dubai")
    assert item.status_event_kind == "changed" and item.status_source == "manual"
    assert item.actor_name == "HR Admin"
    assert item.effective_date == TODAY
    assert item.reference == f"#{item.source_id}"
    all_kinds = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=user.id, employee_id="G7002"
    )
    assert {i.kind for i in all_kinds.items} == {"status"}


def test_activity_status_without_actor_has_no_actor_name(db_session):
    _emp(db_session, status="Active", end_date=TODAY, pending_status="Resigned")
    employee_service.apply_due_departures(db_session)
    result = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=1, employee_id="G7001", kind="status"
    )
    assert result.items[0].actor_name is None
    assert result.items[0].status_source == "scheduler"


# --- migration ----------------------------------------------------------------


def _config(url: str) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    return config


def test_single_alembic_head():
    heads = ScriptDirectory.from_config(_config("sqlite://")).get_heads()
    assert len(heads) == 1


def test_migration_0094_backfills_and_downgrades(tmp_path: Path):
    url = f"sqlite:///{tmp_path / 'm.db'}"
    config = _config(url)
    command.upgrade(config, "0093_password_setup")
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO employees (id, name_en, status, end_date, created_at, updated_at) VALUES "
                "('G1', 'A', 'Active', NULL, '2026-01-01', '2026-01-01'), ('G2', 'B', 'Resigned', '2026-03-01', '2026-01-01', '2026-01-01'), "
                "('G3', 'C', 'Terminated', '2026-04-02', '2026-01-01', '2026-01-01')"
            )
        )
    command.upgrade(config, "0094_employee_status_events")
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT employee_id, from_status, to_status, effective_date, kind, source, "
                "actor_user_id, created_at FROM employee_status_events ORDER BY employee_id"
            )
        ).all()
        assert [(r[0], r[1], r[2], r[3], r[4], r[5], r[6]) for r in rows] == [
            ("G2", "Active", "Resigned", "2026-03-01", "imported", "backfill", None),
            ("G3", "Active", "Terminated", "2026-04-02", "imported", "backfill", None),
        ]
        # Backfilled rows are dated at the departure, not at migration time.
        assert [str(r[7])[:10] for r in rows] == ["2026-03-01", "2026-04-02"]
        cols = {r[1] for r in conn.execute(text("PRAGMA table_info(employees)"))}
        assert {"transfer_site", "transfer_return_date"} <= cols
    command.downgrade(config, "0093_password_setup")
    with engine.connect() as conn:
        cols = {r[1] for r in conn.execute(text("PRAGMA table_info(employees)"))}
        assert not {"transfer_site", "transfer_return_date"} & cols
        assert not conn.execute(
            text("SELECT name FROM sqlite_master WHERE name='employee_status_events'")
        ).all()
    command.upgrade(config, "head")


def test_employee_detail_recent_activity_includes_status_events(db_session):
    from app.services.employee_detail_service import get_employee_detail

    user = _user(db_session)
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G7001",
        EmployeeUpdate(status="Transferred", end_date=TODAY, transfer_site="Dubai"),
        actor_user_id=user.id,
    )
    detail = get_employee_detail(db_session, "G7001")
    (item,) = [i for i in detail.recent_activity if i.kind == "status"]
    assert item.summary == "Transferred"
    assert (item.from_status, item.to_status, item.site) == ("Active", "Transferred", "Dubai")
    assert item.status_event_kind == "changed" and item.status_source == "manual"
    assert item.actor_name == "HR Admin"
    assert item.effective_date == TODAY
    assert item.ref_id == _events(db_session)[0].id
