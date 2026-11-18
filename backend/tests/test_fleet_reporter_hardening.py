"""Security-review regressions for the fleet reporter (scoped-role) surface."""

from __future__ import annotations

import io

import pytest
from httpx import Response
from sqlalchemy import select

from app.api.errors import AppError
from app.db.models import (
    Book,
    BookEditSession,
    BookFolder,
    BookFolderItem,
    Document,
    UserPermission,
)
from app.services import book_service, document_service, perm_service, vehicle_letter_service
from tests.fleet_support import (
    FleetEnv,
    accident_letter,
    current_version_id,
    fines_letter,
    general_book,
    submit,
)


def _assert_error(response: Response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code, response.text


# 1. Folders ------------------------------------------------------------------


def _team_folder(env: FleetEnv) -> BookFolder:
    folder = BookFolder(owner_user_id=None, name="Team", created_by_user_id=env.admin.id)
    env.db.add(folder)
    env.db.commit()
    return folder


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/books/folders", None),
        ("POST", "/api/v1/books/folders", {"name": "Mine", "team": False}),
        ("GET", "/api/v1/books/folders/share-options", None),
        ("PATCH", "/api/v1/books/folders/{folder}", {"name": "Renamed"}),
        ("DELETE", "/api/v1/books/folders/{folder}", None),
        (
            "PUT",
            "/api/v1/books/folders/{folder}/shares",
            {"everyone": True, "user_ids": [], "departments": []},
        ),
        ("PUT", "/api/v1/books/{book}/folders/{folder}", None),
        ("DELETE", "/api/v1/books/{book}/folders/{folder}", None),
    ],
)
def test_fleet_reporter_is_excluded_from_every_folder_operation(
    fleet_env: FleetEnv, method: str, path: str, body: dict[str, object] | None
) -> None:
    env = fleet_env
    folder = _team_folder(env)
    book = general_book(env, env.reporter)
    env.db.add(BookFolderItem(folder_id=folder.id, book_id=book.id, added_by_user_id=env.admin.id))
    env.db.commit()

    response = env.client(env.reporter).request(
        method, path.format(folder=folder.id, book=book.id), json=body
    )

    _assert_error(response, 403, "SCOPED_ROLE_FOLDERS_FORBIDDEN")
    assert env.db.get(BookFolder, folder.id) is not None
    assert env.db.scalars(select(BookFolder.name)).all() == ["Team"]
    assert env.db.scalars(select(BookFolderItem.book_id)).all() == [book.id]


def test_fleet_reporter_cannot_filter_the_register_by_folder(fleet_env: FleetEnv) -> None:
    env = fleet_env
    folder = _team_folder(env)

    response = env.client(env.reporter).get("/api/v1/books", params={"folder_id": folder.id})

    _assert_error(response, 403, "SCOPED_ROLE_FOLDERS_FORBIDDEN")
    assert (
        env.client(env.operator).get("/api/v1/books", params={"folder_id": folder.id}).status_code
        == 200
    )


# 2. The chain follows the paper's author, not the submitter -------------------


@pytest.mark.parametrize("submitter", ["line", "admin"])
def test_only_the_fleet_author_can_submit_their_paper(fleet_env: FleetEnv, submitter: str) -> None:
    env = fleet_env
    book = general_book(env, env.reporter)

    response = env.client(getattr(env, submitter)).post(
        f"/api/v1/books/{book.id}/submit", json={"approver_user_id": env.line.id}
    )

    _assert_error(response, 403, "SCOPED_ROLE_CHAIN_AUTHOR_ONLY")
    book = env.book(book.id)
    assert book.approval_state == "none"
    assert book.versions[-1].approval_steps == []


def test_resubmission_after_return_is_author_only_and_rebuilds_the_line_step(
    fleet_env: FleetEnv,
) -> None:
    env = fleet_env
    book = submit(env, fines_letter(env, env.reporter), env.reporter)
    returned = env.client(env.line).post(
        f"/api/v1/books/{book.id}/return",
        json={"version_id": current_version_id(book), "note": "Fix the plate."},
    )
    assert returned.status_code == 200, returned.text

    with pytest.raises(AppError) as raised:
        book_service.submit_for_approval(
            env.db,
            book.id,
            priority="Normal",
            approver_user_id=env.line.id,
            reviewer_user_ids=[],
            submitted_by_user_id=env.line.id,
        )
    assert raised.value.code == "SCOPED_ROLE_CHAIN_AUTHOR_ONLY"

    book = submit(env, env.book(book.id), env.reporter)
    assert [
        (step.stage_label, step.assignee_user_id, step.state)
        for step in book.versions[-1].approval_steps
    ] == [("line_manager", env.line.id, "pending")]


# 3. Inmate-only upload route ----------------------------------------------------


