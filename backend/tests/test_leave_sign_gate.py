"""Generated leave records are settled by their record's signing chain, not Leaves PATCH."""

import hashlib
import io
import zipfile
from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import docx
import pytest
from PIL import Image
from sqlalchemy import select

from app.config import Settings
from app.core import docx_engine, form_policy, leave_lifecycle
from app.db.models import (
    AuditLog,
    Book,
    BookCategory,
    BookEditSession,
    Document,
    Employee,
    Leave,
    Manager,
    OutboundMessage,
    User,
)
from app.services import (
    absence_service,
    artifact_service,
    book_service,
    document_service,
    included_papers_service,
    leave_service,
    notify_dispatch,
    sms_templates,
    word_book_service,
)


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
        manager_id=kwargs.pop("manager_id", env.manager.id),
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


def test_reject_and_return_send_nothing(gate_env):
    env = gate_env
    book, leave = generate(env, "Administrative Leave Form")
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
    env.send.assert_not_called()


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
    book_service.override_state(
        env.db, book.id, target_state="returned", actor=env.signer, reason="Revise"
    )
    assert leave.status == "Pending"
    env.send.assert_not_called()


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


def decide(env, book, decision):
    book_service.decide_step(
        env.db,
        book.id,
        user_id=env.signer.id,
        version_id=book.versions[-1].id,
        decision=decision,
        note=decision,
    )


def _issued_on(excinfo):
    assert excinfo.value.code == "LEAVE_ALREADY_ISSUED"
    return excinfo.value.details["ref_number"]


@pytest.mark.parametrize("template", ["Leave Permit Form", "Administrative Leave Form"])
def test_legacy_record_keeps_its_issued_leave(gate_env, monkeypatch, template):
    """A record issued before the sign gate (no snapshot, leave Approved, employee
    told) keeps main's behaviour when it is later sent for signature."""
    env = gate_env
    book, leave = generate(env, template)
    for version in book.versions:
        version.fields = {k: v for k, v in version.fields.items() if k != "_signing"}
    leave.status = "Approved"
    env.db.commit()
    reevaluate = Mock()
    monkeypatch.setattr(leave_service, "_enqueue_leave_reevaluation", reevaluate)
    submit(env, book)
    decide(env, book, "rejected")
    env.db.refresh(leave)
    assert book.approval_state == "rejected"
    assert leave.status == "Approved"
    assert reevaluate.call_count == 0
    assert env.send.call_count == 0
    assert env.db.query(OutboundMessage).count() == 0


def test_duplicate_is_refused_while_the_owner_is_live(gate_env):
    env = gate_env
    book, leave = generate(env)
    for state in ("none", "pending", "approved"):
        if state == "pending":
            submit(env, book)
        elif state == "approved":
            book_service.sign_book(
                env.db, book.id, user_id=env.signer.id, version_id=book.versions[-1].id
            )
        with pytest.raises(document_service.ValidationFailedError) as excinfo:
            generate(env)
        assert _issued_on(excinfo) == book.ref_number
        env.db.rollback()
    env.db.refresh(leave)
    assert leave.status == "Approved"
    assert env.db.query(Book).count() == 1


@pytest.mark.parametrize("template", ["Leave Permit Form", "Administrative Leave Form"])
def test_a_reissue_takes_over_a_rejected_leave(gate_env, template):
    env = gate_env
    rejected, leave = generate(env, template)
    submit(env, rejected)
    decide(env, rejected, "rejected")
    assert leave.status == "Rejected"
    reissue, same_leave = generate(env, template)
    assert same_leave.id == leave.id
    assert leave.status == "Pending"
    # The rejected original no longer decides the leave.
    book_service.override_state(env.db, rejected.id, target_state="approved", actor=env.signer)
    env.db.refresh(leave)
    assert leave.status == "Pending"
    submit(env, reissue)
    book_service.sign_book(
        env.db, reissue.id, user_id=env.signer.id, version_id=reissue.versions[-1].id
    )
    env.db.refresh(leave)
    assert leave.status == "Approved"
    assert env.send.call_count == 1
    book_service.override_state(
        env.db, rejected.id, target_state=book_service.VOIDED_STATE, actor=env.signer
    )
    env.db.refresh(leave)
    assert leave.status == "Approved"
    assert env.db.query(Leave).count() == 1


