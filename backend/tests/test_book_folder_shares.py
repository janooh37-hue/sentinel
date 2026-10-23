"""Team folder sharing is separate from each book's access and filing provenance."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import func, select

from app.db.models import (
    BookFolderItem,
    BookFolderShare,
    Department,
    DepartmentMember,
    Employee,
    UserPermission,
)
from app.services import department_service
from tests.conftest import make_user
from tests.test_book_confidentiality import API, ApiHarness, _error
from tests.test_book_confidentiality import confidentiality_api as confidentiality_api
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


def _department(
    api: ApiHarness, name: str = "Finance", *, active: bool = True, parent_id: int | None = None
) -> Department:
    department = Department(name_en=name, name_ar=f"قسم {name}", active=active, parent_id=parent_id)
    api.db.add(department)
    api.db.commit()
    return department


def _membership(
    api: ApiHarness,
    actor: str,
    department: Department,
    *,
    primary: bool = True,
    role: str = "member",
) -> None:
    api.db.add(
        DepartmentMember(
            user_id=api.users[actor].id,
            department_id=department.id,
            role=role,
            is_primary=primary,
        )
    )
    api.db.commit()


def _share(api: ApiHarness, folder_id: int, **body: object):
    return api.client.put(f"{API}/books/folders/{folder_id}/shares", json=body)


def test_restricted_team_visibility_filing_and_everyone(confidentiality_api: ApiHarness) -> None:
    api = confidentiality_api
    _employee(api, "M", "Management")
    _employee(api, "B", "Stores")
    _employee(api, "C", "Different legacy text")
    finance = _department(api)
    _membership(api, "C", finance)
    api.as_user("M")
    folder = _create_folder(api, "Restricted team", team=True)
    assert folder["everyone"] is True
    assert folder["created_by_name"] == "Employee M"
    assert folder["created_by_name_ar"] == "الموظف M"
    result = _share(
        api,
        folder["id"],
        everyone=False,
        user_ids=[api.users["B"].id] * 2,
        department_ids=[finance.id, finance.id],
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
    assert restricted["shared_departments"] == [
        {"id": finance.id, "name_en": "Finance", "name_ar": "قسم Finance"}
    ]
    assert restricted["legacy_departments"] == []
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
    assert result.json()["legacy_departments"] == []
    api.as_user("A")
    assert [f["id"] for f in _folders(api)] == [folder_id]
    assert api.client.put(filing_path).status_code == 204
    assert _rows(api, folder_id=folder_id)[0]["id"] == book_id


def test_share_validation_and_atomic_replacement(confidentiality_api: ApiHarness) -> None:
    api = confidentiality_api
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
    finance = _department(api)
    disabled_department = _department(api, "Disabled", active=False)
    _error(_share(api, folder_id, everyone=False), 422, "FOLDER_SHARES_EMPTY")
    for user_id in (999999, inactive.id, reporter.id):
        _error(
            _share(api, folder_id, everyone=False, user_ids=[user_id]),
            422,
            "FOLDER_SHARE_USER_INVALID",
        )
    for department_id in (999999, disabled_department.id):
        _error(
            _share(api, folder_id, everyone=False, department_ids=[department_id]),
            422,
            "DEPARTMENT_NOT_FOUND",
        )
    _error(
        _share(api, folder_id, everyone=False, legacy_departments=["Finance"]),
        422,
        "FOLDER_SHARE_LEGACY_INVALID",
    )
    team_folder = next(row for row in _folders(api) if row["id"] == folder_id)
    assert team_folder["shared_users"][0]["id"] == api.users["B"].id
    api.as_user("B")
    _error(_share(api, folder_id, everyone=True), 403, "FORBIDDEN")
    _error(api.client.get(f"{API}/books/folders/share-options"), 403, "FORBIDDEN")
    api.as_user("M")
    changed = _share(api, folder_id, everyone=False, department_ids=[finance.id])
    assert changed.status_code == 200, changed.text
    assert changed.json()["shared_users"] == []
    assert changed.json()["shared_departments"] == [
        {"id": finance.id, "name_en": "Finance", "name_ar": "قسم Finance"}
    ]
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


def test_share_options_shape_and_active_directory(confidentiality_api: ApiHarness) -> None:
    api = confidentiality_api
    _employee(api, "A", " Finance ")
    _employee(api, "B", "Finance")
    _employee(api, "C", "   ")
    finance = _department(api)
    unused = _department(api, "Unused")
    vacant = _department(api, "Vacant")
    _department(api, "Disabled", active=False)
    _membership(api, "A", finance)
    _membership(api, "A", unused, primary=False)
    _membership(api, "B", unused)
    _membership(api, "C2", finance)
    inactive = make_user(api.db, email="inactive-options@test.ae")
    inactive.status = "disabled"
    reporter = make_user(api.db, role="inmate_reporter", email="reporter-options@test.ae")
    api.db.commit()
    api.as_user("D")
    response = api.client.get(f"{API}/books/folders/share-options")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["departments"] == [
        {"id": finance.id, "name_en": "Finance", "name_ar": "قسم Finance"},
        {"id": unused.id, "name_en": "Unused", "name_ar": "قسم Unused"},
        {"id": vacant.id, "name_en": "Vacant", "name_ar": "قسم Vacant"},
    ]
    assert {u["id"] for u in body["users"]} == {u.id for u in api.users.values()}
    assert inactive.id not in {u["id"] for u in body["users"]}
    assert reporter.id not in {u["id"] for u in body["users"]}
    assert [u["name"].casefold() for u in body["users"]] == sorted(
        u["name"].casefold() for u in body["users"]
    )
    assert (
        next(u for u in body["users"] if u["id"] == api.users["B"].id)["department_id"] == unused.id
    )
    assert next(u for u in body["users"] if u["id"] == api.users["C"].id)["department_id"] is None
    assert (
        next(u for u in body["users"] if u["id"] == api.users["C2"].id)["department_id"]
        == finance.id
    )
    option = next(u for u in body["users"] if u["id"] == api.users["A"].id)
    assert option == {
        "id": api.users["A"].id,
        "name": "Employee A",
        "name_ar": "الموظف A",
        "title": "Coordinator",
        "title_ar": "منسق",
        "department_id": finance.id,
    }


@pytest.mark.parametrize("actor", ["M", "D"])
def test_manager_always_sees_restricted_team_folder(
    confidentiality_api: ApiHarness, actor: str
) -> None:
    api = confidentiality_api
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


@pytest.mark.parametrize("scoping", [False, True])
@pytest.mark.parametrize("organization", [False, True])
def test_department_shares_use_membership_not_employee_text_or_scope(
    confidentiality_api: ApiHarness, scoping: bool, organization: bool
) -> None:
    api = confidentiality_api
    finance = _department(api)
    parent = _department(api, "Parent")
    finance.parent_id = parent.id
    api.db.commit()
    _employee(api, "B", "Not Finance")
    _employee(api, "C", " Finance ")
    _membership(api, "B", parent)
    _membership(api, "B", finance, primary=False)
    _membership(api, "C2", parent, role="head")
    if organization:
        api.db.add(
            UserPermission(user_id=api.users["C"].id, capability="departments.all", effect="grant")
        )
        api.db.commit()
    department_service.set_scoping(api.db, scoping, actor=api.users["D"].email)
    api.as_user("D")
    folder_id = _create_folder(api, "Membership only", team=True)["id"]
    response = _share(api, folder_id, everyone=False, department_ids=[finance.id])
    assert response.status_code == 200, response.text
    api.as_user("B")
    assert [f["id"] for f in _folders(api)] == [folder_id]
    for actor in ("A", "C", "C2"):
        api.as_user(actor)
        assert _folders(api) == []
        _error(
            api.client.get(f"{API}/books", params={"folder_id": folder_id}),
            404,
            "FOLDER_NOT_FOUND",
        )


@pytest.mark.parametrize("scoping", [False, True])
def test_legacy_shares_can_only_be_retained_or_removed_without_widening(
    confidentiality_api: ApiHarness,
    scoping: bool,
) -> None:
    api = confidentiality_api
    _employee(api, "B", "  old FINANCE ")
    _employee(api, "C", "Old Stores")
    finance = _department(api)
    _membership(api, "A", finance)
    department_service.set_scoping(api.db, scoping, actor=api.users["D"].email)
    api.as_user("D")
    folder_id = _create_folder(api, "Legacy audience", team=True)["id"]
    api.db.add_all(
        BookFolderShare(folder_id=folder_id, department=text)
        for text in ("Old Finance", "Old Stores")
    )
    api.db.commit()
    folder = _folders(api)[0]
    assert folder["everyone"] is False
    assert folder["shared_departments"] == []
    assert folder["legacy_departments"] == ["Old Finance", "Old Stores"]
    for actor in ("B", "C"):
        api.as_user(actor)
        assert [f["id"] for f in _folders(api)] == [folder_id]
    api.as_user("A")
    assert _folders(api) == []
    api.as_user("D")
    retained = _share(
        api, folder_id, everyone=False, legacy_departments=["Old Finance", "Old Finance"]
    )
    assert retained.status_code == 200, retained.text
    assert retained.json()["legacy_departments"] == ["Old Finance"]
    assert retained.json()["everyone"] is False
    for invalid in ("New audience", "old finance", "Old Stores"):
        _error(
            _share(api, folder_id, everyone=False, legacy_departments=[invalid]),
            422,
            "FOLDER_SHARE_LEGACY_INVALID",
        )
    _error(_share(api, folder_id, everyone=False), 422, "FOLDER_SHARES_EMPTY")
    assert _folders(api)[0]["legacy_departments"] == ["Old Finance"]
    api.as_user("B")
    assert [f["id"] for f in _folders(api)] == [folder_id]
    api.as_user("C")
    assert _folders(api) == []
    api.as_user("D")
    replaced = _share(api, folder_id, everyone=False, department_ids=[finance.id])
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["legacy_departments"] == []
    assert replaced.json()["everyone"] is False
    api.as_user("B")
    assert _folders(api) == []
    api.as_user("A")
    assert [f["id"] for f in _folders(api)] == [folder_id]
    api.as_user("D")
    _error(
        _share(api, folder_id, everyone=False, legacy_departments=["Old Finance"]),
        422,
        "FOLDER_SHARE_LEGACY_INVALID",
    )
