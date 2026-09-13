"""Behavioral proof of the inmate-specific three-person monthly approval."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Event

import pytest
from backend.tests import test_inmate_statistics as fixtures
from backend.tests.test_inmate_statistics import _inmate, _record
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import AppError, install_handlers
from app.api.v1.inmate_statistics import router
from app.db import models as m
from app.db.session import get_db
from app.services import inmate_statistics_service as s

api_db = fixtures.api_db


@pytest.fixture()
def people(api_db):
    users = []
    for index in range(5):
        employee = m.Employee(id=f"GWF{index}", name_ar=f"الموظف التجريبي {index}", name_en="Test")
        user = m.User(
            email=f"workflow{index}@example.test",
            password_hash="x",
            role="manager" if index < 4 else "admin",
            status="active",
            employee_id=employee.id,
        )
        api_db.add_all([employee, user])
        users.append(user)
    api_db.commit()
    return users


def live(db, month=8, wing="1A"):
    inmates = [_inmate("نزيل تجريبي", wing=wing)]
    return _record(db, report_date=f"2026-{month:02d}-05", inmates=inmates)


def prepare(db, people, month=8, reviewer=None, fingerprint=None):
    actor = people[0]
    view = s.build_month(db, 2026, month, actor=actor)
    kw = {
        "actor": actor,
        "expected_version": view.workflow["version"],
        "expected_projection_fingerprint": fingerprint or view.projection_fingerprint,
        "reviewer_user_id": (reviewer or people[1]).id,
    }
    return s.prepare_month(db, 2026, month, **kw)


def handoff(db, view, actor, manager, month=8):
    kw = {
        "actor": actor,
        "expected_version": view.workflow["version"],
        "manager_user_id": manager.id,
    }
    return s.review_month(db, 2026, month, **kw)


def review(db, people, month=8, manager=None):
    return handoff(db, prepare(db, people, month), people[1], manager or people[2], month)


def approve(db, people, view, month=8, actor=None):
    kw = {
        "actor": actor or people[2],
        "expected_version": view.workflow["version"],
        "today": date(2026, 9, 12),
    }
    return s.approve_month(db, 2026, month, **kw)


def reasoned(action, db, view, actor, reason):
    kw = {"actor": actor, "expected_version": view.workflow["version"], "reason": reason}
    return action(db, 2026, 8, **kw)


def refuses(code, action, *args, **kwargs):
    with pytest.raises(AppError) as error:
        action(*args, **kwargs)
    assert error.value.code == code


def deny(db, user, capability):
    db.add(m.UserPermission(user_id=user.id, capability=capability, effect="deny"))


def wal(db):
    db.commit()
    with db.bind.connect() as connection:
        connection.execute(text("PRAGMA journal_mode=WAL"))


def manual(db, actor):
    kw = {
        "actor": actor,
        "name": "نزيل",
        "violation_date": date(2026, 8, 1),
        "reason": "إضافة",
        "nationality_label": "الامارات",
        "wing": "1A",
        "details_text": "تفاصيل",
    }
    return s.create_manual_row(db, 2026, 8, **kw)


def test_canonical_wings_cover_ties_zero_unassigned_and_no_positive_count(api_db):
    _record(
        api_db,
        report_date="2026-08-05",
        inmates=[
            _inmate("أ", wing=" 1a "),
            _inmate("ب", wing="2B"),
            _inmate("ج", wing="A1"),
        ],
    )
    summary = s.build_month(api_db, 2026, 8).wing_summary
    assert [item["wing"] for item in summary["counts"]] == [
        f"{number}{letter}" for number in range(1, 7) for letter in "AB"
    ]
    assert summary["most"] == summary["least"] == ["1A", "2B"]
    assert summary["unassigned_count"] == 1 and len(summary["zero"]) == 10
    empty = s.build_month(api_db, 2026, 7).wing_summary
    assert empty["most"] == empty["least"] == [] and len(empty["zero"]) == 12


def test_full_chain_seals_reviewed_rows_and_snapshots_all_actor_identities(api_db, people):
    book = live(api_db)
    reviewed = review(api_db, people)
    closed = approve(api_db, people, reviewed)
    assert closed.closed and closed.projection_fingerprint == reviewed.projection_fingerprint
    stages = "prepared", "reviewed", "approved"
    names = [closed.workflow[stage]["name_ar"] for stage in stages]
    assert [closed.workflow[stage]["employee_id"] for stage in stages] == [
        u.employee_id for u in people[:3]
    ]
    for actor in people[:3]:
        actor.employee.name_ar = "اسم جديد"
    book.versions[0].fields = {**book.versions[0].fields, "inmates": [_inmate("صف مختلف")]}
    api_db.commit()
    archived = s.build_month(api_db, 2026, 8)
    assert archived.entries[0].name == "نزيل تجريبي"
    assert [archived.workflow[stage]["name_ar"] for stage in stages] == names


@pytest.mark.parametrize(
    ("defect", "code"),
    [
        ("same_user", "INMATE_REGISTER_ACTORS_NOT_DISTINCT"),
        ("same_employee", "INMATE_REGISTER_ACTORS_NOT_DISTINCT"),
        ("missing_name", "INMATE_REGISTER_INVALID_ACTOR_PROFILE"),
        ("missing_employee", "INMATE_REGISTER_INVALID_ACTOR_PROFILE"),
        ("review_capability", "INMATE_REGISTER_ACTOR_INELIGIBLE"),
        ("navigation", "INMATE_REGISTER_ACTOR_INELIGIBLE"),
    ],
)
def test_reviewer_policy_requires_distinct_complete_capable_identities(
    api_db, people, defect, code
):
    live(api_db)
    selected = people[0] if defect == "same_user" else people[1]
    if defect == "same_employee":
        selected.employee_id = people[0].employee_id
    elif defect == "missing_name":
        selected.employee.name_ar = " "
    elif defect == "missing_employee":
        selected.employee_id = None
    elif defect in {"review_capability", "navigation"}:
        capability = (
            "inmate_statistics.review" if defect == "review_capability" else "documents.generate"
        )
        deny(api_db, selected, capability)
    api_db.commit()
    refuses(code, prepare, api_db, people, reviewer=selected)
    candidates = s.workflow_candidates(api_db, 2026, 8, actor=people[0], stage="review")
    assert selected.id not in {item["user_id"] for item in candidates}


def test_manager_must_differ_from_both_actors_and_keep_approval_capability(api_db, people):
    live(api_db)
    prepared = prepare(api_db, people)
    for selected in people[:2]:
        refuses(
            "INMATE_REGISTER_ACTORS_NOT_DISTINCT", handoff, api_db, prepared, people[1], selected
        )
    viewed = handoff(api_db, prepared, people[1], people[2])
    deny(api_db, people[2], "inmate_statistics.approve")
    api_db.commit()
    refuses("INMATE_REGISTER_ACTOR_INELIGIBLE", approve, api_db, people, viewed)


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ("relink", "INMATE_REGISTER_ASSIGNEE_RELINKED"),
        ("disable", "INMATE_REGISTER_ACTOR_INELIGIBLE"),
        ("revoke", "INMATE_REGISTER_ACTOR_INELIGIBLE"),
        ("wrong_person", "INMATE_REGISTER_WRONG_ASSIGNEE"),
    ],
)
def test_handoff_rechecks_the_selected_actor_at_action_time(api_db, people, change, code):
    live(api_db)
    viewed, actor = prepare(api_db, people), people[1]
    if change == "relink":
        actor.employee_id = people[3].employee_id
    elif change == "disable":
        actor.status = "disabled"
    elif change == "revoke":
        deny(api_db, actor, "inmate_statistics.review")
    else:
        actor = people[3]
    api_db.commit()
    refuses(code, handoff, api_db, viewed, actor, people[2])
    assert s.build_month(api_db, 2026, 8).workflow["reviewed"] is None


@pytest.mark.parametrize("stage", ["review", "approve"])
def test_freshness_refuses_stale_client_and_rows_changed_after_preparation(api_db, people, stage):
    book = live(api_db)
    if stage == "review":
        refuses(
            "INMATE_REGISTER_STALE_PROJECTION",
            prepare,
            api_db,
            people,
            fingerprint="0" * 64,
        )
    viewed = prepare(api_db, people)
    if stage == "approve":
        viewed = handoff(api_db, viewed, people[1], people[2])
    version = book.versions[0]
    version.fields = {**version.fields, "inmates": [_inmate("صف معدل بعد التحضير")]}
    api_db.commit()
    if stage == "review":
        refuses(
            "INMATE_REGISTER_STALE_PROJECTION",
            handoff,
            api_db,
            viewed,
            people[1],
            people[2],
        )
    else:
        refuses("INMATE_REGISTER_STALE_PROJECTION", approve, api_db, people, viewed)
    assert s.build_month(api_db, 2026, 8).workflow["needs_review"]


def test_hash_includes_source_version_but_ignores_manual_creator_display_name(api_db, people):
    book = live(api_db, month=7)
    viewed = review(api_db, people, month=7)
    old = book.versions[0]
    api_db.add(
        m.BookVersion(
            book_id=book.id,
            version_no=2,
            template_id=old.template_id,
            fields=old.fields,
            status="approved",
        )
    )
    api_db.commit()
    refuses("INMATE_REGISTER_STALE_PROJECTION", approve, api_db, people, viewed, month=7)
    manual(api_db, people[0])
    viewed = review(api_db, people)
    people[0].display_name = "Renamed account"
    api_db.commit()
    assert approve(api_db, people, viewed).closed


@pytest.mark.parametrize(
    ("case", "code"),
    [
        ("running_admin", "INMATE_REGISTER_MONTH_NOT_ENDED"),
        ("empty", "INMATE_REGISTER_MONTH_EMPTY"),
        ("incomplete", "INMATE_REGISTER_INCOMPLETE_ENTRIES"),
        ("missing_wing", "INMATE_REGISTER_INCOMPLETE_ENTRIES"),
        ("noncanonical_wing", "INMATE_REGISTER_INCOMPLETE_ENTRIES"),
    ],
)
def test_final_approval_refuses_unsealable_months(api_db, people, case, code):
    month, manager = (9, people[4]) if case == "running_admin" else (8, people[2])
    if case == "incomplete":
        _record(api_db, report_date="2026-08-05", imported_names=["قيد الإكمال"])
    elif case != "empty":
        live(
            api_db,
            month=month,
            wing={"missing_wing": "", "noncanonical_wing": "A1"}.get(case, "1A"),
        )
    viewed = review(api_db, people, month=month, manager=manager)
    if case == "running_admin":
        assert viewed.workflow["state"] == "awaiting_manager"
        assert api_db.scalar(select(func.count()).select_from(m.InmateViolationPeriod)) == 0
    refuses(code, approve, api_db, people, viewed, month=month, actor=manager)
    assert not s.build_month(api_db, 2026, month).closed


def test_local_edit_retires_a_prepared_cycle_even_if_the_value_is_restored(api_db, people):
    row = manual(api_db, people[0])
    review(api_db, people)
    s.update_manual_row(api_db, row.id, actor=people[0], changes={"wing": "1B"})
    s.update_manual_row(api_db, row.id, actor=people[0], changes={"wing": "1A"})
    current = s.build_month(api_db, 2026, 8)
    assert current.entries[0].wing == "1A"
    assert current.workflow["state"] == "draft" and current.workflow["prepared"] is None


def test_reasoned_reopen_keeps_rows_and_audit_actors_then_requires_a_new_cycle(api_db, people):
    live(api_db)
    closed = approve(api_db, people, review(api_db, people))
    refuses(
        "INMATE_REGISTER_REASON_REQUIRED",
        reasoned,
        s.reopen_month,
        api_db,
        closed,
        people[4],
        " ",
    )
    opened = reasoned(s.reopen_month, api_db, closed, people[4], "تصحيح")
    assert opened.workflow["state"] == "draft" and opened.workflow["prepared"] is None
    assert api_db.scalar(select(func.count()).select_from(m.InmateViolationStatRow)) == 1
    reopen_log = api_db.scalars(
        select(m.AuditLog).where(m.AuditLog.action == "inmate_violation_month_reopened")
    ).one()
    old_actors = json.loads(reopen_log.payload)["actors"]
    assert [old_actors[key]["user_id"] for key in ("prepared", "reviewed", "approved")] == [
        user.id for user in people[:3]
    ]
    assert approve(api_db, people, review(api_db, people)).closed
    assert json.loads(reopen_log.payload)["actors"] == old_actors


def test_return_requires_reason_and_reports_the_actor_and_reason(api_db, people):
    live(api_db)
    viewed = prepare(api_db, people)
    refuses(
        "INMATE_REGISTER_REASON_REQUIRED",
        reasoned,
        s.return_month,
        api_db,
        viewed,
        people[1],
        "",
    )
    returned = reasoned(s.return_month, api_db, viewed, people[1], "تصحيح")
    event = returned.workflow["last_event"]
    assert returned.workflow["state"] == "draft"
    assert (event["action"], event["user_id"], event["reason"]) == (
        "returned",
        people[1].id,
        "تصحيح",
    )


def test_export_copy_is_versioned_and_failure_rolls_back_without_overwriting(
    api_db, people, monkeypatch
):
    live(api_db)
    closed = approve(api_db, people, review(api_db, people))
    period = api_db.scalar(select(m.InmateViolationPeriod))
    old_path = period.export_path
    old_bytes = (s.get_settings().data_dir / old_path).read_bytes()
    assert old_path == f"inmate_violations/2026-08-v{closed.workflow['version']}.xlsx"
    reasoned(s.reopen_month, api_db, closed, people[4], "new cycle")
    viewed, write_copy = review(api_db, people), s._write_export_copy

    def fail_after_write(*args, **kwargs):
        write_copy(*args, **kwargs)
        raise OSError("publication failed")

    monkeypatch.setattr(s, "_write_export_copy", fail_after_write)
    with pytest.raises(OSError):
        approve(api_db, people, viewed)
    api_db.expire_all()
    period = api_db.scalar(select(m.InmateViolationPeriod))
    assert period.closed_at is None and period.export_path == old_path
    assert (s.get_settings().data_dir / old_path).read_bytes() == old_bytes


def test_wal_concurrent_final_approvals_accept_exactly_one(api_db, people):
    live(api_db)
    viewed = review(api_db, people)
    manager_id, expected = people[2].id, viewed.workflow["version"]
    wal(api_db)
    ready = Event()

    def attempt():
        with Session(api_db.bind, autoflush=False, expire_on_commit=False) as db:
            ready.wait(5)
            try:
                s.approve_month(
                    db, 2026, 8, actor=db.get(m.User, manager_id), expected_version=expected
                )
                return "approved"
            except AppError:
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        attempts = [executor.submit(attempt) for _ in range(2)]
        ready.set()
        assert sorted(task.result(10) for task in attempts) == ["approved", "conflict"]
    api_db.expire_all()
    logs = api_db.scalars(
        select(m.AuditLog).where(m.AuditLog.action == "inmate_violation_month_closed")
    ).all()
    assert (
        len(logs) == api_db.scalar(select(func.count()).select_from(m.InmateViolationStatRow)) == 1
    )


@pytest.mark.parametrize("winner", ["approval", "edit"])
def test_wal_manual_edit_and_approval_are_atomic(api_db, people, monkeypatch, winner):
    row = manual(api_db, people[0])
    viewed = review(api_db, people)
    ids = row.id, people[0].id, people[2].id
    wal(api_db)
    acquired, release = Event(), Event()
    hook = "_freeze" if winner == "approval" else "_reserve_local_edit"
    original = getattr(s, hook)

    def pause(*args, **kwargs):
        result = original(*args, **kwargs)
        acquired.set()
        assert release.wait(5)
        return result

    monkeypatch.setattr(s, hook, pause)

    def act(which):
        with Session(api_db.bind, autoflush=False, expire_on_commit=False) as db:
            try:
                if which == "approval":
                    s.approve_month(
                        db,
                        2026,
                        8,
                        actor=db.get(m.User, ids[2]),
                        expected_version=viewed.workflow["version"],
                    )
                    return "approved"
                s.update_manual_row(
                    db,
                    ids[0],
                    actor=db.get(m.User, ids[1]),
                    changes={"name": "اسم معدل"},
                )
                return "edited"
            except AppError:
                return "conflict"

    first_kind, second_kind = ("approval", "edit") if winner == "approval" else ("edit", "approval")
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(act, first_kind)
        assert acquired.wait(5)
        second = executor.submit(act, second_kind)
        release.set()
        results = {first.result(10), second.result(10)}
    api_db.expire_all()
    current = s.build_month(api_db, 2026, 8)
    if winner == "approval":
        assert results == {"approved", "conflict"} and current.closed
        assert api_db.get(m.InmateViolationManualRow, ids[0]).name == "نزيل"
        assert api_db.scalar(select(func.count()).select_from(m.InmateViolationStatRow)) == 1
    else:
        assert results == {"edited", "conflict"} and not current.closed
        assert current.workflow["state"] == "draft" and current.workflow["prepared"] is None


def test_routes_complete_chain_refresh_actions_and_reject_direct_or_forced_close(api_db, people):
    live(api_db)
    current = {"user": people[0]}
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    install_handlers(app)
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    client = TestClient(app)
    path = "/api/v1/inmate-violations/statistics/2026/8"

    def post(stage, body, forced=False):
        if forced:
            body = {**body, "force_reason": "x"}
        return client.post(f"{path}/{stage}", json=body)

    viewed = client.get(path).json()
    prepare_body = {
        "expected_version": viewed["workflow"]["version"],
        "expected_projection_fingerprint": viewed["projection_fingerprint"],
        "reviewer_user_id": people[1].id,
    }
    assert viewed["workflow"]["allowed_actions"] == ["prepare"]
    assert post("prepare", prepare_body, forced=True).status_code == 422
    viewed = post("prepare", prepare_body).json()
    current["user"] = people[1]
    actions = client.get(path).json()["workflow"]["allowed_actions"]
    assert set(actions) == {"review", "return"}
    review_body = {
        "expected_version": viewed["workflow"]["version"],
        "manager_user_id": people[2].id,
    }
    return_body = {"expected_version": viewed["workflow"]["version"], "reason": "x"}
    assert post("return", return_body, forced=True).status_code == 422
    assert post("review", review_body, forced=True).status_code == 422
    viewed = post("review", review_body).json()
    current["user"] = people[2]
    actions = client.get(path).json()["workflow"]["allowed_actions"]
    assert set(actions) == {"approve", "return"}
    approve_body = {"expected_version": viewed["workflow"]["version"]}
    assert post("approve", approve_body, forced=True).status_code == 422
    closed = post("approve", approve_body).json()
    assert closed["closed"] and closed["workflow"]["allowed_actions"] == []
    current["user"] = people[4]
    assert client.get(path).json()["workflow"]["allowed_actions"] == ["reopen"]
    reopen = {"expected_version": closed["workflow"]["version"], "reason": "x"}
    assert post("reopen", reopen, forced=True).status_code == 422
    assert post("close", {}).status_code == 404