@pytest.mark.parametrize("template", ["Leave Permit Form", "Administrative Leave Form"])
def test_a_revision_cannot_move_onto_a_live_records_leave(gate_env, template):
    env = gate_env
    first, first_leave = generate(env, template)
    submit(env, first)
    decide(env, first, "rejected")
    moved = {"date": "22/10/2026", "start_date": "22/10/2026", "end_date": "23/10/2026"}
    second, second_leave = generate(env, template, fields=moved)
    with pytest.raises(document_service.ValidationFailedError) as excinfo:
        generate(env, template, revise_of_book_id=first.id, fields=moved)
    assert _issued_on(excinfo) == second.ref_number
    env.db.rollback()
    env.db.refresh(first_leave)
    env.db.refresh(second_leave)
    assert (first_leave.start_date, first_leave.status) == (date(2026, 10, 20), "Rejected")
    assert (second_leave.start_date, second_leave.status) == (date(2026, 10, 22), "Pending")


@pytest.mark.parametrize("template", ["Leave Permit Form", "Administrative Leave Form"])
def test_a_revision_onto_a_rejected_records_leave_takes_it_over(gate_env, template):
    env = gate_env
    first, first_leave = generate(env, template)
    submit(env, first)
    decide(env, first, "rejected")
    moved = {"date": "22/10/2026", "start_date": "22/10/2026", "end_date": "23/10/2026"}
    second, second_leave = generate(env, template, fields=moved)
    submit(env, second)
    decide(env, second, "rejected")
    revised, revised_leave = generate(env, template, revise_of_book_id=second.id, fields={})
    assert revised_leave.id == first_leave.id
    env.db.refresh(second_leave)
    assert first_leave.status == "Pending"
    assert second_leave.status == "Cancelled"
    submit(env, revised)
    book_service.sign_book(
        env.db, revised.id, user_id=env.signer.id, version_id=revised.versions[-1].id
    )
    env.db.refresh(first_leave)
    assert first_leave.status == "Approved"
    assert env.send.call_count == 1


def test_a_non_owner_revision_leaves_the_owners_leave_alone(gate_env):
    env = gate_env
    original, leave = generate(env)
    submit(env, original)
    decide(env, original, "rejected")
    reissue, _leave = generate(env)
    submit(env, reissue)
    book_service.sign_book(
        env.db, reissue.id, user_id=env.signer.id, version_id=reissue.versions[-1].id
    )
    with pytest.raises(document_service.ValidationFailedError) as excinfo:
        generate(env, revise_of_book_id=original.id, fields={})
    assert _issued_on(excinfo) == reissue.ref_number
    env.db.rollback()
    revised, new_leave = generate(env, revise_of_book_id=original.id, fields={"date": "22/10/2026"})
    env.db.refresh(leave)
    assert new_leave.id != leave.id
    assert (leave.start_date, leave.status) == (date(2026, 10, 20), "Approved")
    assert revised.id == original.id


@pytest.mark.parametrize("template", ["Leave Permit Form", "Administrative Leave Form"])
def test_a_revision_keeps_the_notify_opt_out(gate_env, template):
    env = gate_env
    book, leave = generate(env, template, notify_employee=False)
    submit(env, book)
    decide(env, book, "returned")
    # The revise screen hides the switch and sends its default (on).
    revised, _leave = generate(env, template, revise_of_book_id=book.id, notify_employee=True)
    assert revised.versions[-1].fields["_signing"]["notify_employee"] is False
    submit(env, revised)
    book_service.sign_book(
        env.db, book.id, user_id=env.signer.id, version_id=revised.versions[-1].id
    )
    env.db.refresh(leave)
    assert leave.status == "Approved"
    env.send.assert_not_called()


def _word_revision(env, book):
    """Reopen the latest paper in Word and finish it unchanged."""
    word_book_service.reopen_word_session(env.db, user=env.signer, book_id=book.id)
    session = env.db.query(BookEditSession).filter_by(book_id=book.id, state="active").one()
    session.last_put_at = datetime.now(UTC).replace(tzinfo=None)
    env.db.commit()
    word_book_service.finish_word_session(
        env.db, user=env.signer, book_id=book.id, converter=lambda _: None
    )
    env.db.refresh(book)
    return book.versions[-1]


