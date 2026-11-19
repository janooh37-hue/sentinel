"""Leave mutations enqueue bounded attendance work only when an excusal changes."""

from datetime import date, datetime
from types import SimpleNamespace

import pytest
from PIL import Image
from sqlalchemy import select

from app.config import Settings
from app.core import form_policy
from app.db.models import Book, BookCategory, Document, Employee, Leave, Manager, User
from app.db.workforce_models import AttendanceEvaluationQueue
from app.schemas.leave import LeaveUpdate
from app.services import artifact_service, book_service, document_service, leave_service

START = date(2026, 8, 18)
END = date(2026, 8, 20)


def _queue(db):
    return db.scalars(select(AttendanceEvaluationQueue)).all()


def _assert_window(db, employee_id, reason, *, end=END):
    rows = _queue(db)
    assert len(rows) == 1
    row = rows[0]
    assert row.employee_id == employee_id
    # Dubai's inclusive leave dates become a half-open naive-UTC queue window.
    assert row.window_start_at == datetime(2026, 8, 17, 20)
    assert row.window_end_at == datetime.combine(end, datetime.min.time()).replace(hour=20)
    assert row.reason_codes == [reason]


def _clear_queue(db):
    # Simulate finished work so later assertions cannot pass from coalesced old work.
    for row in _queue(db):
        db.delete(row)
    db.commit()


@pytest.fixture
def generation_env(db_session, tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path / "data", templates_dir=document_service._TEMPLATES_DIR)
    for module in (document_service, artifact_service, book_service):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    for template in ("Leave Application Form", "Leave Permit Form", "Administrative Leave Form"):
        monkeypatch.setitem(form_policy.SIGNING_PATHS, template, "chain")
    employee = Employee(id="G-LEAVE-QUEUE", name_en="Leave Queue", status="Active")
    signer = User(
        email="queue-signer@test.example", password_hash="x", role="admin", status="active"
    )
    branch = User(
        email="queue-branch@test.example", password_hash="x", role="manager", status="active"
    )
    db_session.add_all((employee, signer, branch, BookCategory(id="HR", prefix="HR")))
    db_session.flush()
    manager = Manager(name_en="Queue Manager", user_id=signer.id)
    db_session.add(manager)
    db_session.commit()
    signature = tmp_path / "signature.png"
    Image.new("RGBA", (100, 40), (0, 0, 0, 255)).save(signature)
    monkeypatch.setattr(
        book_service.user_signature_service, "resolve_signature", lambda _: signature
    )
    render_signed = document_service.render_signed_artifact
    monkeypatch.setattr(
        document_service,
        "render_signed_artifact",
        lambda *args, **kwargs: render_signed(*args, **kwargs, converter=lambda _: None),
    )
    return SimpleNamespace(
        db=db_session, employee=employee, signer=signer, branch=branch, manager=manager
    )


def _generate(env, leave_type):
    template = {
        "Administrative Leave": "Administrative Leave Form",
        "Leave Permit": "Leave Permit Form",
    }.get(leave_type, "Leave Application Form")
    result = document_service.generate_document(
        env.db,
        employee_id=env.employee.id,
        template_id=template,
        fields={
            "date": "18/08/2026",
            "start_date": "18/08/2026",
            "end_date": "20/08/2026",
            "total_days": "3",
            "duration": "3",
            "duration_hours": "3",
            "leave_type": leave_type,
        },
        manager_id=env.manager.id,
        current_user=env.signer,
        converter=lambda _: None,
        notify_employee="silent",
    )
    book = env.db.get_one(Book, result.book_id)
    document = env.db.get_one(Document, book.versions[-1].document_id)
    return book, env.db.get_one(Leave, document.leave_id)


def _approve(env, book, leave):
    administrative = leave.leave_type == "Administrative Leave"
    book_service.submit_for_approval(
        env.db,
        book.id,
        submitted_by_user_id=env.signer.id,
        approver_user_id=env.signer.id,
        branch_approver_user_id=env.branch.id if administrative else None,
        priority="normal",
        reviewer_user_ids=[],
    )
    version_id = book.versions[-1].id
    if administrative:
        book_service.sign_book(env.db, book.id, user_id=env.branch.id, version_id=version_id)
        assert leave.status == "Pending"
        assert _queue(env.db) == []
    book_service.sign_book(env.db, book.id, user_id=env.signer.id, version_id=version_id)
    if leave.leave_type == "Annual Leave":
        # Annual's signed application remains Pending until the Leaves decision.
        assert leave.status == "Pending"
        assert _queue(env.db) == []
        leave_service.update_leave(
            env.db, leave.id, LeaveUpdate(status="Approved", notify_employee=False)
        )
    env.db.refresh(leave)
    assert leave.status == "Approved"


