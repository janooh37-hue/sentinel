"""A fleet reporter's Report names its line manager after «السيد»; the reporter
starts no General Book of its own, but the vehicle maintenance request (a General
Book to the contractor) and revising its own returned General Book still work."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from docx import Document as DocxDocument
from httpx import Response
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.api.v1 import documents as documents_api
from app.core import signature as signature_core
from app.db.models import Book, GeneralBookRecipient, Manager, User
from app.services import report_service, settings_service, word_book_service
from app.services.job_registry import get_job
from tests.fleet_support import FleetEnv, accident_letter, fines_letter, general_book

LINE_TITLE = "مدير فرع الخدمات العامة"


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
    _manager_row(fleet_env).title = LINE_TITLE
    fleet_env.db.commit()
    assert fleet_env.reporter.employee_id is not None
    signature = signature_core.employee_signature_path(
        fleet_env.settings.vault_dir, fleet_env.reporter.employee_id
    )
    signature.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (100, 40), (0, 0, 0, 255)).save(signature)
    return fleet_env


def _manager_row(env: FleetEnv) -> Manager:
    return env.db.scalars(select(Manager).where(Manager.user_id == env.line.id)).one()


def _book_count(env: FleetEnv) -> int:
    return env.db.scalar(select(func.count()).select_from(Book)) or 0


def _create_report(env: FleetEnv, **extra: object) -> dict[str, object]:
    response = env.client(env.reporter).post(
        "/api/v1/books/word-sessions",
        json={"subject": "Incident", "signer_employee_id": env.reporter.employee_id, **extra},
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


def _addressee_line(env: FleetEnv, created: dict[str, object]) -> str:
    path: Path = (
        env.settings.data_dir / "editing" / f"book-{created['book_id']}" / str(created["filename"])
    )
    lines = [p.text for p in DocxDocument(str(path)).paragraphs if "السيد" in p.text]
    assert len(lines) == 1, lines
    return lines[0]


def test_report_names_the_line_manager_by_title(env: FleetEnv) -> None:
    assert LINE_TITLE in _addressee_line(env, _create_report(env))


def test_report_falls_back_to_the_line_managers_arabic_name(env: FleetEnv) -> None:
    _manager_row(env).title = None
    env.db.commit()
    assert "المدير المباشر" in _addressee_line(env, _create_report(env))


def test_report_needs_a_line_manager(env: FleetEnv) -> None:
    env.reporter.line_manager_user_id = None
    env.db.commit()
    response = env.client(env.reporter).post(
        "/api/v1/books/word-sessions",
        json={"subject": "Incident", "signer_employee_id": env.reporter.employee_id},
    )
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "LINE_MANAGER_REQUIRED"


def test_report_refuses_a_chosen_recipient(env: FleetEnv) -> None:
    response = env.client(env.reporter).post(
        "/api/v1/books/word-sessions",
        json={
            "subject": "Incident",
            "signer_employee_id": env.reporter.employee_id,
            "recipient_id": 1,
        },
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "SCOPED_ROLE_INPUT_FORBIDDEN"


def test_reporter_starts_no_word_general_book(env: FleetEnv) -> None:
    response = env.client(env.reporter).post(
        "/api/v1/books/word-sessions", json={"subject": "s", "classification_code": "11/1"}
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "SCOPED_ROLE_SERVICE_FORBIDDEN"
    assert _book_count(env) == 0


def _generate_general_book(env: FleetEnv, **extra: object) -> Response:
    return env.client(env.reporter).post(
        "/api/v1/documents/generate",
        json={
            "template_id": "General Book",
            "employee_id": None,
            "fields": {"subject": "Fleet request", "body": "<p>Request</p>"},
            "classification_code": "11/1",
            "commit": True,
            **extra,
        },
    )


def test_reporter_starts_no_editor_general_book(env: FleetEnv) -> None:
    response = _generate_general_book(env)
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "SCOPED_ROLE_SERVICE_FORBIDDEN"
    assert _book_count(env) == 0


@pytest.mark.parametrize("template_id", ["Report", "Vehicle Fines", "Vehicle Accident Report"])
def test_reporter_starts_no_other_paper_through_generate(env: FleetEnv, template_id: str) -> None:
    # Its Report is the Word Report (author-signed, addressed to its line
    # manager) and its vehicle letters come from the vehicle services.
    response = _generate_general_book(env, template_id=template_id, classification_code=None)
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "SCOPED_ROLE_SERVICE_FORBIDDEN"
    assert _book_count(env) == 0


def test_reporter_revises_its_own_returned_general_book(env: FleetEnv) -> None:
    book = general_book(env, env.reporter)
    book.approval_state = "returned"
    book.versions[-1].status = "returned"
    env.db.commit()
    response = _generate_general_book(env, revise_of_book_id=book.id)
    assert response.status_code == 202, response.text
    assert len(env.book(book.id).versions) == 2


def _returned_general_book(env: FleetEnv, author: User) -> Book:
    book = general_book(env, author)
    book.approval_state = "returned"
    book.versions[-1].status = "returned"
    env.db.commit()
    return book


def test_reporter_previews_the_revision_of_its_own_returned_general_book(
    env: FleetEnv,
) -> None:
    book = _returned_general_book(env, env.reporter)
    books_before = _book_count(env)
    ref_before = book.ref_number

    response = _generate_general_book(env, revise_of_book_id=book.id, commit=False)

    assert response.status_code == 202, response.text
    job = get_job(response.json()["job_id"])
    assert job is not None and job.status == "done", job
    assert job.book_id is None
    # Nothing filed, revised or allocated.
    assert _book_count(env) == books_before
    revised = env.book(book.id)
    assert len(revised.versions) == 1
    assert (revised.ref_number, revised.approval_state) == (ref_before, "returned")


@pytest.mark.parametrize(
    ("case", "status", "code"),
    [
        ("other_author", 403, "SCOPED_ROLE_NOT_OWNER"),
        ("pending", 409, "SCOPED_ROLE_STATE_LOCKED"),
        ("no_book", 403, "SCOPED_ROLE_SERVICE_FORBIDDEN"),
    ],
)
def test_reporter_revision_preview_needs_its_own_returned_book(
    env: FleetEnv, case: str, status: int, code: str
) -> None:
    book = _returned_general_book(
        env, env.other_reporter if case == "other_author" else env.reporter
    )
    if case == "pending":
        book.approval_state = "pending"
        env.db.commit()
    books_before = _book_count(env)
    extra: dict[str, object] = {"commit": False}
    if case != "no_book":
        extra["revise_of_book_id"] = book.id

    response = _generate_general_book(env, **extra)

    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert _book_count(env) == books_before
    assert len(env.book(book.id).versions) == 1


@pytest.mark.parametrize("commit", [True, False])
@pytest.mark.parametrize("make_letter", [fines_letter, accident_letter])
def test_reporter_cannot_overwrite_a_vehicle_letter_with_a_general_book(
    env: FleetEnv, make_letter: Callable[[FleetEnv, User], Book], commit: bool
) -> None:
    # Its returned vehicle letter is revised by Rebuild, never replaced by
    # free General Book content through generic generation.
    book = make_letter(env, env.reporter)
    book.approval_state = "returned"
    book.versions[-1].status = "returned"
    env.db.commit()
    template_before = book.versions[-1].template_id

    response = _generate_general_book(env, revise_of_book_id=book.id, commit=commit)

    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "SCOPED_ROLE_SERVICE_FORBIDDEN"
    revised = env.book(book.id)
    assert len(revised.versions) == 1
    assert revised.versions[-1].template_id == template_before


def test_reporter_still_files_a_maintenance_request(env: FleetEnv) -> None:
    contractor = GeneralBookRecipient(name="ورشة الأمان")
    env.db.add(contractor)
    env.db.flush()
    settings_service.set_vehicle_maintenance_contractor_id(env.db, contractor.id)
    env.db.commit()
    response = env.client(env.reporter).post(
        f"/api/v1/vehicles/{env.vehicle.id}/maintenance-requests",
        json={"type": "repair", "description": "فحص المحرك", "employee_id": "G7401"},
    )
    assert response.status_code == 201, response.text
    book = env.book(response.json()["letter"]["book_id"])
    assert book.versions[-1].template_id == "General Book"
    assert book.created_by_user_id == env.reporter.id
