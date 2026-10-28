from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.config import Settings
from app.db.models import (
    Book,
    BookCategory,
    Document,
    Employee,
    Leave,
    Manager,
    OutboundMessage,
    User,
    Violation,
)
from app.db.session import get_db
from app.main import create_app
from app.services import (
    artifact_service,
    book_service,
    document_service,
    message_template_service,
    notify_dispatch,
    perm_service,
    sms_client,
    sms_templates,
)


@pytest.fixture()
def preview_client(api_db, monkeypatch):
    user = User(email="preview@test.ae", password_hash="x", role="operator", status="active")
    api_db.add_all(
        [user, Employee(id="P1", name_en="Preview Name", name_ar="اسم المعاينة", msg_language="en")]
    )
    api_db.add_all([BookCategory(id=category, prefix=category) for category in ("HR", "GS", "NAT")])
    api_db.commit()
    # Revision previews use the same explicit edit authority as revision saves.
    perm_service.set_user_override(api_db, user.id, "books.edit", "grant")
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 21, 10, 30)

    monkeypatch.setattr(message_template_service, "datetime", Clock)
    return TestClient(app)


@pytest.mark.parametrize(
    "template,fields,event,timing,fragment",
    [
        (
            "HR Request Form",
            {"doc_selections": ["Salary Certificate"]},
            "hr_request",
            "on_approval",
            "Preview Name",
        ),
        (
            "Leave Application Form",
            {
                "leave_type": "Annual Leave",
                "start_date": "01/11/2026",
                "end_date": "05/11/2026",
                "total_days": "5",
            },
            "leave_requested",
            "on_approval",
            "has been received",
        ),
        (
            "Leave Application Form",
            {
                "leave_type": "Sick Leave",
                "start_date": "01/11/2026",
                "end_date": "05/11/2026",
                "total_days": "5",
            },
            "sick_leave_registered",
            "on_approval",
            "has been registered",
        ),
        (
            "Leave Application Form",
            {
                "leave_type": "Emergency Leave",
                "start_date": "01/11/2026",
                "end_date": "05/11/2026",
                "total_days": "5",
            },
            "leave_approved",
            "on_approval",
            "has been approved",
        ),
        (
            "Administrative Leave Form",
            {"start_date": "01/11/2026", "end_date": "05/11/2026", "duration": "5"},
            "admin_leave",
            "on_approval",
            "administrative leave",
        ),
        (
            "Duty Resumption Form",
            {"resumption_date": "05/11/2026"},
            "duty_resumption",
            "on_approval",
            "05/11/2026",
        ),
        (
            "Violation Form",
            {"date": "01/11/2026", "explanation": "Unsaved explanation"},
            "violation",
            "on_save",
            "Unsaved explanation",
        ),
        ("Leave Permit Form", {"duration_hours": "3"}, "leave_permit", "on_approval", "3 hour(s)"),
        ("Salary Deduction Form", {"amount": "123"}, "salary_deduction", "on_save", "123"),
        (
            "Warning Form",
            {"violation_type": ["Late arrival", "Absence"]},
            "warning",
            "on_save",
            "Violation: Late arrival, Absence.",
        ),
    ],
)
def test_unsaved_form_preview_never_persists(
    api_db, preview_client, template, fields, event, timing, fragment
):
    models = (Book, Document, Leave, Violation, OutboundMessage)
    before = [api_db.scalar(select(func.count()).select_from(model)) for model in models]
    response = preview_client.post(
        "/api/v1/notify/preview",
        json={"template_id": template, "employee_id": "P1", "fields": fields},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["event"] == event
    assert body["language"] == "en"
    assert body["timing"] == timing
    assert fragment in body["text"]["en"]
    assert "اسم المعاينة" in body["text"]["ar"]
    assert body["segments"] == {
        lang: message_template_service.segment_count(text) for lang, text in body["text"].items()
    }
    assert not api_db.new
    api_db.flush()
    assert [api_db.scalar(select(func.count()).select_from(model)) for model in models] == before


def test_preview_uses_current_override(api_db, preview_client):
    from app.schemas.notify import MessageText

    message_template_service.save_template(
        api_db, "violation", MessageText(ar="مرحبا {name}", en="Unsaved {name}"), actor="test"
    )
    response = preview_client.post(
        "/api/v1/notify/preview", json={"template_id": "Violation Form", "employee_id": "P1"}
    )
    assert response.json()["text"] == {"ar": "مرحبا اسم المعاينة", "en": "Unsaved Preview Name"}


@pytest.mark.parametrize(
    "template,revision,timing",
    [
        ("General Book", None, "on_approval"),
        ("Violation Form", 7, "on_save"),
    ],
)
def test_non_notifying_or_revision_has_no_message(preview_client, template, revision, timing):
    response = preview_client.post(
        "/api/v1/notify/preview", json={"template_id": template, "revise_of_book_id": revision}
    )
    assert response.json() == {
        "event": None,
        "language": "ar",
        "timing": timing,
        "text": None,
        "segments": None,
    }


@pytest.fixture()
def revision_env(api_db, preview_client, monkeypatch, tmp_path):
    settings = Settings(
        data_dir=tmp_path / "data",
        templates_dir=document_service._TEMPLATES_DIR,
        openwa_enabled=False,
        sms_enabled=True,
    )
    for module in (document_service, artifact_service, book_service, notify_dispatch):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    monkeypatch.setattr(notify_dispatch, "_autosend_enabled", lambda _: True)
    monkeypatch.setattr(
        sms_client, "send", lambda phone, text: sms_client.SendResult(ok=True, message_id="m1")
    )
    clock = message_template_service.datetime
    for module in (document_service, book_service, notify_dispatch):
        monkeypatch.setattr(module, "datetime", clock)

    class Today(date):
        @classmethod
        def today(cls):
            return cls(2026, 10, 21)

    monkeypatch.setattr(notify_dispatch, "date", Today)
    employee = api_db.get(Employee, "P1")
    employee.contact = "0501234567"
    signer = User(email="signer@preview.test", password_hash="x", role="admin", status="active")
    api_db.add(signer)
    api_db.flush()
    manager = Manager(name_en="Preview Manager", user_id=signer.id)
    api_db.add(manager)
    api_db.commit()
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
    return employee, signer, manager


@pytest.mark.parametrize("language,decision", [("ar", "returned"), ("en", "rejected")])
@pytest.mark.parametrize("notify_employee", [True, False, None])
def test_revision_preview_matches_approval_send(
    api_db, preview_client, revision_env, language, decision, notify_employee
):
    employee, signer, manager = revision_env
    employee.msg_language = language
    template = "Employee Clearance Form"
    fields = {"date": "21/10/2026"}
    result = document_service.generate_document(
        api_db,
        employee_id=employee.id,
        template_id=template,
        fields=fields,
        manager_id=manager.id,
        current_user=signer,
        converter=lambda _: None,
        notify_employee=notify_employee is not False,
    )
    book = api_db.get_one(Book, result.book_id)
    if notify_employee is None:
        # Older snapshots without the flag inherit the default-on choice.
        snapshot = dict(book.versions[-1].fields["_signing"])
        snapshot.pop("notify_employee")
        book.versions[-1].fields = {**book.versions[-1].fields, "_signing": snapshot}
        api_db.commit()
    book_service.submit_for_approval(
        api_db,
        book.id,
        submitted_by_user_id=signer.id,
        approver_user_id=signer.id,
        urgency="Normal",
        reviewer_user_ids=[],
    )
    book_service.decide_step(
        api_db,
        book.id,
        user_id=signer.id,
        version_id=book.versions[-1].id,
        decision=decision,
        note="Revise this paper",
    )
    assert book.approval_state == decision
    assert api_db.scalar(select(func.count()).select_from(OutboundMessage)) == 0
    response = preview_client.post(
        "/api/v1/notify/preview",
        json={
            "template_id": template,
            "employee_id": employee.id,
            "fields": fields,
            "revise_of_book_id": book.id,
        },
    )
    assert response.status_code == 200
    preview = response.json()
    document_service.generate_document(
        api_db,
        employee_id=employee.id,
        template_id=template,
        fields=fields,
        manager_id=manager.id,
        current_user=signer,
        converter=lambda _: None,
        revise_of_book_id=book.id,
        notify_employee=notify_employee is False,  # revision must ignore this request choice
    )
    book_service.submit_for_approval(
        api_db,
        book.id,
        submitted_by_user_id=signer.id,
        approver_user_id=signer.id,
        urgency="Normal",
        reviewer_user_ids=[],
    )
    book_service.sign_book(api_db, book.id, user_id=signer.id, version_id=book.versions[-1].id)
    assert book.approval_state == "approved"
    sent = api_db.scalar(select(OutboundMessage))
    if notify_employee is False:
        assert sent is None
        assert preview["event"] is None and preview["text"] is None
    else:
        assert sent is not None and sent.status == "sent"
        assert preview["event"] == sent.event_type
        assert preview["language"] == language
        assert preview["timing"] == "on_approval"
        assert preview["text"][language] == sent.body


@pytest.mark.parametrize(
    "template,fields",
    [
        ("Employee Clearance Form", {"date": "21/10/2026"}),
        (
            "Administrative Leave Form",
            {"start_date": "01/11/2026", "end_date": "05/11/2026", "duration": "5"},
        ),
        (
            "Leave Application Form",
            {
                "leave_type": "Annual Leave",
                "start_date": "01/11/2026",
                "end_date": "05/11/2026",
                "total_days": "5",
            },
        ),
    ],
)
@pytest.mark.parametrize("original_status", ["sent", "failed", "settled_leave"])
def test_approved_revision_preview_matches_deduplicated_send(
    api_db, preview_client, revision_env, template, fields, original_status
):
    if original_status == "settled_leave" and template != "Leave Application Form":
        pytest.skip("Only Annual Leave has a later Leaves-page verdict")
    employee, signer, manager = revision_env

    def generate(**kwargs):
        result = document_service.generate_document(
            api_db,
            employee_id=employee.id,
            template_id=template,
            fields=fields,
            manager_id=manager.id,
            current_user=signer,
            converter=lambda _: None,
            **kwargs,
        )
        return api_db.get_one(Book, result.book_id)

    def approve(book):
        book_service.submit_for_approval(
            api_db,
            book.id,
            submitted_by_user_id=signer.id,
            approver_user_id=signer.id,
            urgency="Normal",
            reviewer_user_ids=[],
        )
        book_service.sign_book(api_db, book.id, user_id=signer.id, version_id=book.versions[-1].id)
        assert book.approval_state == "approved"

    book = generate()
    approve(book)
    original = api_db.scalar(select(OutboundMessage))
    assert original is not None and original.status == "sent"
    original.status = "failed" if original_status != "sent" else "sent"
    if original_status == "settled_leave":
        document = api_db.get_one(Document, book.versions[-1].document_id)
        api_db.get_one(Leave, document.leave_id).status = "Approved"
    api_db.commit()
    book_service.override_state(
        api_db, book.id, target_state="returned", actor=signer, reason="Correct paper"
    )
    response = preview_client.post(
        "/api/v1/notify/preview",
        json={
            "template_id": template,
            "employee_id": employee.id,
            "fields": fields,
            "revise_of_book_id": book.id,
        },
    )
    assert response.status_code == 200
    preview = response.json()
    assert not api_db.new
    approve(generate(revise_of_book_id=book.id))
    messages = list(api_db.scalars(select(OutboundMessage).order_by(OutboundMessage.id)))
    if original_status != "failed":
        assert len(messages) == 1
        assert preview["text"] is None
        assert preview["segments"] is None
    else:
        assert len(messages) == 2
        assert messages[-1].status == "sent"
        assert messages[-1].event_ref == original.event_ref
        assert preview["text"][employee.msg_language] == messages[-1].body


def test_missing_employee_uses_sample_and_arabic(preview_client):
    response = preview_client.post("/api/v1/notify/preview", json={"template_id": "Violation Form"})
    assert response.status_code == 200
    assert response.json()["language"] == "ar"
    assert "Ahmed Ali" in response.json()["text"]["en"]
    assert "أحمد علي" in response.json()["text"]["ar"]
    assert (
        preview_client.post(
            "/api/v1/notify/preview",
            json={"template_id": "Violation Form", "employee_id": "missing"},
        ).status_code
        == 404
    )


@pytest.mark.parametrize(
    "language,expected", [(None, "ar"), ("ar", "ar"), ("en", "en"), ("xx", "en")]
)
def test_preview_employee_language_rule(api_db, preview_client, language, expected):
    api_db.get(Employee, "P1").msg_language = language
    response = preview_client.post(
        "/api/v1/notify/preview", json={"template_id": "General Book", "employee_id": "P1"}
    )
    assert response.json()["language"] == expected


@pytest.mark.parametrize(
    "template,denied",
    [
        ("HR Request Form", "documents.generate"),
        ("HR Request Form", "books.view"),
        ("HR Request Form", "books.service.HR Request Form"),
        ("Violation Form", "books.service.Violation Form"),
        ("Leave Application Form", "books.service.Leave Application Form"),
        ("HR Request Form", "books.category.HR"),
    ],
)
def test_real_employee_preview_requires_save_screen_access(
    api_db, preview_client, template, denied
):
    user = api_db.scalar(select(User).where(User.email == "preview@test.ae"))
    payload = {"template_id": template, "employee_id": "P1"}
    assert preview_client.post("/api/v1/notify/preview", json=payload).status_code == 200
    perm_service.set_user_override(api_db, user.id, denied, "deny")
    assert preview_client.post("/api/v1/notify/preview", json=payload).status_code == 403
    # Authorization precedes the employee lookup, including nonexistent ids.
    assert (
        preview_client.post(
            "/api/v1/notify/preview", json={**payload, "employee_id": "missing"}
        ).status_code
        == 403
    )
    assert (
        preview_client.post(
            "/api/v1/notify/preview", json={**payload, "employee_id": None}
        ).status_code
        == 200
    )
    perm_service.set_user_override(api_db, user.id, denied, None)
    assert preview_client.post("/api/v1/notify/preview", json=payload).status_code == 200


@pytest.mark.parametrize(
    "denied",
    [
        "books.edit",
        "books.view",
        "books.category.HR",
        "books.servicerecords.Employee Clearance Form",
    ],
)
@pytest.mark.parametrize("template", ["HR Request Form", "Violation Form"])
def test_sample_revision_preview_requires_source_record_access(
    api_db, preview_client, denied, template
):
    from app.db.models import BookVersion

    user = api_db.scalar(select(User).where(User.email == "preview@test.ae"))
    book = Book(category_id="HR", ref_number="HR-8100", employee_id="P1")
    book.versions.append(
        BookVersion(
            version_no=1,
            template_id="Employee Clearance Form",
            fields={"_signing": {"notify_employee": True}},
        )
    )
    api_db.add(book)
    api_db.commit()
    # The source record, not the supplied preview template, determines access.
    payload = {"template_id": template, "revise_of_book_id": book.id}
    response = preview_client.post("/api/v1/notify/preview", json=payload)
    assert response.status_code == 200
    if template == "HR Request Form":
        assert response.json()["event"] == "hr_request"
        assert response.json()["text"]["ar"] and response.json()["text"]["en"]
    previous = perm_service.get_user_overrides(api_db, user.id).get(denied)
    perm_service.set_user_override(api_db, user.id, denied, "deny")
    assert preview_client.post("/api/v1/notify/preview", json=payload).status_code == 403
    # Only revision-less sample previews retain the authenticated-only bypass.
    assert (
        preview_client.post("/api/v1/notify/preview", json={"template_id": template}).status_code
        == 200
    )
    perm_service.set_user_override(api_db, user.id, denied, previous)
    assert preview_client.post("/api/v1/notify/preview", json=payload).status_code == 200


@pytest.mark.parametrize(
    "text,parts",
    [
        ("", 0),
        ("ع" * 70, 1),
        ("ع" * 71, 2),
        ("ع" * 134, 2),
        ("ع" * 135, 3),
        ("a" * 160, 1),
        ("a" * 161, 2),
        ("^" * 80, 1),
        ("^" * 81, 2),
        ("a" * 159 + "€", 2),
        ("😀" * 35, 1),
        ("😀" * 36, 2),
    ],
)
def test_sms_segment_boundaries(text, parts):
    assert message_template_service.segment_count(text) == parts


def test_catalog_event_metadata_is_complete():
    assert set(message_template_service._LABELS) == set(sms_templates.EVENTS)
    for event in sms_templates.EVENTS:
        metadata = message_template_service.catalog_metadata(event)
        assert metadata["label"]["ar"] and metadata["label"]["en"]
        assert metadata["services"]


@pytest.mark.parametrize("template", ["Violation Form", "Duty Resumption Form"])
def test_special_route_book_without_linked_record_sends_nothing(db_session, template):
    """A book id is never a Leave/Violation id: no linked record means no event."""
    from app.db.models import BookCategory, BookVersion
    from app.services import notify_dispatch

    db_session.add(Employee(id="BE1", name_en="Book Event", name_ar="حدث"))
    if db_session.get(BookCategory, "HR") is None:
        db_session.add(BookCategory(id="HR", prefix="HR"))
    db_session.flush()
    book = Book(category_id="HR", ref_number="HR-9001", employee_id="BE1")
    db_session.add(book)
    db_session.flush()
    db_session.add(BookVersion(book_id=book.id, version_no=1, template_id=template, fields={}))
    db_session.commit()

    assert notify_dispatch.book_event(db_session, book) is None
