"""Team folder sharing is separate from each book's access and filing provenance."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import func, select

from app.db.models import BookFolderItem, BookFolderShare, Employee
from tests.conftest import make_user
from tests.test_book_grade import API, ApiHarness, _error, _send
from tests.test_book_grade import grade_api as grade_api
from tests.test_books_desk_list import _create_folder, _folders, _rows


def _employee(api: ApiHarness, actor: str, department: str | None) -> None:
    employee = Employee(
        id=f"G-SHARE-{actor}",
        name_en=f"Employee {actor}",
        name_ar=f"الموظف {actor}",
        position="Coordinator",
        position_ar="منسق",
        department=department,
    )
    api.db.add(employee)
    api.db.flush()
    api.users[actor].employee_id = employee.id
    api.db.commit()


def _share(api: ApiHarness, folder_id: int, **body: object):
    return api.client.put(f"{API}/books/folders/{folder_id}/shares", json=body)


def test_restricted_team_visibility_filing_and_everyone(grade_api: ApiHarness) -> None:
    api = grade_api
    _employee(api, "M", "Management")
    _employee(api, "B", "Stores")
    _employee(api, "C", "  fINance ")
    # Everyone who files the book has it in Incoming, the folder's box.
    api.as_user("D")
    _send(api, "general", ["A", "B", "C", "M"])
    api.as_user("M")
    _send(api, "general", ["D"])
    folder = _create_folder(api, "Restricted team", team=True)
    assert folder["everyone"] is True
    assert folder["created_by_name"] == "Employee M"
    assert folder["created_by_name_ar"] == "الموظف M"
    result = _share(
        api,
        folder["id"],
        everyone=False,
        user_ids=[api.users["B"].id] * 2,
        departments=[" Finance ", "finance"],
    )
    assert result.status_code == 200, result.text
    restricted = result.json()
    assert restricted["everyone"] is False
    assert restricted["shared_users"] == [
        {
            "id": api.users["B"].id,
            "name": "Employee B",
            "name_ar": "الموظف B",
            "title": "Coordinator",
            "title_ar": "منسق",
        }
    ]
    assert len(restricted["shared_departments"]) == 1
    book_id, folder_id = api.records["general"].id, folder["id"]
    filing_path = f"{API}/books/{book_id}/folders/{folder_id}"
    for actor in ("B", "C", "M", "D"):
        api.as_user(actor)
        assert [f["id"] for f in _folders(api)] == [folder_id]
        assert api.client.put(filing_path).status_code == 204
        assert [row["id"] for row in _rows(api, folder_id=folder_id)] == [book_id]
    # The first filing survives idempotent filing by other people.
    (filed,) = _rows(api, folder_id=folder_id)
    assert filed["filed_by_name"] == "Employee B"
    assert filed["filed_by_name_ar"] == "الموظف B"
    assert datetime.fromisoformat(filed["filed_at"]) is not None
    for row in _rows(api):
        assert row["filed_by_name"] is row["filed_by_name_ar"] is row["filed_at"] is None
    api.as_user("A")
    assert _folders(api) == []
    for response in (
        api.client.get(f"{API}/books", params={"folder_id": folder_id}),
        api.client.put(filing_path),
        api.client.delete(filing_path),
        api.client.patch(f"{API}/books/folders/{folder_id}", json={"name": "Hidden"}),
        api.client.delete(f"{API}/books/folders/{folder_id}"),
    ):
        _error(response, 404, "FOLDER_NOT_FOUND")
    api.as_user("D")
    result = _share(api, folder_id, everyone=True)
    assert result.status_code == 200, result.text
    assert result.json()["everyone"] is True
    assert result.json()["shared_users"] == result.json()["shared_departments"] == []
    api.as_user("A")
    assert [f["id"] for f in _folders(api)] == [folder_id]
    assert api.client.put(filing_path).status_code == 204
    assert _rows(api, folder_id=folder_id)[0]["id"] == book_id


def test_share_validation_and_atomic_replacement(grade_api: ApiHarness) -> None:
    api = grade_api
    _send(api, "general", ["M"])
    api.as_user("M")
    personal = _create_folder(api, "Personal")
    _error(_share(api, personal["id"], everyone=True), 422, "FOLDER_NOT_TEAM")
    folder = _create_folder(api, "Team", team=True)
    folder_id = folder["id"]
    assert _share(api, folder_id, everyone=False, user_ids=[api.users["B"].id]).status_code == 200
    inactive = make_user(api.db, email="inactive-share@test.ae")
    inactive.status = "disabled"
    reporter = make_user(api.db, role="inmate_reporter", email="reporter-share@test.ae")
    api.db.commit()
    _error(_share(api, folder_id, everyone=False), 422, "FOLDER_SHARES_EMPTY")
    for user_id in (999999, inactive.id, reporter.id):
        _error(
            _share(api, folder_id, everyone=False, user_ids=[user_id]),
            422,
            "FOLDER_SHARE_USER_INVALID",
        )
    team_folder = next(row for row in _folders(api) if row["id"] == folder_id)
    assert team_folder["shared_users"][0]["id"] == api.users["B"].id
    api.as_user("B")
    _error(_share(api, folder_id, everyone=True), 403, "FORBIDDEN")
    _error(api.client.get(f"{API}/books/folders/share-options"), 403, "FORBIDDEN")
    api.as_user("M")
    changed = _share(api, folder_id, everyone=False, departments=["Finance"])
    assert changed.status_code == 200, changed.text
    assert changed.json()["shared_users"] == []
    assert changed.json()["shared_departments"] == ["Finance"]
    api.as_user("B")
    assert _folders(api) == []
    api.as_user("M")
    assert (
        api.client.put(f"{API}/books/{api.records['general'].id}/folders/{folder_id}").status_code
        == 204
    )
    assert api.client.delete(f"{API}/books/folders/{folder_id}").status_code == 204
    for model in (BookFolderShare, BookFolderItem):
        assert (
            api.db.scalar(
                select(func.count()).select_from(model).where(model.folder_id == folder_id)
            )
            == 0
        )


def test_share_options_shape_and_active_directory(grade_api: ApiHarness) -> None:
    api = grade_api
    _employee(api, "A", " Finance ")
    _employee(api, "B", "Finance")
    _employee(api, "C", "   ")
    inactive = make_user(api.db, email="inactive-options@test.ae")
    inactive.status = "disabled"
    reporter = make_user(api.db, role="inmate_reporter", email="reporter-options@test.ae")
    api.db.commit()
    api.as_user("D")
    response = api.client.get(f"{API}/books/folders/share-options")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["departments"] == ["Finance"]
    assert {u["id"] for u in body["users"]} == {u.id for u in api.users.values()}
    assert inactive.id not in {u["id"] for u in body["users"]}
    assert reporter.id not in {u["id"] for u in body["users"]}
    assert [u["name"].casefold() for u in body["users"]] == sorted(
        u["name"].casefold() for u in body["users"]
    )
    option = next(u for u in body["users"] if u["id"] == api.users["A"].id)
    assert option == {
        "id": api.users["A"].id,
        "name": "Employee A",
        "name_ar": "الموظف A",
        "title": "Coordinator",
        "title_ar": "منسق",
        "department": "Finance",
    }


@pytest.mark.parametrize("actor", ["M", "D"])
def test_manager_always_sees_restricted_team_folder(grade_api: ApiHarness, actor: str) -> None:
    api = grade_api
    api.as_user("D")
    folder = _create_folder(api, "Chosen people", team=True)
    assert (
        _share(api, folder["id"], everyone=False, user_ids=[api.users["B"].id]).status_code == 200
    )
    api.as_user(actor)
    assert _folders(api)[0]["can_manage"] is True
    assert (
        api.client.patch(
            f"{API}/books/folders/{folder['id']}", json={"name": "Managed"}
        ).status_code
        == 200
    )
