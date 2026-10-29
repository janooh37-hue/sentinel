import json
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.db.models import AppSetting, AuditLog, Employee, Leave, User
from app.db.session import get_db
from app.main import create_app
from app.services import notify_dispatch, perm_service, sms_templates


@pytest.fixture()
def template_client(api_db):
    user = User(email="template@test.ae", password_hash="x", role="operator", status="active")
    api_db.add(user)
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app), user


def grant(db, user):
    perm_service.set_user_override(db, user.id, "messages.templates", "grant")


def test_authenticated_reads_and_capability_write_gate(api_db, template_client):
    client, user = template_client
    response = client.get("/api/v1/notify/templates")
    assert response.status_code == 200
    rows = response.json()
    assert [row["event"] for row in rows] == list(sms_templates.EVENTS)
    assert all(row["override"] is None and row["services"] for row in rows)
    for row in rows:
        assert row["default"] == sms_templates.DEFAULTS[row["event"]]
        assert row["variables"] == [
            {
                "name": var.name,
                "label_en": var.label_en,
                "label_ar": var.label_ar,
                "sample": var.sample_en,
            }
            for var in sms_templates.VARIABLES[row["event"]]
        ]
    draft = {"ar": "مرحبا {name}", "en": "Hello {name}"}
    assert client.post("/api/v1/notify/templates/violation/render", json=draft).status_code == 200
    assert (
        client.post("/api/v1/notify/preview", json={"template_id": "Violation Form"}).status_code
        == 200
    )
    assert client.put("/api/v1/notify/templates/violation", json=draft).status_code == 403
    assert client.delete("/api/v1/notify/templates/violation").status_code == 403
    grant(api_db, user)
    assert client.put("/api/v1/notify/templates/violation", json=draft).json()["override"] == draft
    assert client.delete("/api/v1/notify/templates/violation").json()["override"] is None


@pytest.mark.parametrize(
    "draft,code,details",
    [
        ({"ar": " \n", "en": "Hello"}, "EMPTY_TEMPLATE", {}),
        ({"ar": "مرحبا", "en": "\t"}, "EMPTY_TEMPLATE", {}),
        (
            {"ar": "{missing}", "en": "{name.__class__} {0} {{x}} {x!r} { x } {oops} {oops}"},
            "UNKNOWN_PLACEHOLDER",
            {"ar": ["missing"], "en": [" x ", "0", "name.__class__", "oops", "x", "x!r", "{", "}"]},
        ),
        (
            {"ar": "{missing}", "en": "Hello {name}"},
            "UNKNOWN_PLACEHOLDER",
            {"ar": ["missing"], "en": []},
        ),
        (
            {"ar": "مرحبا {name}", "en": "{missing}"},
            "UNKNOWN_PLACEHOLDER",
            {"ar": [], "en": ["missing"]},
        ),
    ],
)
def test_validation_errors_do_not_write(api_db, template_client, draft, code, details):
    client, user = template_client
    grant(api_db, user)
    response = client.put("/api/v1/notify/templates/leave_requested", json=draft)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["details"] == details
    assert (
        api_db.scalar(select(AppSetting).where(AppSetting.key == "msgtpl.leave_requested")) is None
    )
    assert api_db.scalar(select(AuditLog).where(AuditLog.entity_type == "message_template")) is None


def test_override_audit_next_send_render_and_reset(api_db, template_client):
    client, user = template_client
    grant(api_db, user)
    employee = Employee(id="T1", name_en="Test Name", name_ar="اسم تجريبي", msg_language="en")
    leave = Leave(
        employee=employee,
        leave_type="Annual Leave",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 5),
        days=5,
        status="Pending",
    )
    api_db.add(leave)
    api_db.commit()
    default = notify_dispatch._resolve(api_db, "leave_requested", leave.id)[3]
    draft = {"ar": "مرحبا {name}", "en": "Hello {name}"}
    response = client.put("/api/v1/notify/templates/leave_requested", json=draft)
    assert response.status_code == 200
    assert response.json()["override"] == draft
    assert notify_dispatch._resolve(api_db, "leave_requested", leave.id)[3] == "Hello Test Name"
    # No duplicate audit for an unchanged save.
    client.put("/api/v1/notify/templates/leave_requested", json=draft)
    reset = client.delete("/api/v1/notify/templates/leave_requested")
    assert reset.status_code == 200
    assert reset.json()["override"] is None
    assert notify_dispatch._resolve(api_db, "leave_requested", leave.id)[3] == default
    audits = api_db.scalars(
        select(AuditLog).where(AuditLog.entity_type == "message_template").order_by(AuditLog.id)
    ).all()
    assert [row.action for row in audits] == ["message_template.updated", "message_template.reset"]
    assert [json.loads(row.payload) for row in audits] == [
        {"before": None, "after": draft},
        {"before": draft, "after": None},
    ]
    assert all(row.actor == user.email and row.entity_id == "leave_requested" for row in audits)


