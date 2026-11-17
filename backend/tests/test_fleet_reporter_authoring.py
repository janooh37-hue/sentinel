"""Fleet authors save unsigned drafts and see only their own or filed fleet papers."""

from __future__ import annotations

import json
from datetime import datetime

import pytest
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.api.errors import AppError
from app.api.v1 import documents as documents_api
from app.core import signature as signature_core
from app.db.models import AuditLog, Book, BookEditSession, Manager, User, VehicleOdometerReading
from app.schemas.settings import AppSettingsUpdate
from app.services import (
    manager_service,
    report_service,
    settings_service,
    vehicle_letter_service,
    word_book_service,
)
from tests.fleet_support import FleetEnv, accident_letter, fines_letter, general_book, submit


def _assert_unsubmitted(book: Book) -> None:
    assert book.approval_state == "none"
    assert book.submitted_by_user_id is None
    assert book.doc_manager_id is None
    assert book.approval_steps == []
    assert book.versions[-1].manager_sig_embedded is False


def _assert_visibility(
    env: FleetEnv, user: User, books: list[Book], expected_ids: set[int]
) -> None:
    """Exercise SQL listing and the object-level authorization mirror together."""
    client = env.client(user)
    response = client.get("/api/v1/books")
    assert response.status_code == 200, response.text
    listed_ids = {item["id"] for item in response.json()["items"]}
    assert listed_ids == expected_ids
    for book in books:
        opened = client.get(f"/api/v1/books/{book.id}")
        assert opened.status_code == (200 if book.id in expected_ids else 404), opened.text
        assert (book.id in listed_ids) == (opened.status_code == 200)
        if opened.status_code == 200:
            assert opened.json()["id"] == book.id
            assert opened.json()["ref_number"] == book.ref_number
        else:
            assert opened.json()["error"]["code"] == "BOOK_NOT_FOUND"


@pytest.fixture()
def word_env(fleet_env: FleetEnv, monkeypatch: pytest.MonkeyPatch) -> FleetEnv:
    # Real repository templates, isolated output, and no dependency on desktop Word.
    for module in (word_book_service, report_service):
        monkeypatch.setattr(module, "get_settings", lambda: fleet_env.settings)
    monkeypatch.setattr(word_book_service, "convert_docx_to_pdf", lambda _: None)
    return fleet_env


