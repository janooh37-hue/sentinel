"""Books desk acceptance: filing, visibility, row designations, search, and sorting."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import BookApprovalStep, BookVersion, Employee, Manager
from tests.test_book_grade import API, ApiHarness, _error, _send
from tests.test_book_grade import (
    grade_api as grade_api,
)


def _rows(api: ApiHarness, **params: str | int) -> list[dict]:
    response = api.client.get(f"{API}/books", params=params)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def _folders(api: ApiHarness, **params: int) -> list[dict]:
    response = api.client.get(f"{API}/books/folders", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _create_folder(api: ApiHarness, name: str, *, team: bool = False) -> dict:
    response = api.client.post(f"{API}/books/folders", json={"name": name, "team": team})
    assert response.status_code == 201, response.text
    return response.json()


def test_desk_rows_carry_visible_recipients_and_signer(grade_api: ApiHarness) -> None:
    api = grade_api
    manager = Manager(name_en="Juma Saadi", name_ar="جمعة الساعدي")
    api.db.add(manager)
    api.db.flush()
    api.records["named"].doc_manager_id = manager.id
    api.db.commit()
    _send(api, "named", ["B", "C"], purpose="action", note="Stock count")
    api.as_user("B")
    assert api.client.post(f"{API}/books/{api.records['named'].id}/inbox/done").status_code == 200

    # A recipient who is not the creator sees only their own row, never C's.
    (row,) = _rows(api, inbox="done")
    assert [r["user_id"] for r in row["recipients"]] == [api.users["B"].id]
    assert (row["signer_name"], row["signer_name_ar"]) == ("Juma Saadi", "جمعة الساعدي")

    api.as_user("A")
    (sent,) = _rows(api, inbox="sent")
    progress = {r["user_id"]: r["done_at"] is not None for r in sent["recipients"]}
    assert progress == {api.users["B"].id: True, api.users["C"].id: False}
    # Plain record lists stay lean.
    assert all(item["recipients"] is None for item in _rows(api))


def test_desk_search_matches_note_purpose_and_sender_across_scopes(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    api.users["A"].display_name = "Saeed Sender"
    api.db.commit()
    _send(api, "named", ["B"], purpose="action", note="Stock count")
    _send(api, "general", ["B"], purpose="info")
    api.as_user("B")
    assert api.client.post(f"{API}/books/{api.records['general'].id}/inbox/done").status_code == 200
    named, general = api.records["named"].id, api.records["general"].id

    def found(q: str, inbox: str) -> set[int]:
        return {item["id"] for item in _rows(api, inbox=inbox, q=q)}

    assert found("stock", "received") == {named}
    assert found("للتنفيذ", "received") == {named}
    assert found("للاطلاع", "received") == set()  # the info book is in Done
    assert found("للاطلاع", "any") == {general}
    assert found("saeed", "any") == {named, general}
    assert found("no such words", "any") == set()


def test_desk_sort_by_send_time_and_grade(grade_api: ApiHarness) -> None:
    api = grade_api
    # Created general → secret; sent secret first, then general (by cleared D).
    api.as_user("D")
    _send(api, "secret", ["C2"])
    _send(api, "general", ["C2"])
    api.as_user("C2")
    secret, general = api.records["secret"].id, api.records["general"].id

    def order(sort: str) -> list[int]:
        return [item["id"] for item in _rows(api, inbox="received", sort=sort)]

    assert order("-date") == [general, secret]
    assert order("date") == [secret, general]
    assert order("-grade") == [secret, general]


@pytest.mark.parametrize("other", ["B", "M", "D"])
def test_creator_only_folder_is_hidden_from_every_other_user(
    grade_api: ApiHarness, other: str
) -> None:
    api = grade_api
    folder = _create_folder(api, "A's private folder")
    assert folder == {
        "id": folder["id"],
        "name": "A's private folder",
        "team": False,
        "count": 0,
        "can_manage": True,
        "has_book": None,
        "created_by_name": api.users["A"].display_name or api.users["A"].email,
        "created_by_name_ar": None,
        "everyone": False,
        "shared_users": [],
        "shared_departments": [],
    }
    api.as_user(other)
    own = _create_folder(api, "My private folder")
    assert [row["id"] for row in _folders(api)] == [own["id"]]
    folder_path = f"{API}/books/folders/{folder['id']}"
    for response in (
        api.client.get(f"{API}/books", params={"folder_id": folder["id"]}),
        api.client.patch(folder_path, json={"name": "Not yours"}),
        api.client.delete(folder_path),
    ):
        _error(response, 404, "FOLDER_NOT_FOUND")
    # An unusable creator_only folder stays hidden even when the book is hidden too.
    for level in ("general", "secret"):
        filing_path = f"{API}/books/{api.records[level].id}/folders/{folder['id']}"
        for response in (api.client.put(filing_path), api.client.delete(filing_path)):
            _error(response, 404, "FOLDER_NOT_FOUND")
    api.as_user("A")
    assert _folders(api) == [folder]


def test_creator_only_filing_is_idempotent_and_does_not_change_book_state(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    _send(api, "named", ["B"], purpose="action", note="Still awaiting action")
    api.as_user("B")
    folder = _create_folder(api, "Pending review")
    folder_id, book_id = folder["id"], api.records["named"].id
    path = f"{API}/books/{book_id}/folders/{folder_id}"
    (before,) = _rows(api, inbox="received")
    assert before["my_inbox"]["read_at"] is None
    assert before["my_inbox"]["done_at"] is None
    assert before["my_inbox"]["archived_at"] is None
    assert _rows(api, folder_id=folder_id) == []
    assert _folders(api, book_id=book_id)[0]["has_book"] is False

    for _ in range(2):
        response = api.client.put(path)
        assert response.status_code == 204, response.text
        (filed,) = _rows(api, folder_id=folder_id)
        assert filed["id"] == book_id
        assert filed["recipients"][0]["user_id"] == api.users["B"].id
        assert _folders(api, book_id=book_id) == [{**folder, "count": 1, "has_book": True}]
        assert _rows(api, inbox="received") == [before]

    for _ in range(2):
        response = api.client.delete(path)
        assert response.status_code == 204, response.text
        assert _rows(api, folder_id=folder_id) == []
        assert _folders(api, book_id=book_id) == [{**folder, "has_book": False}]
        assert _rows(api, inbox="received") == [before]

    renamed = api.client.patch(f"{API}/books/folders/{folder_id}", json={"name": "Reviewed later"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json() == {**folder, "name": "Reviewed later"}
    assert api.client.put(path).status_code == 204
    deleted = api.client.delete(f"{API}/books/folders/{folder_id}")
    assert deleted.status_code == 204, deleted.text
    assert _folders(api) == []
    _error(
        api.client.get(f"{API}/books", params={"folder_id": folder_id}),
        404,
        "FOLDER_NOT_FOUND",
    )
    detail = api.client.get(f"{API}/books/{book_id}", params={"mark_read": False})
    assert detail.status_code == 200, detail.text
    assert detail.json()["my_inbox"] == before["my_inbox"]
    assert _rows(api, inbox="received") == [before]


@pytest.mark.parametrize("manager", ["M", "D"])
def test_team_folders_are_managed_by_managers_but_operators_can_file(
    grade_api: ApiHarness, manager: str
) -> None:
    api = grade_api
    denied = api.client.post(f"{API}/books/folders", json={"name": "Not authorized", "team": True})
    assert denied.status_code == 403, denied.text
    assert _folders(api) == []
    api.as_user(manager)
    folder = _create_folder(api, "Team review", team=True)
    assert folder["team"] is True
    assert folder["can_manage"] is True
    api.as_user("B")
    assert _folders(api) == [{**folder, "can_manage": False}]
    folder_path = f"{API}/books/folders/{folder['id']}"
    for response in (
        api.client.patch(folder_path, json={"name": "Unauthorized rename"}),
        api.client.delete(folder_path),
    ):
        assert response.status_code == 403, response.text
    book_id = api.records["general"].id
    response = api.client.put(f"{API}/books/{book_id}/folders/{folder['id']}")
    assert response.status_code == 204, response.text
    assert [row["id"] for row in _rows(api, folder_id=folder["id"])] == [book_id]
    assert _folders(api, book_id=book_id) == [
        {**folder, "count": 1, "can_manage": False, "has_book": True}
    ]
    api.as_user(manager)
    renamed = api.client.patch(folder_path, json={"name": "Shared review"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json() == {**folder, "name": "Shared review", "count": 1}
    deleted = api.client.delete(folder_path)
    assert deleted.status_code == 204, deleted.text
    api.as_user("B")
    assert _folders(api) == []
    assert api.client.get(f"{API}/books/{book_id}").status_code == 200


def test_team_folder_counts_and_rows_respect_secret_clearance(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    api.as_user("D")
    folder = _create_folder(api, "Shared confidential work", team=True)
    for level in ("general", "secret"):
        response = api.client.put(f"{API}/books/{api.records[level].id}/folders/{folder['id']}")
        assert response.status_code == 204, response.text
    for actor, levels in (("B", ["general"]), ("C2", ["general", "secret"])):
        api.as_user(actor)
        assert _folders(api) == [{**folder, "count": len(levels), "can_manage": False}]
        listing = api.client.get(f"{API}/books", params={"folder_id": folder["id"]})
        assert listing.status_code == 200, listing.text
        assert listing.json()["total"] == len(levels)
        assert {row["id"] for row in listing.json()["items"]} == {
            api.records[level].id for level in levels
        }


@pytest.mark.parametrize(
    ("actor", "level"), [("B", "named"), ("B", "creator_only"), ("B", "secret"), ("M", "secret")]
)
def test_filing_and_unfiling_require_full_book_access(
    grade_api: ApiHarness, actor: str, level: str
) -> None:
    api = grade_api
    record = api.records[level]
    if actor == "M":
        version = api.db.scalar(select(BookVersion).where(BookVersion.book_id == record.id))
        assert version is not None
        api.db.add(
            BookApprovalStep(
                book_id=record.id,
                version_id=version.id,
                step_order=0,
                stage_label="Approve",
                assignee_user_id=api.users["M"].id,
                state="pending",
                kind="approver",
            )
        )
        api.db.commit()
    api.as_user("D")
    folder = _create_folder(api, "Full access only", team=True)
    path = f"{API}/books/{record.id}/folders/{folder['id']}"
    assert api.client.put(path).status_code == 204
    api.as_user(actor)
    if actor == "M":
        detail = api.client.get(f"{API}/books/{record.id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["access_scope"] == "assigned_revision"
    for response in (api.client.put(path), api.client.delete(path)):
        _error(response, 404, "BOOK_NOT_FOUND")
    assert _rows(api, folder_id=folder["id"]) == []
    assert _folders(api)[0]["count"] == 0
    api.as_user("D")
    assert _folders(api, book_id=record.id)[0]["has_book"] is True
    assert [row["id"] for row in _rows(api, folder_id=folder["id"])] == [record.id]


@pytest.mark.parametrize("field", ["ref", "subject"])
def test_desk_sorts_text_columns_in_both_directions(grade_api: ApiHarness, field: str) -> None:
    api = grade_api
    for level, value in (
        ("general", "Zulu"),
        ("named", "Alpha"),
        ("creator_only", "Mike"),
        ("secret", "Bravo"),
    ):
        setattr(api.records[level], "ref_number" if field == "ref" else "subject", value)
    api.db.commit()
    api.as_user("D")
    expected = [api.records[level].id for level in ("named", "secret", "creator_only", "general")]
    assert [row["id"] for row in _rows(api, sort=field)] == expected
    assert [row["id"] for row in _rows(api, sort=f"-{field}")] == expected[::-1]


def test_desk_status_sort_places_unread_before_read(grade_api: ApiHarness) -> None:
    api = grade_api
    api.as_user("D")
    _send(api, "general", ["C2"])
    _send(api, "secret", ["C2"])
    api.as_user("C2")
    opened = api.client.get(f"{API}/books/{api.records['secret'].id}")
    assert opened.status_code == 200, opened.text
    expected = [api.records["general"].id, api.records["secret"].id]
    assert [row["id"] for row in _rows(api, inbox="received", sort="status")] == expected
    assert [row["id"] for row in _rows(api, inbox="received", sort="-status")] == expected[::-1]


def test_desk_purpose_sort_uses_action_reply_info_circulate(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    api.as_user("D")
    for level, purpose in (
        ("secret", "info"),
        ("general", "circulate"),
        ("creator_only", "action"),
        ("named", "reply"),
    ):
        _send(api, level, ["C2"], purpose=purpose)
    api.as_user("C2")
    expected = [api.records[level].id for level in ("creator_only", "named", "secret", "general")]
    assert [row["id"] for row in _rows(api, inbox="received", sort="purpose")] == expected
    assert [row["id"] for row in _rows(api, inbox="received", sort="-purpose")] == expected[::-1]


def test_desk_grade_sort_uses_access_order(grade_api: ApiHarness) -> None:
    api = grade_api
    api.as_user("D")
    expected = [api.records[level].id for level in ("general", "creator_only", "named", "secret")]
    rows = _rows(api, sort="grade")
    assert [row["grade"] for row in rows] == ["unclassified"] * 3 + ["secret"]
    assert {row["id"] for row in rows} == set(expected)
    assert [row["grade"] for row in _rows(api, sort="-grade")] == ["secret"] + ["unclassified"] * 3


@pytest.mark.parametrize(
    "sort", ["bogus", "newest", "oldest", "secret", "urgent", "--date", "+ref", "Date", "-"]
)
def test_desk_rejects_invalid_sort(grade_api: ApiHarness, sort: str) -> None:
    response = grade_api.client.get(f"{API}/books", params={"sort": sort})
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("named_manager", [False, True])
def test_desk_designations_come_from_linked_employee_positions(
    grade_api: ApiHarness, named_manager: bool
) -> None:
    api = grade_api
    for name, title, title_ar in (
        ("A", "Operations coordinator", "منسق العمليات"),
        ("B", "Storekeeper", "أمين المخزن"),
        ("C", "Accounts officer", "موظف الحسابات"),
        ("M", "Area manager", "مدير المنطقة"),
    ):
        employee = Employee(
            id=f"G-DESK-{name}",
            name_en=f"Employee {name}",
            name_ar=f"الموظف {name}",
            position=title,
            position_ar=title_ar,
        )
        api.db.add(employee)
        api.db.flush()
        api.users[name].employee_id = employee.id
    record = api.records["named"]
    version = api.db.scalar(select(BookVersion).where(BookVersion.book_id == record.id))
    assert version is not None
    version.signed_by_user_id = api.users["M"].id
    if named_manager:
        manager = Manager(
            name_en="Juma Saadi",
            name_ar="جمعة الساعدي",
            title="General Manager / المدير العام",
            user_id=api.users["M"].id,
        )
        api.db.add(manager)
        api.db.flush()
        record.doc_manager_id = manager.id
    api.db.commit()
    _send(api, "named", ["B", "C"], purpose="action")
    api.as_user("B")
    (received,) = _rows(api, inbox="received")
    assert (received["created_by_title"], received["created_by_title_ar"]) == (
        "Operations coordinator",
        "منسق العمليات",
    )
    assert (
        received["my_inbox"]["sent_by_title"],
        received["my_inbox"]["sent_by_title_ar"],
    ) == ("Operations coordinator", "منسق العمليات")
    expected_signer = (
        ("General Manager / المدير العام", "General Manager / المدير العام")
        if named_manager
        else ("Area manager", "مدير المنطقة")
    )
    assert (received["signer_title"], received["signer_title_ar"]) == expected_signer
    assert [(row["user_title"], row["user_title_ar"]) for row in received["recipients"]] == [
        ("Storekeeper", "أمين المخزن")
    ]
    api.as_user("A")
    (sent,) = _rows(api, inbox="sent")
    assert {
        row["user_id"]: (row["user_title"], row["user_title_ar"]) for row in sent["recipients"]
    } == {
        api.users["B"].id: ("Storekeeper", "أمين المخزن"),
        api.users["C"].id: ("Accounts officer", "موظف الحسابات"),
    }
    assert (sent["created_by_title"], sent["created_by_title_ar"]) == (
        "Operations coordinator",
        "منسق العمليات",
    )
    assert (sent["signer_title"], sent["signer_title_ar"]) == expected_signer