@pytest.mark.parametrize("language", ["ar", "en"])
def test_message_length_limit(api_db, template_client, language):
    client, user = template_client
    grant(api_db, user)
    draft = {"ar": "مرحبا", "en": "Hello", language: "ن" * 1001}
    response = client.put("/api/v1/notify/templates/leave_requested", json=draft)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert [
        (item["type"], item["loc"], item["ctx"]["max_length"])
        for item in error["details"]["errors"]
    ] == [("string_too_long", ["body", language], 1000)]
    assert api_db.get(AppSetting, "msgtpl.leave_requested") is None
    assert api_db.scalar(select(AuditLog).where(AuditLog.entity_type == "message_template")) is None
    draft[language] = "ن" * 1000
    assert client.put("/api/v1/notify/templates/leave_requested", json=draft).status_code == 200


def test_sample_render_preserves_unknown_tokens(template_client):
    client, _ = template_client
    response = client.post(
        "/api/v1/notify/templates/violation/render",
        json={"ar": "{name} {unknown}", "en": "{name} {name.__class__}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["text"] == {
        "ar": sms_templates.sample_values("violation", "ar")["name"] + " {unknown}",
        "en": sms_templates.sample_values("violation", "en")["name"] + " {name.__class__}",
    }
    assert body["segments"]["ar"] > 0
    assert body["segments"]["en"] > 0


def test_render_expansion_can_exceed_request_length_limit(template_client):
    client, _ = template_client
    template = "x" * 994 + "{name}"
    response = client.post(
        "/api/v1/notify/templates/violation/render",
        json={"ar": template, "en": template},
    )
    assert response.status_code == 200
    for language in ("ar", "en"):
        expected = "x" * 994 + sms_templates.sample_values("violation", language)["name"]
        assert len(expected) > 1000
        assert response.json()["text"][language] == expected


def test_catalog_reads_legacy_oversized_override(api_db, template_client):
    client, _ = template_client
    override = {"ar": "ن" * 1001, "en": "x" * 1001}
    api_db.add(AppSetting(key="msgtpl.violation", value=json.dumps(override)))
    api_db.commit()
    response = client.get("/api/v1/notify/templates")
    assert response.status_code == 200
    template = next(row for row in response.json() if row["event"] == "violation")
    assert template["override"] == override


def test_unknown_event_is_not_found(api_db, template_client):
    client, user = template_client
    grant(api_db, user)
    path = "/api/v1/notify/templates/not-an-event"
    assert client.put(path, json={"ar": "نص", "en": "Text"}).status_code == 404
    assert client.delete(path).status_code == 404
    assert client.post(path + "/render", json={"ar": "نص", "en": "Text"}).status_code == 404


@pytest.mark.parametrize(
    "kind,capability,read_path,write_path,read_allowed",
    [
        (
            "notification_template",
            "messages.templates",
            "/notify/templates",
            "/notify/templates/violation",
            True,
        ),
        (
            "email_template",
            "messages.templates",
            "/email/draft-templates",
            "/email/draft-templates/ledger.new",
            True,
        ),
        (
            "word_template",
            "books.templates",
            "/books/word-templates",
            "/books/word-templates/missing",
            False,
        ),
        (
            "editor_template",
            "editor_templates.manage",
            "/editor-templates",
            "/editor-templates/1",
            False,
        ),
    ],
)
def test_template_family_decisions_match_denied_consumer_routes(
    api_db, template_client, kind, capability, read_path, write_path, read_allowed
):
    from app.services.action_guard_service import template_decision

    client, user = template_client
    perm_service.set_user_override(api_db, user.id, capability, "deny")
    if kind == "word_template":
        perm_service.set_user_override(api_db, user.id, "books.edit", "deny")
    caps = perm_service.effective_caps(api_db, user)
    read = template_decision(caps, kind, "view")
    assert read.allowed is read_allowed
    assert client.get("/api/v1" + read_path).status_code == (200 if read_allowed else 403)
    edit = template_decision(caps, kind, "reset" if read_allowed else "delete")
    assert edit.allowed is False
    assert client.delete("/api/v1" + write_path).status_code == 403
    if kind == "notification_template":
        assert (
            client.post(
                "/api/v1/notify/templates/violation/render",
                json={"ar": "مرحبا {name}", "en": "Hello {name}"},
            ).status_code
            == 200
        )