@pytest.mark.parametrize(
    "leave_type",
    ["Annual Leave", "Duty Leave", "Compassionate Leave", "Administrative Leave", "Leave Permit"],
)
def test_generated_creation_approval_and_cancellation_enqueue_only_excusing_kinds(
    generation_env, leave_type
):
    env = generation_env
    book, leave = _generate(env, leave_type)
    assert leave.status == "Pending"
    assert _queue(env.db) == []

    _approve(env, book, leave)
    if leave_type == "Leave Permit":
        assert _queue(env.db) == []
    else:
        _assert_window(env.db, env.employee.id, "LEAVE_APPROVED")
    _clear_queue(env.db)

    if leave_type == "Annual Leave":
        leave_service.update_leave(
            env.db, leave.id, LeaveUpdate(status="Cancelled", notify_employee=False)
        )
    else:
        book_service.override_state(
            env.db, book.id, target_state="voided", actor=env.signer, reason="Cancelled leave"
        )
    env.db.refresh(leave)
    assert leave.status == "Cancelled"
    if leave_type == "Leave Permit":
        assert _queue(env.db) == []
    else:
        _assert_window(env.db, env.employee.id, "LEAVE_CANCELLED")


@pytest.mark.parametrize(
    "leave_type", ["Duty Leave", "Compassionate Leave", "Administrative Leave", "Leave Permit"]
)
def test_generated_rejection_removes_only_an_excusing_approved_leave(generation_env, leave_type):
    env = generation_env
    book, leave = _generate(env, leave_type)
    _approve(env, book, leave)
    _clear_queue(env.db)

    book_service.override_state(
        env.db, book.id, target_state="rejected", actor=env.signer, reason="Approval withdrawn"
    )

    env.db.refresh(leave)
    assert leave.status == "Rejected"
    if leave_type == "Leave Permit":
        assert _queue(env.db) == []
    else:
        _assert_window(env.db, env.employee.id, "LEAVE_REJECTED")


def _persist_leave(db, leave_type, *, status="Pending"):
    employee = Employee(id="G-MUTATE-QUEUE", name_en="Mutation Queue", status="Active")
    leave = Leave(
        employee_id=employee.id,
        leave_type=leave_type,
        start_date=START,
        end_date=END,
        days=3,
        status=status,
    )
    db.add(employee)
    db.flush()
    db.add(leave)
    db.commit()
    return leave


@pytest.mark.parametrize("leave_type", ["Annual Leave", "Duty Leave", "Compassionate Leave"])
def test_leaves_page_approval_and_cancellation_enqueue_the_same_dates(db_session, leave_type):
    leave = _persist_leave(db_session, leave_type)
    leave_service.update_leave(
        db_session, leave.id, LeaveUpdate(status="Approved", notify_employee=False)
    )
    _assert_window(db_session, leave.employee_id, "LEAVE_APPROVED")
    _clear_queue(db_session)

    leave_service.update_leave(
        db_session, leave.id, LeaveUpdate(status="Cancelled", notify_employee=False)
    )

    _assert_window(db_session, leave.employee_id, "LEAVE_CANCELLED")


@pytest.mark.parametrize("leave_type", ["Annual Leave", "Duty Leave", "Compassionate Leave"])
def test_pending_request_date_edit_and_rejection_do_not_enqueue(db_session, leave_type):
    leave = _persist_leave(db_session, leave_type)
    leave_service.update_leave(db_session, leave.id, LeaveUpdate(end_date=date(2026, 8, 22)))
    assert _queue(db_session) == []

    leave_service.update_leave(
        db_session, leave.id, LeaveUpdate(status="Rejected", notify_employee=False)
    )

    assert _queue(db_session) == []


@pytest.mark.parametrize(
    "leave_type",
    ["Annual Leave", "Duty Leave", "Compassionate Leave", "Administrative Leave", "Leave Permit"],
)
def test_soft_delete_enqueues_the_previous_approved_excusal(db_session, leave_type):
    leave = _persist_leave(db_session, leave_type, status="Approved")

    leave_service.soft_delete_leave(db_session, leave.id)

    assert leave.deleted_at is not None
    if leave_type == "Leave Permit":
        assert _queue(db_session) == []
    else:
        _assert_window(db_session, leave.employee_id, "LEAVE_DELETED")


def test_annual_amendment_enqueues_union_of_old_and_new_dates(db_session):
    leave = _persist_leave(db_session, "Annual Leave", status="Approved")

    leave_service.amend_approved_leave(
        db_session, leave.id, end_date=date(2026, 8, 22), reason="Extended leave"
    )

    _assert_window(db_session, leave.employee_id, "LEAVE_AMENDED", end=date(2026, 8, 22))
