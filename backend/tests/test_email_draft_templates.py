from __future__ import annotations

import json
from collections.abc import Iterator
from time import perf_counter
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import ValidationFailedError
from app.core.classifications import CLASSIFICATIONS
from app.core.constants import TEMPLATE_FILES
from app.db.models import AppSetting, AuditLog, User, UserPermission
from app.db.session import get_db
from app.main import create_app
from app.schemas.email_draft_template import EmailDraftTemplateParts
from app.services import email_draft_template_service, perm_service

URL = "/api/v1/email/draft-templates"
SETTING_KEY = "email.draft_templates"
EXPECTED_TOKENS = {
    "form": ["ref", "date", "names", "count", "detail"],
    "classification": ["ref", "date", "names", "count", "detail"],
    "leave": ["ref", "date", "names", "count", "start_date", "end_date"],
    "salary_transfer": ["ref", "date", "names", "count", "bank"],
    "transfer": ["ref", "date", "names", "count"],
    "absence": ["names", "count", "start_date", "end_date", "return_date"],
}


def _url(key: str) -> str:
    return f"{URL}/{quote(key, safe='')}"


@pytest.fixture()
def draft_user(api_db: Session) -> User:
    user = User(
        email="template-editor@test.ae", password_hash="x", role="operator", status="active"
    )
    api_db.add(user)
    api_db.flush()
    api_db.add(UserPermission(user_id=user.id, capability="messages.templates", effect="grant"))
    api_db.commit()
    return user


@pytest.fixture()
def client(api_db: Session, draft_user: User) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: draft_user
    with TestClient(app) as test_client:
        yield test_client


def test_get_shape(client: TestClient) -> None:
    response = client.get(URL)
    assert response.status_code == 200
    assert response.json() == {"overrides": {}, "tokens": EXPECTED_TOKENS}


def test_get_reads_legacy_oversized_parts(client: TestClient, api_db: Session) -> None:
    parts = {"subject": "x" * 2001, "intro": "ن" * 2001, "closing": "x" * 2001}
    api_db.add(AppSetting(key=SETTING_KEY, value=json.dumps({"General Book": parts})))
    api_db.commit()
    response = client.get(URL)
    assert response.status_code == 200
    assert response.json()["overrides"] == {"General Book": parts}


def test_round_trip_replaces_parts_and_preserves_other_keys(
    client: TestClient, api_db: Session
) -> None:
    first = {"subject": "طلب {ref}", "intro": "السادة {names}\nعدد {count}", "closing": "شكراً"}
    response = client.put(_url("General Book"), json=first)
    assert response.status_code == 200
    assert response.json() == {"overrides": {"General Book": first}, "tokens": EXPECTED_TOKENS}
    other = {"subject": "Bank {bank}"}
    assert client.put(_url("Salary Transfer Request"), json=other).status_code == 200
    replacement = {"intro": "  النص {detail}  "}
    response = client.put(
        _url("General Book"), json={**replacement, "subject": " \n", "closing": ""}
    )
    assert response.status_code == 200
    assert response.json()["overrides"] == {
        "General Book": replacement,
        "Salary Transfer Request": other,
    }
    assert client.get(URL).json() == response.json()
    row = api_db.get(AppSetting, SETTING_KEY)
    assert row is not None
    assert json.loads(row.value) == response.json()["overrides"]
    response = client.delete(_url("General Book"))
    assert response.status_code == 200
    assert response.json() == {
        "overrides": {"Salary Transfer Request": other},
        "tokens": EXPECTED_TOKENS,
    }
    response = client.put(_url("Salary Transfer Request"), json={"subject": " \n "})
    assert response.status_code == 200
    assert response.json()["overrides"] == {}
    assert client.delete(_url("Salary Transfer Request")).json()["overrides"] == {}


def test_all_basket_and_classification_keys(client: TestClient) -> None:
    keys = [
        *TEMPLATE_FILES,
        *(
            f"leave:{kind}"
            for kind in ("Annual", "Sick", "Compassionate", "Duty", "Emergency", "Hajj", "Others")
        ),
        "General Book:transfer",
        "absence:absent",
        "absence:returned",
        *(f"classification:{c.code}" for c in CLASSIFICATIONS),
    ]
    for key in keys:
        response = client.put(_url(key), json={"subject": "{names} {count}"})
        assert response.status_code == 200, (key, response.text)
        assert response.json()["overrides"][key] == {"subject": "{names} {count}"}