@pytest.mark.parametrize("notify", [True, False])
def test_word_revision_keeps_the_leave_and_the_notify_choice(gate_env, monkeypatch, notify):
    env = gate_env
    monkeypatch.setattr(word_book_service, "get_settings", document_service.get_settings)
    book, leave = generate(env, notify_employee=notify)
    word_version = _word_revision(env, book)
    assert word_version.fields == {}
    submit(env, book)
    book_service.sign_book(env.db, book.id, user_id=env.signer.id, version_id=word_version.id)
    env.db.refresh(leave)
    assert book.approval_state == "approved"
    assert leave.status == "Approved"
    assert env.send.call_count == int(notify)
    # The approval message still states the generated permit's duration.
    event = notify_dispatch._load_book_event(env.db, book.id)
    assert "3 hour(s)" in sms_templates.render_text("leave_permit", "en", event, env.employee)
    assert "ولمدة 3 ساعة" in sms_templates.render_text("leave_permit", "ar", event, env.employee)


def test_structured_revision_after_word_revision_keeps_the_leave(gate_env, monkeypatch):
    env = gate_env
    monkeypatch.setattr(word_book_service, "get_settings", document_service.get_settings)
    book, leave = generate(env)
    _word_revision(env, book)
    _revised, revised_leave = generate(
        env, revise_of_book_id=book.id, fields={"date": "22/10/2026"}
    )
    assert revised_leave.id == leave.id
    assert env.db.query(Leave).count() == 1


def test_revision_does_not_reuse_a_deleted_leave(gate_env):
    env = gate_env
    book, leave = generate(env)
    leave_service.soft_delete_leave(env.db, leave.id)
    revised, revised_leave = generate(env, revise_of_book_id=book.id, fields={"date": "22/10/2026"})
    assert revised_leave.id != leave.id
    assert revised_leave.deleted_at is None
    submit(env, revised)
    book_service.sign_book(
        env.db, book.id, user_id=env.signer.id, version_id=revised.versions[-1].id
    )
    env.db.refresh(revised_leave)
    assert revised_leave.status == "Approved"
    assert env.send.call_count == 1


def test_regranting_approval_does_not_resend(gate_env):
    env = gate_env

    def logged_send(db, event_type, record_id, *, sent_by):
        db.add(
            OutboundMessage(
                employee_id=env.employee.id,
                event_type=event_type,
                event_ref=f"{event_type}:{record_id}",
                language="en",
                phone="+971500000000",
                status="sent",
            )
        )
        db.commit()

    env.send.side_effect = logged_send
    book, leave = generate(env)
    for state in ("approved", "none", "approved"):
        book_service.override_state(env.db, book.id, target_state=state, actor=env.signer)
    env.db.refresh(leave)
    assert leave.status == "Approved"
    assert env.send.call_count == 1


def test_pending_gated_leave_does_not_block_absences(gate_env):
    env = gate_env
    book, _leave = generate(env, "Administrative Leave Form")
    start = date(2026, 10, 20)
    pending = absence_service.add_range(env.db, env.employee.id, start=start, end=start)
    assert [row.date for row in pending.created] == [start]
    book_service.override_state(env.db, book.id, target_state="approved", actor=env.signer)
    next_day = date(2026, 10, 21)
    approved = absence_service.add_range(env.db, env.employee.id, start=next_day, end=next_day)
    assert approved.created == []
    assert approved.skipped_on_leave == [next_day]


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


def _media(path):
    with zipfile.ZipFile(path) as docx:
        return {
            hashlib.sha256(docx.read(name)).hexdigest()
            for name in docx.namelist()
            if name.startswith("word/media/")
        }


def _document_xml(path):
    with zipfile.ZipFile(path) as docx:
        return docx.read("word/document.xml").decode("utf-8")


def _data_path(env, rel):
    return document_service.get_settings().data_dir / rel


