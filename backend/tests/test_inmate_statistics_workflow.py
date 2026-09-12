"""Behavioral proof of the inmate-specific three-person monthly approval."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime, timedelta
from io import BytesIO
from itertools import count
from threading import Event

import pytest
from backend.tests import test_inmate_statistics as fixtures
from backend.tests.test_inmate_statistics import _inmate, _record
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import AppError, install_handlers
from app.api.v1.inmate_statistics import router
from app.db.models import (
    BookVersion,
    Employee,
    InmateViolationManualRow,
    InmateViolationPeriod,
    InmateViolationStatRow,
    InmateViolationSubmission,
    InmateViolationWorkflow,
    InmateViolationWorkflowAction,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.services import inmate_statistics_service as service

api_db = fixtures.api_db


@pytest.fixture()
def people(api_db):
    result = []
    for index in range(5):
        employee = Employee(id=f"GWF{index}", name_ar=f"الموظف التجريبي {index}", name_en="Test")
        api_db.add(employee)
        api_db.flush()
        user = User(
            email=f"workflow{index}@example.test",
            password_hash="x",
            role="manager" if index < 4 else "admin",
            status="active",
            employee_id=employee.id,
        )
        api_db.add(user)
        result.append(user)
    api_db.commit()
    return result


def live(api_db, month=8, wing="1A"):
    return _record(
        api_db, report_date=f"2026-{month:02d}-05", inmates=[_inmate("نزيل تجريبي", wing=wing)]
    )


def prepare(api_db, people, month=8, **overrides):
    view = service.build_month(api_db, 2026, month, actor=people[0])
    arguments = dict(
        actor=people[0],
        expected_version=view.workflow["version"],
        expected_projection_fingerprint=view.projection_fingerprint,
        reviewer_user_id=people[1].id,
    )
    arguments.update(overrides)
    return service.prepare_month(api_db, 2026, month, **arguments)


def review(api_db, people, month=8):
    view = prepare(api_db, people, month)
    return service.review_month(
        api_db,
        2026,
        month,
        actor=people[1],
        expected_version=view.workflow["version"],
        submission_id=view.workflow["active_submission_id"],
        manager_user_id=people[2].id,
    )


def approve(api_db, people, view, month=8, **overrides):
    arguments = dict(
        actor=people[2],
        expected_version=view.workflow["version"],
        submission_id=view.workflow["active_submission_id"],
        today=date(2026, 9, 12),
    )
    arguments.update(overrides)
    return service.approve_month(api_db, 2026, month, **arguments)


def test_canonical_wings_cover_all_ties_zero_and_unassigned(api_db):
    _record(
        api_db,
        report_date="2026-08-05",
        inmates=[_inmate("أ", wing=" 1a "), _inmate("ب", wing="2B"), _inmate("ج", wing="A1")],
    )
    view = service.build_month(api_db, 2026, 8)
    assert hasattr(view, "wing_summary"), "Month must carry canonical wing analysis"
    summary = view.wing_summary
    assert [item["wing"] for item in summary["counts"]] == [
        f"{i}{letter}" for i in range(1, 7) for letter in "AB"
    ]
    assert summary["most"] == summary["least"] == ["1A", "2B"]
    assert summary["unassigned_count"] == 1
    assert len(summary["zero"]) == 10
    assert view.entries[2].wing == "A1" and "wing" in view.entries[2].missing


def test_empty_wings_have_no_positive_extrema(api_db):
    view = service.build_month(api_db, 2026, 8)
    assert hasattr(view, "wing_summary"), "Month must carry canonical wing analysis"
    assert view.wing_summary["most"] == view.wing_summary["least"] == []
    assert len(view.wing_summary["zero"]) == 12


def test_prepare_and_review_current_month_create_no_period(api_db, people):
    live(api_db, month=9)
    view = review(api_db, people, month=9)
    assert view.workflow["state"] == "awaiting_manager"
    assert api_db.scalar(select(func.count()).select_from(InmateViolationPeriod)) == 0
    with pytest.raises(AppError) as error:
        approve(api_db, people, view, month=9)
    assert error.value.code == "INMATE_REGISTER_MONTH_NOT_ENDED"
    assert service.build_month(api_db, 2026, 9).workflow["approved"] is None


def test_approval_seals_reviewed_snapshot_and_actor_identity(api_db, people):
    live(api_db)
    viewed = review(api_db, people)
    closed = approve(api_db, people, viewed)
    assert closed.closed and closed.workflow["state"] == "closed"
    submission_id = closed.workflow["active_submission_id"]
    original = service.submission_month(api_db, 2026, 8, submission_id)
    assert original.projection_fingerprint == viewed.projection_fingerprint
    assert original.workflow["approved"]["employee_id"] == people[2].employee_id
    people[2].employee.name_ar = "اسم مختلف"
    api_db.commit()
    assert (
        service.submission_month(api_db, 2026, 8, submission_id).workflow["approved"]["name_ar"]
        != "اسم مختلف"
    )


@pytest.mark.parametrize("stage", ["review", "approve"])
@pytest.mark.parametrize(
    "damage",
    [
        "row_changed",
        "schema_version",
        "wrong_year",
        "wrong_month",
        "invalid_entry_type",
        "missing_entry_field",
        "invalid_entries",
        "checksum_changed",
    ],
)
def test_corrupted_submission_refuses_advancement_atomically(api_db, people, stage, damage):
    live(api_db)
    view = prepare(api_db, people) if stage == "review" else review(api_db, people)
    submission_id = view.workflow["active_submission_id"]
    version = view.workflow["version"]
    submission = api_db.get(InmateViolationSubmission, submission_id)
    payload = deepcopy(submission.payload)
    if damage == "row_changed":
        payload["entries"][0]["name"] = "corrupted stored name"
    elif damage == "schema_version":
        payload["schema_version"] = 2
    elif damage == "wrong_year":
        payload["year"] = 2025
    elif damage == "wrong_month":
        payload["month"] = 7
    elif damage == "invalid_entry_type":
        payload["entries"][0]["name"] = ["not a scalar name"]
    elif damage == "missing_entry_field":
        del payload["entries"][0]["manual_created_by_name"]
    elif damage == "invalid_entries":
        payload["entries"] = None
    else:
        submission.fingerprint = "0" * 64
    submission.payload = payload
    # A matching digest never makes a malformed/wrong-month schema acceptable.
    if damage in {"schema_version", "wrong_year", "wrong_month", "invalid_entry_type"}:
        submission.fingerprint = service._fingerprint(payload)
    api_db.commit()
    with pytest.raises(AppError) as error:
        if stage == "review":
            service.review_month(
                api_db,
                2026,
                8,
                actor=people[1],
                expected_version=version,
                submission_id=submission_id,
                manager_user_id=people[2].id,
            )
        else:
            approve(api_db, people, view)
    assert error.value.code == "INMATE_REGISTER_INVALID_SUBMISSION"
    root = api_db.scalar(select(InmateViolationWorkflow))
    assert root.version == version
    assert root.state == ("awaiting_review" if stage == "review" else "awaiting_manager")
    event_kind = "reviewed" if stage == "review" else "approved"
    assert (
        api_db.scalar(
            select(func.count())
            .select_from(InmateViolationWorkflowAction)
            .where(
                InmateViolationWorkflowAction.submission_id == submission_id,
                InmateViolationWorkflowAction.action == event_kind,
            )
        )
        == 0
    )
    assert api_db.scalar(select(func.count()).select_from(InmateViolationPeriod)) == 0
    assert api_db.scalar(select(func.count()).select_from(InmateViolationStatRow)) == 0
    assert not list(service.get_settings().data_dir.glob("inmate_violations/*.xlsx"))


def test_approval_action_and_period_share_one_exact_instant(api_db, people, monkeypatch):
    live(api_db)
    viewed = review(api_db, people)
    ticks = count()
    monkeypatch.setattr(
        service, "_utcnow", lambda: datetime(2026, 9, 13, 1) + timedelta(microseconds=next(ticks))
    )
    closed = approve(api_db, people, viewed)
    approved_at = closed.workflow["approved"]["acted_at"]
    assert closed.closed_at == approved_at
    period = api_db.scalar(select(InmateViolationPeriod))
    event = api_db.scalar(
        select(InmateViolationWorkflowAction).where(
            InmateViolationWorkflowAction.action == "approved"
        )
    )
    assert period.closed_at == event.occurred_at == approved_at
    submission = api_db.get(InmateViolationSubmission, viewed.workflow["active_submission_id"])
    assert submission.created_at is not None
    assert service.submission_month(api_db, 2026, 8, submission.id).closed_at == approved_at


@pytest.mark.parametrize("old_archive_timestamp", [None, datetime(2026, 9, 13, 1)])
def test_legacy_creation_never_fabricates_or_exposes_issue_time(
    api_db, people, old_archive_timestamp
):
    live(api_db)
    prepared = prepare(api_db, people)
    current = api_db.get(InmateViolationSubmission, prepared.workflow["active_submission_id"])
    legacy = InmateViolationSubmission(
        workflow_id=current.workflow_id,
        sequence=2,
        origin="legacy",
        payload=current.payload,
        fingerprint=current.fingerprint,
        created_at=old_archive_timestamp,
        legacy_metadata={},
    )
    api_db.add(legacy)
    api_db.commit()
    if old_archive_timestamp is None:
        assert legacy.created_at is None
    summary = service.submission_history(api_db, 2026, 8)[0]
    assert summary["created_at"] is None
    assert service.submission_detail(api_db, 2026, 8, legacy.id)["created_at"] is None
    assert current.created_at is not None


@pytest.mark.parametrize(
    "kind",
    [
        "same_user",
        "same_employee",
        "missing_arabic",
        "disabled",
        "denied_navigation",
        "denied_template",
    ],
)
def test_reviewer_selection_uses_full_identity_and_capability_policy(api_db, people, kind):
    live(api_db)
    selected = people[1]
    if kind == "same_user":
        selected = people[0]
    elif kind == "same_employee":
        selected.employee_id = people[0].employee_id
    elif kind == "missing_arabic":
        selected.employee.name_ar = " "
    elif kind == "disabled":
        selected.status = "disabled"
    else:
        capability = (
            "documents.generate"
            if kind == "denied_navigation"
            else f"books.service.{service.TEMPLATE_ID}"
        )
        api_db.add(UserPermission(user_id=selected.id, capability=capability, effect="deny"))
    api_db.commit()
    with pytest.raises(AppError):
        prepare(api_db, people, reviewer_user_id=selected.id)
    assert api_db.scalar(select(func.count()).select_from(InmateViolationPeriod)) == 0


@pytest.mark.parametrize("change", ["relink", "disable", "revoke", "wrong_person"])
def test_handoff_rechecks_assignee_after_selection(api_db, people, change):
    live(api_db)
    view = prepare(api_db, people)
    actor = people[1]
    if change == "relink":
        actor.employee_id = people[3].employee_id
    elif change == "disable":
        actor.status = "disabled"
    elif change == "revoke":
        api_db.add(
            UserPermission(user_id=actor.id, capability="inmate_statistics.review", effect="deny")
        )
    else:
        actor = people[4]
    api_db.commit()
    with pytest.raises(AppError):
        service.review_month(
            api_db,
            2026,
            8,
            actor=actor,
            expected_version=view.workflow["version"],
            submission_id=view.workflow["active_submission_id"],
            manager_user_id=people[2].id,
        )
    assert service.build_month(api_db, 2026, 8).workflow["reviewed"] is None


def test_preview_fingerprint_and_source_revision_are_freshness_gates(api_db, people):
    book = live(api_db)
    with pytest.raises(AppError) as error:
        prepare(api_db, people, expected_projection_fingerprint="0" * 64)
    assert error.value.code == "INMATE_REGISTER_STALE_PROJECTION"
    view = review(api_db, people)
    version = book.versions[0]
    version.fields = {**version.fields, "violation_details": "Changed"}
    api_db.commit()
    assert service.build_month(api_db, 2026, 8).workflow["needs_review"]
    with pytest.raises(AppError) as error:
        approve(api_db, people, view)
    assert error.value.code == "INMATE_REGISTER_STALE_PROJECTION"
    assert not service.build_month(api_db, 2026, 8).closed


@pytest.mark.parametrize("wing", ["", "A1"])
def test_final_approval_refuses_missing_or_unknown_wing(api_db, people, wing):
    live(api_db, wing=wing)
    view = review(api_db, people)
    with pytest.raises(AppError) as error:
        approve(api_db, people, view)
    assert error.value.code == "INMATE_REGISTER_INCOMPLETE_ENTRIES"


def test_local_change_invalidates_even_if_value_is_restored(api_db, people):
    row = service.create_manual_row(
        api_db,
        2026,
        8,
        actor=people[0],
        name="نزيل",
        violation_date=date(2026, 8, 1),
        reason="إضافة",
        nationality_label="الامارات",
        wing="1A",
        details_text="تفاصيل",
    )
    view = review(api_db, people)
    service.update_manual_row(api_db, row.id, actor=people[0], changes={"wing": "1B"})
    service.update_manual_row(api_db, row.id, actor=people[0], changes={"wing": "1A"})
    assert service.build_month(api_db, 2026, 8).workflow["needs_review"]
    with pytest.raises(AppError):
        approve(api_db, people, view)


def test_reasoned_reopen_preserves_history_and_requires_new_cycle(api_db, people):
    live(api_db)
    view = approve(api_db, people, review(api_db, people))
    with pytest.raises(AppError):
        service.reopen_month(
            api_db, 2026, 8, actor=people[4], expected_version=view.workflow["version"], reason=" "
        )
    opened = service.reopen_month(
        api_db, 2026, 8, actor=people[4], expected_version=view.workflow["version"], reason="تصحيح"
    )
    assert opened.workflow["state"] == "draft"
    assert opened.workflow["approved"] is None
    old = service.submission_month(api_db, 2026, 8, view.workflow["active_submission_id"])
    assert old.closed and old.workflow["approved"]
    assert old.workflow["allowed_actions"] == []
    new = approve(api_db, people, review(api_db, people))
    assert new.workflow["active_submission_id"] != old.workflow["active_submission_id"]


def test_current_month_broken_assignment_is_admin_recovery_task(api_db, people):
    live(api_db, month=9)
    view = prepare(api_db, people, month=9)
    people[1].employee_id = people[3].employee_id
    api_db.commit()
    tasks = service.workflow_tasks(api_db, actor=people[4])
    assert any(
        task["kind"] == "recovery"
        and task["submission_id"] == view.workflow["active_submission_id"]
        for task in tasks
    )
    assert not service.workflow_tasks(api_db, actor=people[1])


@pytest.mark.parametrize("caller_index", [3, 4])
def test_unrelated_task_polling_does_not_project_active_months(
    api_db, people, monkeypatch, caller_index
):
    for month in (7, 8, 9):
        live(api_db, month=month)
        review(api_db, people, month=month)
    projected = []
    original = service.effective_projection

    def track_projection(db, year, month):
        projected.append((year, month))
        return original(db, year, month)

    monkeypatch.setattr(service, "effective_projection", track_projection)
    assert service.workflow_tasks(api_db, actor=people[caller_index]) == []
    assert projected == []


def test_admin_recovers_stale_report_with_ineligible_preparer(api_db, people):
    book = live(api_db, month=9)
    submitted = prepare(api_db, people, month=9)
    version = book.versions[0]
    version.fields = {**version.fields, "violation_details": "Changed after preparation"}
    people[0].status = "disabled"
    api_db.commit()
    tasks = service.workflow_tasks(api_db, actor=people[4])
    assert [(item["kind"], item["submission_id"]) for item in tasks] == [
        ("recovery", submitted.workflow["active_submission_id"])
    ]


@pytest.mark.parametrize("profile", ["linked", "missing_employee", "missing_arabic"])
def test_local_invalidation_preserves_available_actor_facts(api_db, people, profile):
    row = service.create_manual_row(
        api_db,
        2026,
        8,
        actor=people[0],
        name="نزيل",
        violation_date=date(2026, 8, 1),
        reason="إضافة",
        nationality_label="الامارات",
        wing="1A",
        details_text="تفاصيل",
    )
    review(api_db, people)
    editor = people[3]
    if profile == "missing_employee":
        editor.employee_id = None
    elif profile == "missing_arabic":
        editor.employee.name_ar = " "
    api_db.commit()
    expected_employee_id = editor.employee_id
    expected_name = "الموظف التجريبي 3" if profile == "linked" else None
    editor_id = editor.id
    service.update_manual_row(api_db, row.id, actor=editor, changes={"wing": "1B"})
    if editor.employee_id:
        editor.employee.name_ar = "اسم محدث"
    editor.employee_id = people[4].employee_id
    api_db.commit()
    event = api_db.scalar(
        select(InmateViolationWorkflowAction).where(
            InmateViolationWorkflowAction.action == "invalidated"
        )
    )
    assert event.actor_user_id == editor_id
    assert event.actor_employee_id == expected_employee_id
    assert event.actor_name_ar == expected_name


def test_return_and_fresh_supersede_need_reason_and_preserve_old_task_identity(api_db, people):
    live(api_db)
    original = prepare(api_db, people)
    with pytest.raises(AppError):
        prepare(api_db, people)
    with pytest.raises(AppError):
        prepare(
            api_db,
            people,
            actor=people[3],
            reviewer_user_id=people[1].id,
            supersede_reason="replace",
        )
    with pytest.raises(AppError):
        service.workflow_candidates(api_db, 2026, 8, actor=people[3], stage="review")
    replacement = prepare(api_db, people, supersede_reason="correct assignment")
    assert replacement.workflow["active_submission_id"] != original.workflow["active_submission_id"]
    with pytest.raises(AppError):
        service.review_month(
            api_db,
            2026,
            8,
            actor=people[1],
            expected_version=replacement.workflow["version"],
            submission_id=original.workflow["active_submission_id"],
            manager_user_id=people[2].id,
        )
    returned = service.return_month(
        api_db,
        2026,
        8,
        actor=people[1],
        expected_version=replacement.workflow["version"],
        submission_id=replacement.workflow["active_submission_id"],
        reason="correct details",
    )
    assert returned.workflow["state"] == "draft" and returned.workflow["prepared"] is None
    assert not any(
        task["kind"] == "review" for task in service.workflow_tasks(api_db, actor=people[1])
    )


def test_new_source_version_changes_fingerprint_even_when_row_text_is_equal(api_db, people):
    book = live(api_db)
    view = review(api_db, people)
    old = book.versions[0]
    api_db.add(
        BookVersion(
            book_id=book.id,
            version_no=2,
            template_id=old.template_id,
            fields=old.fields,
            status="approved",
        )
    )
    api_db.commit()
    with pytest.raises(AppError) as error:
        approve(api_db, people, view)
    assert error.value.code == "INMATE_REGISTER_STALE_PROJECTION"


def test_manual_creator_display_rename_does_not_invalidate_report(api_db, people):
    service.create_manual_row(
        api_db,
        2026,
        8,
        actor=people[0],
        name="نزيل",
        violation_date=date(2026, 8, 1),
        reason="إضافة",
        nationality_label="الامارات",
        wing="1A",
        details_text="تفاصيل",
    )
    view = review(api_db, people)
    people[0].display_name = "Renamed display"
    api_db.commit()
    assert approve(api_db, people, view).closed


def test_selected_submission_export_keeps_own_rows_after_reopening(api_db, people):
    book = live(api_db)
    closed = approve(api_db, people, review(api_db, people))
    original_id = closed.workflow["active_submission_id"]
    service.reopen_month(
        api_db,
        2026,
        8,
        actor=people[4],
        expected_version=closed.workflow["version"],
        reason="change",
    )
    version = book.versions[0]
    version.fields = {**version.fields, "inmates": [_inmate("Changed synthetic")]}
    api_db.commit()
    for language in ("ar", "en"):
        payload, _ = service.export_workbook(
            api_db, 2026, 8, submission_id=original_id, language=language
        )
        workbook = load_workbook(BytesIO(payload))
        values = str([cell.value for sheet in workbook for row in sheet for cell in row])
        assert "نزيل تجريبي" in values and "Changed synthetic" not in values
    assert not service.build_month(api_db, 2026, 8).closed


def test_export_failure_rolls_back_approval_without_replacing_prior_cache(
    api_db, people, monkeypatch
):
    live(api_db)
    closed = approve(api_db, people, review(api_db, people))
    period = api_db.scalar(select(InmateViolationPeriod))
    prior_path = period.export_path
    prior_bytes = (service.get_settings().data_dir / prior_path).read_bytes()
    service.reopen_month(
        api_db,
        2026,
        8,
        actor=people[4],
        expected_version=closed.workflow["version"],
        reason="new cycle",
    )
    next_view = review(api_db, people)
    write = service._write_export_copy

    def failing(*args, **kwargs):
        write(*args, **kwargs)
        raise OSError("simulated publication failure")

    monkeypatch.setattr(service, "_write_export_copy", failing)
    with pytest.raises(OSError):
        approve(api_db, people, next_view)
    api_db.expire_all()
    period = api_db.scalar(select(InmateViolationPeriod))
    assert period.closed_at is None and period.export_path == prior_path
    assert (service.get_settings().data_dir / prior_path).read_bytes() == prior_bytes
    assert service.build_month(api_db, 2026, 8).workflow["approved"] is None


def test_wal_concurrent_final_approvals_accept_exactly_one(api_db, people):
    live(api_db)
    view = review(api_db, people)
    manager_id = people[2].id
    api_db.commit()
    with api_db.bind.connect() as connection:
        connection.execute(text("PRAGMA journal_mode=WAL"))
    ready = Event()

    def attempt():
        with Session(api_db.bind, autoflush=False, expire_on_commit=False) as db:
            actor = db.get(User, manager_id)
            ready.wait(5)
            try:
                service.approve_month(
                    db,
                    2026,
                    8,
                    actor=actor,
                    expected_version=view.workflow["version"],
                    submission_id=view.workflow["active_submission_id"],
                )
                return "approved"
            except AppError:
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        first, second = executor.submit(attempt), executor.submit(attempt)
        ready.set()
        assert sorted([first.result(10), second.result(10)]) == ["approved", "conflict"]
    api_db.expire_all()
    assert (
        api_db.scalar(
            select(func.count())
            .select_from(InmateViolationWorkflowAction)
            .where(InmateViolationWorkflowAction.action == "approved")
        )
        == 1
    )


def test_local_edit_that_observed_open_month_refuses_when_approval_wins(
    api_db, people, monkeypatch
):
    row = service.create_manual_row(
        api_db,
        2026,
        8,
        actor=people[0],
        name="نزيل",
        violation_date=date(2026, 8, 1),
        reason="إضافة",
        nationality_label="الامارات",
        wing="1A",
        details_text="تفاصيل",
    )
    view = review(api_db, people)
    row_id, manager_id, editor_id = row.id, people[2].id, people[0].id
    api_db.commit()
    with api_db.bind.connect() as connection:
        connection.execute(text("PRAGMA journal_mode=WAL"))
    sealing, release, editing = Event(), Event(), Event()
    original_freeze = service._freeze

    def paused_freeze(*args, **kwargs):
        sealing.set()
        assert release.wait(5)
        return original_freeze(*args, **kwargs)

    monkeypatch.setattr(service, "_freeze", paused_freeze)
    with Session(api_db.bind, autoflush=False, expire_on_commit=False) as edit_db:
        edit_actor = edit_db.get(User, editor_id)
        assert not service.build_month(edit_db, 2026, 8).closed

        def finalize():
            with Session(api_db.bind, autoflush=False, expire_on_commit=False) as db:
                return service.approve_month(
                    db,
                    2026,
                    8,
                    actor=db.get(User, manager_id),
                    expected_version=view.workflow["version"],
                    submission_id=view.workflow["active_submission_id"],
                )

        def edit():
            editing.set()
            try:
                service.update_manual_row(
                    edit_db, row_id, actor=edit_actor, changes={"name": "must not save"}
                )
            except AppError:
                return "conflict"
            return "saved"

        with ThreadPoolExecutor(max_workers=2) as executor:
            final = executor.submit(finalize)
            assert sealing.wait(5)
            mutation = executor.submit(edit)
            assert editing.wait(5)
            release.set()
            assert final.result(10).closed
            assert mutation.result(10) == "conflict"
    api_db.expire_all()
    assert api_db.get(InmateViolationManualRow, row_id).name == "نزيل"


def test_routes_complete_chain_publish_history_and_reject_force_input(api_db, people):
    live(api_db)
    current = {"user": people[0]}
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    install_handlers(app)
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    client = TestClient(app)
    path = "/api/v1/inmate-violations/statistics/2026/8"
    view = client.get(path).json()
    assert "prepare" in view["workflow"]["allowed_actions"]
    candidates = client.get(path + "/candidates?stage=review").json()
    assert all(set(item) == {"user_id", "name_ar", "employee_id"} for item in candidates)
    view = client.post(
        path + "/prepare",
        json={
            "expected_version": view["workflow"]["version"],
            "expected_projection_fingerprint": view["projection_fingerprint"],
            "reviewer_user_id": people[1].id,
        },
    ).json()
    submission_id = view["workflow"]["active_submission_id"]
    current["user"] = people[1]
    assert (
        client.get("/api/v1/inmate-violations/statistics/tasks").json()["items"][0]["submission_id"]
        == submission_id
    )
    response = client.post(
        path + "/review",
        json={
            "expected_version": view["workflow"]["version"],
            "submission_id": submission_id,
            "manager_user_id": people[2].id,
        },
    )
    assert response.status_code == 200
    view = response.json()
    current["user"] = people[2]
    body = {"expected_version": view["workflow"]["version"], "submission_id": submission_id}
    assert (
        client.post(path + "/approve", json={**body, "force_reason": "bypass"}).status_code == 422
    )
    response = client.post(path + "/approve", json=body)
    assert response.status_code == 200 and response.json()["closed"]
    detail = client.get(path + f"/submissions/{submission_id}").json()
    assert [event["action"] for event in detail.get("actions", [])] == [
        "prepared",
        "reviewed",
        "approved",
    ]
    assert detail["workflow"]["allowed_actions"] == []
    assert (
        client.get(
            "/api/v1/inmate-violations/statistics/2026/7/submissions/" + str(submission_id)
        ).status_code
        == 404
    )
    assert client.post(path + "/close", json={}).status_code == 404


@pytest.mark.parametrize("winner", ["approval", "source"])
def test_wal_source_writer_cannot_change_the_reviewed_seal_mid_transaction(
    api_db, people, monkeypatch, winner
):
    book = live(api_db)
    version_id = book.versions[0].id
    view = review(api_db, people)
    manager_id = people[2].id
    api_db.commit()
    with api_db.bind.connect() as connection:
        connection.execute(text("PRAGMA journal_mode=WAL"))
    acquired, release, other_started = Event(), Event(), Event()
    original_freeze = service._freeze
    if winner == "approval":

        def paused_freeze(*args, **kwargs):
            acquired.set()
            assert release.wait(5)
            return original_freeze(*args, **kwargs)

        monkeypatch.setattr(service, "_freeze", paused_freeze)

    def finalize():
        with Session(api_db.bind, autoflush=False, expire_on_commit=False) as db:
            actor = db.get(User, manager_id)
            if winner == "source":
                other_started.set()
            try:
                service.approve_month(
                    db,
                    2026,
                    8,
                    actor=actor,
                    expected_version=view.workflow["version"],
                    submission_id=view.workflow["active_submission_id"],
                )
                return "approved"
            except AppError as error:
                return error.code

    def source_write():
        with Session(api_db.bind, autoflush=False, expire_on_commit=False) as db:
            version = db.get(BookVersion, version_id)
            if winner == "approval":
                other_started.set()
            version.fields = {**version.fields, "violation_details": "source changed during race"}
            db.flush()
            if winner == "source":
                acquired.set()
                assert release.wait(5)
            db.commit()

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(finalize if winner == "approval" else source_write)
        assert acquired.wait(5)
        second = executor.submit(source_write if winner == "approval" else finalize)
        assert other_started.wait(5)
        release.set()
        result = first.result(10) if winner == "approval" else second.result(10)
        first.result(10)
        second.result(10)
    api_db.expire_all()
    current = service.build_month(api_db, 2026, 8)
    if winner == "approval":
        assert result == "approved" and current.closed
        assert current.projection_fingerprint == view.projection_fingerprint
        assert current.entries[0].details_text != "source changed during race"
    else:
        assert result == "INMATE_REGISTER_STALE_PROJECTION" and not current.closed
        assert current.workflow["approved"] is None


def test_local_writer_winning_invalidates_before_waiting_approval(api_db, people, monkeypatch):
    row = service.create_manual_row(
        api_db,
        2026,
        8,
        actor=people[0],
        name="نزيل",
        violation_date=date(2026, 8, 1),
        reason="إضافة",
        nationality_label="الامارات",
        wing="1A",
        details_text="تفاصيل",
    )
    view = review(api_db, people)
    manager_id, editor_id, row_id = people[2].id, people[0].id, row.id
    api_db.commit()
    with api_db.bind.connect() as connection:
        connection.execute(text("PRAGMA journal_mode=WAL"))
    acquired, release, approval_started = Event(), Event(), Event()
    original = service._reserve_local_edit

    def paused_edit(*args, **kwargs):
        original(*args, **kwargs)
        acquired.set()
        assert release.wait(5)

    monkeypatch.setattr(service, "_reserve_local_edit", paused_edit)

    def edit():
        with Session(api_db.bind, autoflush=False, expire_on_commit=False) as db:
            service.update_manual_row(
                db, row_id, actor=db.get(User, editor_id), changes={"wing": "1B"}
            )

    def finalize():
        with Session(api_db.bind, autoflush=False, expire_on_commit=False) as db:
            actor = db.get(User, manager_id)
            approval_started.set()
            try:
                service.approve_month(
                    db,
                    2026,
                    8,
                    actor=actor,
                    expected_version=view.workflow["version"],
                    submission_id=view.workflow["active_submission_id"],
                )
            except AppError:
                return "conflict"
            return "approved"

    with ThreadPoolExecutor(max_workers=2) as executor:
        mutation = executor.submit(edit)
        assert acquired.wait(5)
        final = executor.submit(finalize)
        assert approval_started.wait(5)
        release.set()
        mutation.result(10)
        assert final.result(10) == "conflict"
    api_db.expire_all()
    current = service.build_month(api_db, 2026, 8)
    assert current.workflow["needs_review"] and not current.closed
    assert current.entries[0].wing == "1B"