def test_classification_encoded_slash(client: TestClient) -> None:
    path = f"{URL}/classification%3A5%2F1"
    parts = {"intro": "كتاب {ref} بتاريخ {date}: {detail}"}
    response = client.put(path, json=parts)
    assert response.status_code == 200
    assert response.json()["overrides"] == {"classification:5/1": parts}
    response = client.delete(path)
    assert response.status_code == 200
    assert response.json()["overrides"] == {}


@pytest.mark.parametrize(
    "key",
    ["not-a-form", "leave:Annual Leave", "leave:National", "classification:16/1", "absence:other"],
)
def test_unknown_keys(client: TestClient, api_db: Session, key: str) -> None:
    for response in (client.put(_url(key), json={"subject": "Text"}), client.delete(_url(key))):
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "UNKNOWN_KEY"
        assert response.json()["error"]["details"] == {"key": key}
    assert api_db.get(AppSetting, SETTING_KEY) is None
    assert api_db.scalars(select(AuditLog)).all() == []


@pytest.mark.parametrize("part", ["subject", "intro", "closing"])
@pytest.mark.parametrize(
    "token", ["missing", "ref.__class__", "a.b", "", "ref-name", "ref!s", "ref:>10", "{ref"]
)
def test_unknown_tokens(client: TestClient, part: str, token: str) -> None:
    response = client.put(_url("General Book"), json={part: "{" + token + "}"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNKNOWN_TOKEN"
    assert response.json()["error"]["details"]["tokens"] == [token]


def test_unknown_tokens_aggregated_and_sorted(client: TestClient) -> None:
    response = client.put(
        _url("General Book"), json={"subject": "{z} {a}", "intro": "{a} {ref.__class__}"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"]["tokens"] == ["a", "ref.__class__", "z"]


@pytest.mark.parametrize(
    ("key", "family"),
    [
        ("General Book", "form"),
        ("classification:1/1", "classification"),
        ("leave:Sick", "leave"),
        ("Salary Transfer Request", "salary_transfer"),
        ("General Book:transfer", "transfer"),
        ("absence:absent", "absence"),
        ("absence:returned", "absence"),
    ],
)
def test_family_token_whitelists(client: TestClient, key: str, family: str) -> None:
    text = " ".join("{" + token + "}" for token in EXPECTED_TOKENS[family])
    response = client.put(_url(key), json={"intro": text})
    assert response.status_code == 200, response.text
    forbidden = "bank" if family != "salary_transfer" else "detail"
    response = client.put(_url(key), json={"intro": "{" + forbidden + "}"})
    assert response.status_code == 422
    assert response.json()["error"]["details"]["tokens"] == [forbidden]


@pytest.mark.parametrize("part", ["subject", "intro", "closing"])
@pytest.mark.parametrize(
    "text",
    [
        "<b>text</b>",
        "</p>",
        "<!DOCTYPE html>",
        "<أ>",
        "&nbsp;",
        "&#60;",
        "&#x3c;",
        "text &amp; more",
    ],
)
def test_html_rejected(client: TestClient, api_db: Session, part: str, text: str) -> None:
    response = client.put(_url("General Book"), json={part: text})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "HTML_NOT_ALLOWED"
    assert api_db.get(AppSetting, SETTING_KEY) is None
    assert api_db.scalars(select(AuditLog)).all() == []


def test_plain_text_and_unknown_body_fields(client: TestClient) -> None:
    parts = {"intro": "Arabic العربية\n2 < 3 & plain text {ref}"}
    assert client.put(_url("General Book"), json=parts).json()["overrides"]["General Book"] == parts
    response = client.put(_url("General Book"), json={"html": "text"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_long_open_brace_run_is_handled_quickly(api_db: Session) -> None:
    # Exercise the validator independently of the API's request-length guard.
    parts = EmailDraftTemplateParts.model_construct(subject="{" * 50_000, intro="{missing}")
    started = perf_counter()
    with pytest.raises(ValidationFailedError):
        email_draft_template_service.set_template(api_db, "General Book", parts, actor="test")
    assert perf_counter() - started < 5
    assert api_db.get(AppSetting, SETTING_KEY) is None


@pytest.mark.parametrize("part", ["subject", "intro", "closing"])
def test_parts_length_limit(client: TestClient, api_db: Session, part: str) -> None:
    response = client.put(_url("General Book"), json={part: "ن" * 2001})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert [
        (item["type"], item["loc"], item["ctx"]["max_length"])
        for item in error["details"]["errors"]
    ] == [("string_too_long", ["body", part], 2000)]
    assert api_db.get(AppSetting, SETTING_KEY) is None
    assert api_db.scalars(select(AuditLog)).all() == []
    assert client.put(_url("General Book"), json={part: "ن" * 2000}).status_code == 200


def test_permission_gate(client: TestClient, api_db: Session, draft_user: User) -> None:
    permission = api_db.scalar(
        select(UserPermission).where(UserPermission.user_id == draft_user.id)
    )
    permission.effect = "deny"
    api_db.commit()
    assert client.get(URL).status_code == 200
    for response in (
        client.put(_url("General Book"), json={"subject": "text"}),
        client.delete(_url("General Book")),
    ):
        assert response.status_code == 403
        assert response.json()["error"]["details"] == {"capability": "messages.templates"}
    assert api_db.get(AppSetting, SETTING_KEY) is None
    assert api_db.scalars(select(AuditLog)).all() == []


def test_get_requires_authentication(api_db: Session) -> None:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    with TestClient(app) as client:
        assert client.get(URL).status_code == 401


def test_audit_is_scoped_to_variant_and_skips_noops(
    client: TestClient, api_db: Session, draft_user: User
) -> None:
    path = _url("General Book")
    first = {"subject": "الأول {ref}"}
    second = {"intro": "الثاني {names}"}
    assert client.put(_url("Salary Transfer Request"), json={"subject": "Other"}).status_code == 200
    assert client.put(path, json=first).status_code == 200
    assert client.put(path, json=first).status_code == 200
    assert client.put(path, json=second).status_code == 200
    assert client.delete(path).status_code == 200
    assert client.delete(path).status_code == 200
    rows = api_db.scalars(
        select(AuditLog).where(AuditLog.entity_id == "General Book").order_by(AuditLog.id)
    ).all()
    assert len(rows) == 3
    assert all(
        row.actor == draft_user.email and row.entity_type == "email_draft_template" for row in rows
    )
    assert [row.action for row in rows] == [
        "email_draft_template.updated",
        "email_draft_template.updated",
        "email_draft_template.reset",
    ]
    assert [json.loads(row.payload) for row in rows] == [
        {"before": None, "after": first},
        {"before": first, "after": second},
        {"before": second, "after": None},
    ]


@pytest.mark.parametrize(
    "key",
    [
        "General Book",
        "classification:5/1",
        "leave:Sick",
        "Salary Transfer Request",
        "General Book:transfer",
        "absence:absent",
        "absence:returned",
    ],
)
def test_hidden_draft_is_omitted_from_lists_and_other_mutation_responses(
    client: TestClient, api_db: Session, draft_user: User, key: str
) -> None:
    parts = {"subject": "Private wording {names}"}
    assert client.put(_url(key), json=parts).status_code == 200
    assert client.get(URL).json()["overrides"][key] == parts
    view = f"messages.templates.view.email.{key}"
    perm_service.set_user_override(api_db, draft_user.id, view, "deny")
    assert key not in client.get(URL).json()["overrides"]
    # Mutations return the shared collection: never leak hidden siblings.
    other_key = "HR Request Form"
    response = client.put(_url(other_key), json={"subject": "Other wording"})
    assert response.status_code == 200
    assert key not in response.json()["overrides"]
    response = client.delete(_url(other_key))
    assert response.status_code == 200
    assert key not in response.json()["overrides"]
    for response in (
        client.put(_url(key), json={"subject": "Changed"}),
        client.delete(_url(key)),
    ):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "TEMPLATE_NOT_FOUND"
    assert json.loads(api_db.get(AppSetting, SETTING_KEY).value)[key] == parts
    perm_service.set_user_override(api_db, draft_user.id, view, None)
    assert client.get(URL).json()["overrides"][key] == parts


def test_draft_visibility_is_personal_and_never_leaks_through_general_settings(
    client: TestClient, api_db: Session, draft_user: User
) -> None:
    parts = {"subject": "Hidden configuration wording"}
    assert client.put(_url("General Book"), json=parts).status_code == 200
    perm_service.set_user_override(
        api_db, draft_user.id, "messages.templates.view.email.General Book", "deny"
    )
    assert client.get(URL).json()["overrides"] == {}
    settings = client.get("/api/v1/settings")
    assert settings.status_code == 200
    assert "Hidden configuration wording" not in settings.text
    assert SETTING_KEY not in settings.json()
    other = User(email="default-draft@test.ae", password_hash="x", role="operator", status="active")
    api_db.add(other)
    api_db.commit()
    client.app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(URL).json()["overrides"] == {"General Book": parts}