def test_signed_copy_keeps_employee_signature_and_issue_date(gate_env, monkeypatch):
    env = gate_env
    employee = Employee(id="G4401", name_en="Signing Employee", status="Active")
    env.db.add(employee)
    env.db.commit()
    employee_sig = document_service.signature_core.employee_signature_path(
        document_service.get_settings().vault_dir, employee.id
    )
    employee_sig.parent.mkdir(parents=True)
    Image.new("RGBA", (120, 50), (255, 0, 0, 255)).save(employee_sig)
    result = document_service.generate_document(
        env.db,
        employee_id=employee.id,
        template_id="Leave Application Form",
        fields={"start_date": "20/10/2026", "end_date": "21/10/2026"},
        manager_id=env.manager.id,
        embed_signature={"employee": True},
        current_user=env.signer,
        converter=lambda _: None,
    )
    book = env.db.get_one(Book, result.book_id)
    version = book.versions[-1]
    issued = datetime.now().strftime("%d/%m/%Y")
    generated = _data_path(env, env.db.get_one(Document, version.document_id).docx_path)
    submit(env, book)

    class Later(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2030, 1, 1, 9, 0, tzinfo=tz)

    monkeypatch.setattr(document_service, "datetime", Later)
    monkeypatch.setattr(docx_engine, "datetime", Later)
    book_service.sign_book(env.db, book.id, user_id=env.signer.id, version_id=version.id)

    signed = _data_path(env, version.signed_pdf_path)
    assert _media(generated) < _media(signed)  # employee kept, manager added
    assert issued in _document_xml(signed)  # request_date stays the issue date
    manager_row = next(
        [cell.text.strip() for cell in row.cells]
        for table in docx.Document(str(signed)).tables
        for row in table.rows
        if row.cells[0].text.strip() == "Line Manager"
    )
    assert manager_row[-1] == "01/01/2030"  # the manager dates the signature


def test_signed_admin_leave_dates_the_manager_approval(gate_env, monkeypatch):
    env = gate_env
    book, _leave = generate(env, "Administrative Leave Form")
    submit(env, book)

    class Later(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2030, 1, 1, 9, 0, tzinfo=tz)

    monkeypatch.setattr(document_service, "datetime", Later)
    monkeypatch.setattr(docx_engine, "datetime", Later)
    version = book.versions[-1]
    book_service.sign_book(env.db, book.id, user_id=env.signer.id, version_id=version.id)
    signed = _document_xml(_data_path(env, version.signed_pdf_path))
    assert "01/01/2030" in signed  # manager approval date ({{ today }})


def test_scan_flip_settles_leave_and_unfile_reopens_it(gate_env, monkeypatch):
    env = gate_env
    monkeypatch.setattr(included_papers_service, "get_settings", document_service.get_settings)
    book, leave = generate(env)
    scan = io.BytesIO()
    Image.new("RGB", (200, 280), "white").save(scan, format="PNG")
    book_service.add_attachment(
        env.db, book.id, "scan.png", scan.getvalue(), user=env.signer, as_signed=True
    )
    env.db.refresh(leave)
    assert book.approval_state == "approved"
    assert leave.status == "Approved"
    assert env.send.call_count == 1
    book_service.unfile_signed_copy(env.db, book.id, user=env.signer)
    env.db.refresh(leave)
    assert leave.status == "Pending"
    assert env.send.call_count == 1


@pytest.mark.parametrize("how", ["delete", "void"])
def test_deleting_or_voiding_cancels_the_leave_silently(gate_env, how):
    env = gate_env
    book, leave = generate(env)
    if how == "delete":
        book_service.delete_book(env.db, book.id, user_id=env.signer.id)
    else:
        book_service.override_state(
            env.db, book.id, target_state=book_service.VOIDED_STATE, actor=env.signer
        )
    env.db.refresh(leave)
    assert leave.status == "Cancelled"
    env.send.assert_not_called()
    audit = env.db.scalar(
        select(AuditLog).where(
            AuditLog.action == "leave.status_changed", AuditLog.entity_id == str(leave.id)
        )
    )
    assert audit is not None


def test_operator_notify_opt_out_holds_on_approval(gate_env):
    env = gate_env
    book, leave = generate(env, notify_employee=False)
    submit(env, book)
    book_service.sign_book(env.db, book.id, user_id=env.signer.id, version_id=book.versions[-1].id)
    env.db.refresh(leave)
    assert leave.status == "Approved"
    env.send.assert_not_called()


def test_permit_without_doc_manager_carries_the_signer_name(gate_env):
    env = gate_env
    book, _leave = generate(env, manager_id=None)
    assert book.doc_manager_id is None
    book_service.submit_for_approval(
        env.db,
        book.id,
        submitted_by_user_id=env.signer.id,
        approver_user_id=env.signer.id,
        priority="normal",
        reviewer_user_ids=[],
    )
    version = book.versions[-1]
    book_service.sign_book(env.db, book.id, user_id=env.signer.id, version_id=version.id)
    signed = _document_xml(_data_path(env, version.signed_pdf_path))
    assert env.manager.name_en in signed
    assert "w:drawing" in signed
