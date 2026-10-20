"""Generated leave records are settled by their record's signing chain, not Leaves PATCH."""

from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image
from sqlalchemy import select

from app.config import Settings
from app.core import form_policy, leave_lifecycle
from app.db.models import AuditLog, Book, BookCategory, Document, Employee, Leave, Manager, User
from app.services import artifact_service, book_service, document_service, notify_dispatch


@pytest.fixture()
def gate_env(db_session, tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path / "data", templates_dir=document_service._TEMPLATES_DIR)
    for module in (document_service, artifact_service, book_service):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    for template in ("Leave Permit Form", "Administrative Leave Form"):
        monkeypatch.setitem(form_policy.SIGNING_PATHS, template, "chain")
    employee = Employee(id="G-GATE", name_en="Gate Employee", status="Active")
    signer = User(email="signer@gate.test", password_hash="x", role="admin", status="active")
    db_session.add_all([employee, signer, BookCategory(id="HR", prefix="HR")])
    db_session.flush()
    manager = Manager(name_en="Gate Manager", user_id=signer.id)
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
    monkeypatch.setattr(notify_dispatch, "_autosend_enabled", lambda _: True)
    send = Mock()
    monkeypatch.setattr(notify_dispatch, "send_for_event", send)
    return SimpleNamespace(
        db=db_session, employee=employee, signer=signer, manager=manager, send=send
    )


def generate(env, template="Leave Permit Form", **kwargs):
    fields = {
        "date": "20/10/2026",
        "start_date": "20/10/2026",
        "end_date": "21/10/2026",
        "duration": "2",
        "duration_hours": "3",
        **kwargs.pop("fields", {}),
    }
    result = document_service.generate_document(
        env.db,
        employee_id=env.employee.id,
        template_id=template,
        fields=fields,
        manager_id=env.manager.id,
        current_user=env.signer,
        converter=lambda _: None,
        **kwargs,
    )
    book = env.db.get_one(Book, result.book_id)
    document = env.db.get_one(Document, book.versions[-1].document_id)
    return book, env.db.get_one(Leave, document.leave_id)


def submit(env, book):
    return book_service.submit_for_approval(
        env.db,
        book.id,
        submitted_by_user_id=env.signer.id,
        approver_user_id=env.signer.id,
        priority="normal",
        reviewer_user_ids=[],
    )


@pytest.mark.parametrize("template", ["Leave Permit Form", "Administrative Leave Form"])
def test_generated_leave_waits_for_signing_and_sends_once(gate_env, monkeypatch, template):
    env = gate_env
    book, leave = generate(env, template)
    version = book.versions[-1]
    assert leave.status == "Pending"
    assert form_policy.signing_path_of(version.template_id) == "chain"
    assert version.manager_sig_embedded is False
    assert leave_lifecycle.allowed_transitions(leave.leave_type, leave.status) == frozenset()
    assert not leave_lifecycle.needs_action(
        leave.leave_type, leave.status, "2026-10-21", "2026-10-20"
    )
    notify_dispatch.auto_send_for_book(env.db, book.id)
    env.send.assert_not_called()
    autosend = Mock(wraps=notify_dispatch.auto_send_for_book)
    monkeypatch.setattr(notify_dispatch, "auto_send_for_book", autosend)
    submit(env, book)
    env.send.assert_not_called()
    book_service.sign_book(env.db, book.id, user_id=env.signer.id, version_id=version.id)
    assert book.approval_state == "approved"
    assert leave.status == "Approved"
    autosend.assert_called_once_with(env.db, book.id, sent_by=env.signer.id)
    assert env.send.call_count == 1
    assert env.send.call_args.args[1] == (
        "leave_permit" if template == "Leave Permit Form" else "admin_leave"
    )
    audit = env.db.scalar(
        select(AuditLog).where(
            AuditLog.action == "leave.status_changed", AuditLog.entity_id == str(leave.id)
        )
    )
    assert audit is not None