def test_general_book_api_rejects_out_of_scope_before_creating_book(
    fleet_env: FleetEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = fleet_env
    # BackgroundTasks runs inline in TestClient but opens its own DB session.
    monkeypatch.setattr(
        documents_api,
        "SessionLocal",
        sessionmaker(bind=env.db.get_bind(), expire_on_commit=False),
    )
    client = env.client(env.reporter)
    payload = {
        "template_id": "General Book",
        "employee_id": None,
        "fields": {"subject": "Fleet request", "body": "<p>Request</p>"},
        "classification_code": "15/1",
        "commit": True,
    }
    before = env.db.scalar(select(func.count()).select_from(Book))
    forbidden = client.post("/api/v1/documents/generate", json=payload)
    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["error"]["code"] == "RECORD_TYPE_FORBIDDEN"
    assert env.db.scalar(select(func.count()).select_from(Book)) == before

    payload["classification_code"] = "11/1"
    allowed = client.post("/api/v1/documents/generate", json=payload)
    assert allowed.status_code == 202, allowed.text
    assert allowed.json()["job_id"]
    book = env.db.scalars(select(Book)).one()
    assert book.classification_code == "11/1"
    assert book.created_by_user_id == env.reporter.id
    _assert_unsubmitted(book)


@pytest.mark.parametrize("classification_code", ["7/1", "11/1"])
def test_general_book_allowed_classifications_start_unsigned(
    fleet_env: FleetEnv, classification_code: str
) -> None:
    book = general_book(fleet_env, fleet_env.reporter, classification_code)
    assert book.classification_code == classification_code
    assert book.created_by_user_id == fleet_env.reporter.id
    _assert_unsubmitted(book)


# 13/1 holds Reports, which a fleet reporter authors by service alone; a General
# Book there must still answer to the (absent) books.category.13/1 capability.
@pytest.mark.parametrize("classification_code", ["15/1", "13/1"])
def test_general_book_service_rejects_out_of_scope_classification(
    fleet_env: FleetEnv, classification_code: str
) -> None:
    with pytest.raises(AppError) as raised:
        general_book(fleet_env, fleet_env.reporter, classification_code)
    assert raised.value.code == "RECORD_TYPE_FORBIDDEN"
    assert raised.value.http_status == 403
    assert fleet_env.db.scalar(select(func.count()).select_from(Book)) == 0


def test_general_book_service_cannot_choose_signing_manager(fleet_env: FleetEnv) -> None:
    manager = fleet_env.db.scalars(
        select(Manager).where(Manager.user_id == fleet_env.line.id)
    ).one()
    with pytest.raises(AppError) as raised:
        general_book(fleet_env, fleet_env.reporter, manager_id=manager.id)
    assert raised.value.code == "SCOPED_ROLE_INPUT_FORBIDDEN"
    assert raised.value.http_status == 403
    assert fleet_env.db.scalar(select(func.count()).select_from(Book)) == 0


@pytest.mark.parametrize(
    ("extra", "code"),
    [
        ({"classification_code": "15/1"}, "RECORD_TYPE_FORBIDDEN"),
        ({"classification_code": "13/1"}, "RECORD_TYPE_FORBIDDEN"),
        ({"classification_code": "11/1", "manager_id": 12345}, "SCOPED_ROLE_INPUT_FORBIDDEN"),
    ],
)
def test_word_create_rejects_out_of_scope_inputs(
    fleet_env: FleetEnv, extra: dict[str, object], code: str
) -> None:
    response = fleet_env.client(fleet_env.reporter).post(
        "/api/v1/books/word-sessions", json={"subject": "s", **extra}
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == code
    assert fleet_env.db.scalar(select(func.count()).select_from(Book)) == 0


def test_word_create_allowed_classification_starts_unapproved(word_env: FleetEnv) -> None:
    env = word_env
    response = env.client(env.reporter).post(
        "/api/v1/books/word-sessions", json={"subject": "s", "classification_code": "11/1"}
    )
    assert response.status_code == 201, response.text
    book = env.book(response.json()["book_id"])
    assert book.classification_code == "11/1"
    assert book.created_by_user_id == env.reporter.id
    assert book.approval_state == "none"
    assert book.doc_manager_id is None
    assert book.approval_steps == []


def test_word_report_is_authorised_by_service_alone_and_stays_private(word_env: FleetEnv) -> None:
    """A Report (record category 13/1, outside the ceiling) is created, listed and
    opened by its fleet author through the Report service capabilities only."""
    env = word_env
    signature = signature_core.employee_signature_path(
        env.settings.vault_dir, env.reporter.employee_id
    )
    signature.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (100, 40), (0, 0, 0, 255)).save(signature)
    response = env.client(env.reporter).post(
        "/api/v1/books/word-sessions",
        json={"subject": "Incident report", "signer_employee_id": env.reporter.employee_id},
    )
    assert response.status_code == 201, response.text
    report = env.book(response.json()["book_id"])
    assert report.ref_number.startswith("REPORT-")
    assert report.classification_code is None
    assert report.approval_state == "none"
    _assert_visibility(env, env.reporter, [report], {report.id})
    _assert_visibility(env, env.other_reporter, [report], set())


def test_vehicle_letter_fleet_draft_does_not_inherit_operator_auto_signing(
    fleet_env: FleetEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = fleet_env
    monkeypatch.setattr(manager_service, "get_settings", lambda: env.settings)
    manager = env.db.scalars(select(Manager).where(Manager.user_id == env.line.id)).one()
    signature = signature_core.employee_signature_path(env.settings.vault_dir, env.line.employee_id)
    signature.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (100, 40), (0, 0, 0, 255)).save(signature)
    settings_service.update_settings(env.db, AppSettingsUpdate(default_manager_id=manager.id))
    assert manager_service.signature_str(env.db, manager) == str(signature)

    fleet = fines_letter(env, env.reporter)
    operator = fines_letter(env, env.operator)
    _assert_unsubmitted(fleet)
    assert operator.approval_state == "approved"
    assert operator.submitted_by_user_id is None
    assert operator.approval_steps == []
    assert operator.doc_manager_id == manager.id
    assert operator.versions[-1].manager_sig_embedded is True
    audits = env.db.scalars(select(AuditLog).where(AuditLog.action == "auto_sign_embed")).all()
    assert [row.entity_id for row in audits] == [str(operator.id)]
    assert json.loads(audits[0].payload)["signing_manager_id"] == manager.id


def test_mileage_log_by_fleet_reporter_starts_unsigned(fleet_env: FleetEnv) -> None:
    env = fleet_env
    env.db.add_all(
        [
            VehicleOdometerReading(
                vehicle_id=env.vehicle.id, month="2026-08", opening_km=100000, closing_km=101000
            ),
            VehicleOdometerReading(vehicle_id=env.vehicle.id, month="2026-09", closing_km=103450),
        ]
    )
    env.db.commit()
    result = vehicle_letter_service.generate_odometer_form(
        env.db, month="2026-09", vehicle_ids=None, user=env.reporter
    )
    book = env.book(result.book_id)
    assert book.classification_code == "11/1"
    assert book.versions[-1].template_id == "Vehicle Mileage Log"
    _assert_unsubmitted(book)


@pytest.mark.parametrize("classification_code", ["7/1", "11/1"])
def test_other_users_general_book_hidden_before_and_after_approval(
    fleet_env: FleetEnv, classification_code: str
) -> None:
    env = fleet_env
    book = general_book(env, env.operator, classification_code)
    for state in ("none", "approved"):
        book.approval_state = state
        book.versions[-1].status = state
        env.db.commit()
        for reporter in (env.reporter, env.other_reporter):
            _assert_visibility(env, reporter, [book], set())


def test_other_users_report_hidden_even_when_approved_under_allowed_categories(
    word_env: FleetEnv,
) -> None:
    env = word_env
    info = word_book_service.create_report_word_book(
        env.db,
        user=env.operator,
        signer_employee_id=env.operator.employee_id,
        recipient_id=None,
        subject="Operator report",
        date="2026-07-23",
        sign=False,
    )
    session = env.db.scalars(
        select(BookEditSession).where(BookEditSession.book_id == info.book_id)
    ).one()
    session.last_put_at = datetime.now()
    env.db.commit()
    book = word_book_service.finish_word_session(env.db, user=env.operator, book_id=info.book_id)
    assert book.versions[-1].template_id == "Report"
    assert book.approval_state == "approved"
    for classification in (None, "7/1", "11/1"):
        book.classification_code = classification
        env.db.commit()
        for reporter in (env.reporter, env.other_reporter):
            _assert_visibility(env, reporter, [book], set())


def test_operator_auto_letters_visible_with_another_fleet_reporter_draft_present(
    fleet_env: FleetEnv,
) -> None:
    env = fleet_env
    # Keep this insertion order: an uncorrelated author subquery used to hide
    # ALL unsigned auto letters as soon as any fleet-authored book existed.
    draft = fines_letter(env, env.reporter)
    auto = fines_letter(env, env.operator)
    approved = accident_letter(env, env.operator)
    assert auto.approval_state == "none"
    assert auto.submitted_by_user_id is None
    approved.approval_state = "approved"
    approved.versions[-1].status = "approved"
    env.db.commit()
    books = [draft, auto, approved]
    _assert_visibility(env, env.reporter, books, {book.id for book in books})
    _assert_visibility(env, env.other_reporter, books, {auto.id, approved.id})


def test_fleet_letter_privacy_tracks_submission_and_decisions(fleet_env: FleetEnv) -> None:
    env = fleet_env
    book = fines_letter(env, env.reporter)
    for state in ("none", "pending", "returned", "rejected", "approved"):
        if state == "pending":
            book = submit(env, book, env.reporter)
            assert book.approval_state == "pending"
        else:
            book.approval_state = state
            book.versions[-1].status = state
            env.db.commit()
        _assert_visibility(env, env.reporter, [book], {book.id})
        expected = {book.id} if state in ("pending", "approved") else set()
        _assert_visibility(env, env.other_reporter, [book], expected)


def test_own_general_books_visible_in_every_approval_state(fleet_env: FleetEnv) -> None:
    env = fleet_env
    book = general_book(env, env.reporter)
    for state in ("none", "pending", "returned", "rejected", "approved"):
        if state == "pending":
            book = submit(env, book, env.reporter)
        else:
            book.approval_state = state
            book.versions[-1].status = state
            env.db.commit()
        _assert_visibility(env, env.reporter, [book], {book.id})
        _assert_visibility(env, env.other_reporter, [book], set())


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("POST", "send", {"user_ids": [], "purpose": "info"}),
        ("PUT", "confidentiality", {"confidentiality": "personal"}),
        ("POST", "derive", {"kind": "reply"}),
    ],
)
def test_fleet_reporter_cannot_send_relabel_or_derive(
    fleet_env: FleetEnv, method: str, suffix: str, body: dict[str, object]
) -> None:
    env = fleet_env
    book = fines_letter(env, env.reporter)
    if suffix == "send":
        body = {**body, "user_ids": [env.operator.id]}
    response = env.client(env.reporter).request(
        method, f"/api/v1/books/{book.id}/{suffix}", json=body
    )
    assert response.status_code == 403, response.text
    if suffix == "confidentiality":
        assert response.json()["error"]["code"] == "SCOPED_ROLE_ROUTE_FORBIDDEN"
    assert env.book(book.id).confidentiality == "general"


def test_scoped_reporters_are_not_send_recipient_candidates(fleet_env: FleetEnv) -> None:
    env = fleet_env
    response = env.client(env.operator).get("/api/v1/books/recipient-candidates")
    assert response.status_code == 200, response.text
    ids = {item["id"] for item in response.json()}
    assert env.line.id in ids
    assert env.reporter.id not in ids
    assert env.other_reporter.id not in ids


def test_fleet_reporter_cannot_download_own_vehicle_letter_as_docx(fleet_env: FleetEnv) -> None:
    env = fleet_env
    book = fines_letter(env, env.reporter)
    document_id = book.versions[-1].document_id
    assert document_id is not None
    response = env.client(env.reporter).get(
        f"/api/v1/documents/{document_id}/download", params={"format": "docx"}
    )
    assert response.status_code == 403, response.text
