from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.db.models import Book, Document, Employee, Leave, OutboundMessage, User, Violation
from app.db.session import get_db
from app.main import create_app
from app.services import message_template_service, sms_templates


@pytest.fixture()
def preview_client(api_db, monkeypatch):
    user = User(email="preview@test.ae", password_hash="x", role="operator", status="active")
    api_db.add_all(
        [user, Employee(id="P1", name_en="Preview Name", name_ar="اسم المعاينة", msg_language="en")]
    )
    api_db.commit()
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
        ("HR Request Form", 7, "on_approval"),
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