def test_reject_notifies_leave_status_and_return_does_not(gate_env, monkeypatch):
    env = gate_env
    book, leave = generate(env, "Administrative Leave Form")
    status_send = Mock(wraps=notify_dispatch.auto_send_leave_status)
    monkeypatch.setattr(notify_dispatch, "auto_send_leave_status", status_send)
    submit(env, book)
    book_service.decide_step(
        env.db,
        book.id,
        user_id=env.signer.id,
        version_id=book.versions[-1].id,
        decision="returned",
        note="Correct dates",
    )
    assert leave.status == "Pending"
    env.send.assert_not_called()
    submit(env, book)
    book_service.decide_step(
        env.db,
        book.id,
        user_id=env.signer.id,
        version_id=book.versions[-1].id,
        decision="rejected",
        note="Not granted",
    )
    assert leave.status == "Rejected"
    status_send.assert_called_once_with(env.db, leave.id, sent_by=env.signer.id)
    assert env.send.call_args.args[1] == "leave_rejected"


def test_admin_override_settles_leave_and_notifications_are_best_effort(gate_env, monkeypatch):
    env = gate_env
    book, leave = generate(env)
    send = Mock(side_effect=RuntimeError("gateway unavailable"))
    monkeypatch.setattr(notify_dispatch, "auto_send_for_book", send)
    book_service.override_state(env.db, book.id, target_state="approved", actor=env.signer)
    assert leave.status == "Approved"
    assert book.approval_state == "approved"
    send.assert_called_once()
    book_service.override_state(
        env.db, book.id, target_state="rejected", actor=env.signer, reason="Correction"
    )
    assert leave.status == "Rejected"
    assert env.send.call_args.args[1] == "leave_rejected"
    book_service.override_state(
        env.db, book.id, target_state="returned", actor=env.signer, reason="Revise"
    )
    assert leave.status == "Pending"
    assert env.send.call_count == 1


def test_revision_reuses_leave_even_when_dates_change(gate_env):
    env = gate_env
    book, leave = generate(env, "Administrative Leave Form")
    submit(env, book)
    book_service.decide_step(
        env.db,
        book.id,
        user_id=env.signer.id,
        version_id=book.versions[-1].id,
        decision="rejected",
        note="Correct dates",
    )
    env.send.reset_mock()
    revised, revised_leave = generate(
        env,
        "Administrative Leave Form",
        revise_of_book_id=book.id,
        fields={"start_date": "22/10/2026", "end_date": "23/10/2026"},
    )
    assert revised.id == book.id
    assert revised_leave.id == leave.id
    assert env.db.query(Leave).count() == 1
    assert revised_leave.start_date == date(2026, 10, 22)
    assert revised_leave.status == "Rejected"
    notify_dispatch.auto_send_for_book(env.db, book.id)
    env.send.assert_not_called()
    submit(env, revised)
    assert revised_leave.status == "Pending"


def test_duplicate_generation_preserves_existing_leave_verdict(gate_env):
    env = gate_env
    book, leave = generate(env)
    book_service.override_state(env.db, book.id, target_state="approved", actor=env.signer)
    duplicate, same_leave = generate(env)
    assert same_leave.id == leave.id
    assert same_leave.status == "Approved"
    assert duplicate.approval_state == "none"
    assert env.db.query(Leave).count() == 1


@pytest.mark.parametrize("gateway_raises", [False, True])
def test_signing_survives_disabled_or_failing_notifications(gate_env, monkeypatch, gateway_raises):
    env = gate_env
    book, leave = generate(env)
    if gateway_raises:
        env.send.side_effect = RuntimeError("gateway unavailable")
    else:
        monkeypatch.setattr(notify_dispatch, "_autosend_enabled", lambda _: False)
    submit(env, book)
    book_service.sign_book(env.db, book.id, user_id=env.signer.id, version_id=book.versions[-1].id)
    env.db.refresh(leave)
    assert leave.status == "Approved"
    assert book.approval_state == "approved"
    assert env.send.call_count == int(gateway_raises)


def test_monthly_admin_count_includes_pending_but_excludes_negative_verdicts(gate_env):
    env = gate_env
    today = date.today()
    for day, status in enumerate(("Pending", "Approved", "Rejected", "Cancelled"), start=1):
        env.db.add(
            Leave(
                employee_id=env.employee.id,
                leave_type="Administrative Leave",
                start_date=today.replace(day=day),
                end_date=today.replace(day=day),
                days=1,
                status=status,
            )
        )
    env.db.commit()
    data = document_service._build_template_data(
        env.db,
        template_id="Administrative Leave Form",
        employee=env.employee,
        employee_id=env.employee.id,
        fields={},
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    assert data["admin_leaves_this_month"] == "2"
