"""A fleet reporter's papers name their addressee after «السيد»: the Report its
line manager, a General Book its line manager or the default manager."""

from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document as DocxDocument
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.api.v1 import documents as documents_api
from app.core import signature as signature_core
from app.db.models import Book, Document, Manager
from app.services import report_service, word_book_service
from tests.fleet_support import FleetEnv

LINE_TITLE = "مدير فرع الخدمات العامة"
CENTER_TITLE = "مدير مركز الاصلاح والتأهيل الوثبة -2"


@pytest.fixture()
def env(fleet_env: FleetEnv, monkeypatch: pytest.MonkeyPatch) -> FleetEnv:
    for module in (word_book_service, report_service):
        monkeypatch.setattr(module, "get_settings", lambda: fleet_env.settings)
    monkeypatch.setattr(word_book_service, "convert_docx_to_pdf", lambda _: None)
    # BackgroundTasks runs inline in TestClient but opens its own DB session.
    monkeypatch.setattr(
        documents_api,
        "SessionLocal",
        sessionmaker(bind=fleet_env.db.get_bind(), expire_on_commit=False),
    )
    _manager_row(fleet_env, fleet_env.line.id).title = LINE_TITLE
    _manager_row(fleet_env, fleet_env.branch.id).title = CENTER_TITLE
    fleet_env.branch.is_default_manager = True
    fleet_env.db.commit()
    return fleet_env


def _manager_row(env: FleetEnv, user_id: int) -> Manager:
    return env.db.scalars(select(Manager).where(Manager.user_id == user_id)).one()


def _addressee_line(path: Path) -> str:
    lines = [p.text for p in DocxDocument(str(path)).paragraphs if "السيد" in p.text]
    assert len(lines) == 1, lines
    return lines[0]


def _word_docx(env: FleetEnv, body: dict[str, object]) -> Path:
    response = env.client(env.reporter).post("/api/v1/books/word-sessions", json=body)
    assert response.status_code == 201, response.text
    created = response.json()
    return env.settings.data_dir / "editing" / f"book-{created['book_id']}" / created["filename"]


def _save_reporter_signature(env: FleetEnv) -> None:
    assert env.reporter.employee_id is not None
    path = signature_core.employee_signature_path(env.settings.vault_dir, env.reporter.employee_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (100, 40), (0, 0, 0, 255)).save(path)


def test_report_names_the_line_manager_by_title(env: FleetEnv) -> None:
    _save_reporter_signature(env)
    docx = _word_docx(env, {"subject": "Incident", "signer_employee_id": env.reporter.employee_id})
    assert LINE_TITLE in _addressee_line(docx)


def test_report_falls_back_to_the_line_managers_arabic_name(env: FleetEnv) -> None:
    _manager_row(env, env.line.id).title = None
    env.db.commit()
    _save_reporter_signature(env)
    docx = _word_docx(env, {"subject": "Incident", "signer_employee_id": env.reporter.employee_id})
    assert "المدير المباشر" in _addressee_line(docx)


def test_report_refuses_a_chosen_addressee(env: FleetEnv) -> None:
    _save_reporter_signature(env)
    response = env.client(env.reporter).post(
        "/api/v1/books/word-sessions",
        json={
            "subject": "Incident",
            "signer_employee_id": env.reporter.employee_id,
            "addressee": "default_manager",
        },
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "SCOPED_ROLE_INPUT_FORBIDDEN"


def test_addressees_are_the_line_manager_then_the_default_manager(env: FleetEnv) -> None:
    response = env.client(env.reporter).get("/api/v1/books/addressees")
    assert response.status_code == 200, response.text
    assert response.json() == [
        {"key": "line_manager", "label": LINE_TITLE},
        {"key": "default_manager", "label": CENTER_TITLE},
    ]


def test_default_manager_who_is_the_line_manager_is_offered_once(env: FleetEnv) -> None:
    env.branch.is_default_manager = False
    env.line.is_default_manager = True
    env.db.commit()
    response = env.client(env.reporter).get("/api/v1/books/addressees")
    assert response.json() == [{"key": "line_manager", "label": LINE_TITLE}]
    word = env.client(env.reporter).post(
        "/api/v1/books/word-sessions",
        json={"subject": "s", "classification_code": "11/1", "addressee": "default_manager"},
    )
    assert word.status_code == 409, word.text
    assert word.json()["error"]["code"] == "ADDRESSEE_UNAVAILABLE"


def test_addressees_need_a_line_manager(env: FleetEnv) -> None:
    env.reporter.line_manager_user_id = None
    env.db.commit()
    response = env.client(env.reporter).get("/api/v1/books/addressees")
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "LINE_MANAGER_REQUIRED"


def test_addressees_are_only_for_line_manager_roles(env: FleetEnv) -> None:
    response = env.client(env.admin).get("/api/v1/books/addressees")
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "ADDRESSEE_NOT_APPLICABLE"


@pytest.mark.parametrize(
    ("addressee", "title"), [(None, LINE_TITLE), ("default_manager", CENTER_TITLE)]
)
def test_word_general_book_names_the_chosen_addressee(
    env: FleetEnv, addressee: str | None, title: str
) -> None:
    body: dict[str, object] = {"subject": "s", "classification_code": "11/1"}
    if addressee is not None:
        body["addressee"] = addressee
    assert title in _addressee_line(_word_docx(env, body))


def test_word_general_book_refuses_a_shared_recipient(env: FleetEnv) -> None:
    response = env.client(env.reporter).post(
        "/api/v1/books/word-sessions",
        json={"subject": "s", "classification_code": "11/1", "recipient_id": 1},
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "SCOPED_ROLE_INPUT_FORBIDDEN"


def _generate_general_book(env: FleetEnv, fields: dict[str, object]) -> Book:
    response = env.client(env.reporter).post(
        "/api/v1/documents/generate",
        json={
            "template_id": "General Book",
            "employee_id": None,
            "fields": {"subject": "Fleet request", "body": "<p>Request</p>", **fields},
            "classification_code": "11/1",
            "commit": True,
        },
    )
    assert response.status_code == 202, response.text
    return env.db.scalars(select(Book)).one()


def test_editor_general_book_names_the_chosen_addressee(env: FleetEnv) -> None:
    # A revise replays stored fields; a stale recipient is replaced, not printed.
    book = _generate_general_book(
        env, {"addressee": "default_manager", "recipient_id": 1, "recipient_name": "Other"}
    )
    version = book.versions[-1]
    assert version.fields["recipient_name"] == CENTER_TITLE
    assert "recipient_id" not in version.fields
    document = env.db.get(Document, version.document_id)
    assert document is not None
    docx = Path(document.docx_path)
    if not docx.is_absolute():
        docx = env.settings.data_dir / docx
    assert CENTER_TITLE in _addressee_line(docx)


def test_editor_general_book_defaults_to_the_line_manager(env: FleetEnv) -> None:
    book = _generate_general_book(env, {})
    assert book.versions[-1].fields["recipient_name"] == LINE_TITLE


def test_editor_general_book_refuses_an_unknown_addressee(env: FleetEnv) -> None:
    response = env.client(env.reporter).post(
        "/api/v1/documents/generate",
        json={
            "template_id": "General Book",
            "employee_id": None,
            "fields": {"subject": "s", "body": "<p>b</p>", "addressee": "someone"},
            "classification_code": "11/1",
            "commit": True,
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "ADDRESSEE_UNAVAILABLE"