def test_fleet_reporter_cannot_inspect_inmate_violation_imports(fleet_env: FleetEnv) -> None:
    env = fleet_env
    response = env.client(env.reporter).post(
        "/api/v1/documents/inmate-violations/approved-imports/inspect",
        files={"file": ("approved.pdf", io.BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    )
    _assert_error(response, 403, "SCOPED_ROLE_ROUTE_FORBIDDEN")


# 4. SQL and Python agree on a denied record type ---------------------------------


def test_denied_record_type_hides_the_paper_on_list_open_and_documents(
    fleet_env: FleetEnv,
) -> None:
    env = fleet_env
    letter = fines_letter(env, env.operator)
    document_id = letter.versions[-1].document_id
    assert document_id is not None
    client = env.client(env.reporter)
    assert client.get(f"/api/v1/books/{letter.id}").status_code == 200

    env.db.add(
        UserPermission(
            user_id=env.reporter.id,
            capability="books.servicerecords.Vehicle Fines",
            effect="deny",
        )
    )
    env.db.commit()
    perm_service._invalidate_caps_cache(env.db, env.reporter.id)

    listed = {item["id"] for item in client.get("/api/v1/books").json()["items"]}
    assert letter.id not in listed
    assert client.get(f"/api/v1/books/{letter.id}").status_code == 404
    readable_documents = set(
        env.db.scalars(
            select(Document.id).where(
                document_service.live_record_document_clause(env.db, env.reporter)
            )
        )
    )
    assert document_id not in readable_documents


def _deny(env: FleetEnv, capability: str) -> None:
    env.db.add(UserPermission(user_id=env.reporter.id, capability=capability, effect="deny"))
    env.db.commit()
    perm_service._invalidate_caps_cache(env.db, env.reporter.id)


def test_denied_record_type_also_closes_the_authors_own_returned_paper(
    fleet_env: FleetEnv,
) -> None:
    env = fleet_env
    book = general_book(env, env.reporter)
    book.approval_state = "returned"
    book.versions[-1].status = "returned"
    env.db.commit()
    version_id = current_version_id(book)
    client = env.client(env.reporter)
    fields_path = f"/api/v1/books/{book.id}/versions/{version_id}/fields"
    assert client.get(fields_path).status_code == 200

    _deny(env, "books.category.11/1")

    assert client.get(f"/api/v1/books/{book.id}").status_code == 404
    assert client.get(fields_path).status_code == 404


def test_own_general_book_does_not_open_in_word(fleet_env: FleetEnv) -> None:
    # A Word round-trip would drop the fields approval re-renders the signer from.
    env = fleet_env
    book = general_book(env, env.reporter)
    book.approval_state = "returned"
    book.versions[-1].status = "returned"
    env.db.commit()

    response = env.client(env.reporter).post(f"/api/v1/books/{book.id}/word-sessions")

    _assert_error(response, 403, "SCOPED_ROLE_NOT_OWNER")
    assert env.db.query(BookEditSession).filter_by(book_id=book.id).count() == 0


def test_denied_books_view_closes_direct_reads_and_documents(fleet_env: FleetEnv) -> None:
    env = fleet_env
    letter = fines_letter(env, env.reporter)
    document_id = letter.versions[-1].document_id
    assert document_id is not None
    client = env.client(env.reporter)
    assert client.get(f"/api/v1/books/{letter.id}").status_code == 200

    _deny(env, "books.view")

    _assert_error(client.get(f"/api/v1/books/{letter.id}"), 403, "FORBIDDEN")
    _assert_error(client.get(f"/api/v1/documents/{document_id}/download"), 403, "FORBIDDEN")
    readable = env.db.scalars(
        select(Book.id).where(book_service.full_read_access_clause(env.db, env.reporter))
    ).all()
    assert letter.id not in readable


# 5. An existing accident letter is returned only to a reader ---------------------


def test_accident_letter_route_does_not_leak_another_reporters_draft(fleet_env: FleetEnv) -> None:
    env = fleet_env
    draft = accident_letter(env, env.reporter)
    assert draft.approval_state == "none"

    response = env.client(env.other_reporter).post(
        f"/api/v1/vehicles/{env.vehicle.id}/accidents/{env.accident.id}/letter"
    )

    _assert_error(response, 409, "ACCIDENT_LETTER_NOT_VISIBLE")
    assert draft.ref_number not in response.text
    assert str(draft.id) not in response.json()["error"].get("details", {}).values()
    # The author, and once filed every fleet reporter, still get the existing letter.
    again = vehicle_letter_service.generate_accident_letter(
        env.db, env.vehicle.id, env.accident.id, user=env.reporter
    )
    assert again.book_id == draft.id
    submit(env, env.book(draft.id), env.reporter)
    shared = vehicle_letter_service.generate_accident_letter(
        env.db, env.vehicle.id, env.accident.id, user=env.other_reporter
    )
    assert shared.book_id == draft.id
    assert env.db.scalars(select(Book.id).where(Book.category_id == "VA")).all() == [draft.id]
