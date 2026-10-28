"""Every folder lives in one desk box; a book is filed only into folders of a box it is in."""

from __future__ import annotations

import pytest

from tests.test_book_grade import API, ApiHarness, _error, _send
from tests.test_book_grade import grade_api as grade_api
from tests.test_books_desk_list import _create_folder, _folders, _rows

BOXES = ("incoming", "outgoing", "done", "archived")


def _file(api: ApiHarness, level: str, folder_id: int):
    return api.client.put(f"{API}/books/{api.records[level].id}/folders/{folder_id}")


def _boxed_folders(api: ApiHarness, *, team: bool = False) -> dict[str, int]:
    return {box: _create_folder(api, f"{box} folder", box=box, team=team)["id"] for box in BOXES}


def _assert_only_into(api: ApiHarness, level: str, folders: dict[str, int], allowed: set[str]):
    for box, folder_id in folders.items():
        response = _file(api, level, folder_id)
        if box in allowed:
            assert response.status_code == 204, (box, response.text)
            assert [row["id"] for row in _rows(api, folder_id=folder_id)] == [api.records[level].id]
        else:
            error = _error(response, 409, "FOLDER_BOX_MISMATCH")
            assert error["details"] == {"box": box}
            assert _rows(api, folder_id=folder_id) == []


@pytest.mark.parametrize("box", BOXES)
def test_folder_is_created_in_each_box_and_reads_it_back(grade_api: ApiHarness, box: str) -> None:
    api = grade_api
    folder = _create_folder(api, "Boxed", box=box)
    assert folder["box"] == box
    assert [(row["id"], row["box"]) for row in _folders(api)] == [(folder["id"], box)]


@pytest.mark.parametrize("body", [{"name": "No box"}, {"name": "Bad box", "box": "inbox"}])
def test_folder_without_a_known_box_is_rejected(grade_api: ApiHarness, body: dict) -> None:
    api = grade_api
    response = api.client.post(f"{API}/books/folders", json=body)
    assert response.status_code == 422, response.text
    assert _folders(api) == []


def test_incoming_book_files_only_into_incoming_folders(grade_api: ApiHarness) -> None:
    api = grade_api
    _send(api, "named", ["B"])
    api.as_user("B")
    _assert_only_into(api, "named", _boxed_folders(api), {"incoming"})


@pytest.mark.parametrize(("action", "box"), [("done", "done"), ("archive", "archived")])
def test_done_and_archived_books_file_only_into_their_box(
    grade_api: ApiHarness, action: str, box: str
) -> None:
    api = grade_api
    _send(api, "named", ["B"])
    api.as_user("B")
    moved = api.client.post(f"{API}/books/{api.records['named'].id}/inbox/{action}")
    assert moved.status_code == 200, moved.text
    _assert_only_into(api, "named", _boxed_folders(api), {box})


def test_sent_book_files_into_outgoing_and_received_and_sent_into_both(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    _send(api, "named", ["B"])
    _assert_only_into(api, "named", _boxed_folders(api), {"outgoing"})
    api.as_user("B")
    _send(api, "named", ["C"])
    _assert_only_into(api, "named", _boxed_folders(api), {"incoming", "outgoing"})


def test_book_in_no_box_cannot_be_filed(grade_api: ApiHarness) -> None:
    api = grade_api
    _assert_only_into(api, "general", _boxed_folders(api), set())


def test_moving_a_folder_keeps_its_filed_books(grade_api: ApiHarness) -> None:
    api = grade_api
    _send(api, "named", ["B"])
    api.as_user("B")
    folder = _create_folder(api, "Follow up", box="incoming")
    assert _file(api, "named", folder["id"]).status_code == 204
    path = f"{API}/books/folders/{folder['id']}"

    moved = api.client.patch(path, json={"box": "archived"})
    assert moved.status_code == 200, moved.text
    assert moved.json() == {**folder, "box": "archived", "count": 1}
    assert [row["id"] for row in _rows(api, folder_id=folder["id"])] == [api.records["named"].id]
    # The book left the box the folder is now in: filing it again is refused.
    _error(_file(api, "named", folder["id"]), 409, "FOLDER_BOX_MISMATCH")

    renamed = api.client.patch(path, json={"name": "Closed"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["box"] == "archived"
    assert api.client.patch(path, json={"box": "inbox"}).status_code == 422
    assert api.client.patch(path, json={}).status_code == 422


def test_shared_folders_follow_the_box_rule_and_keep_their_visibility(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    _send(api, "named", ["B"])
    api.as_user("M")
    folders = _boxed_folders(api, team=True)
    restricted = api.client.put(
        f"{API}/books/folders/{folders['incoming']}/shares",
        json={"everyone": False, "user_ids": [api.users["B"].id]},
    )
    assert restricted.status_code == 200, restricted.text
    assert restricted.json()["box"] == "incoming"

    api.as_user("B")
    assert {row["id"] for row in _folders(api)} == set(folders.values())
    _assert_only_into(api, "named", folders, {"incoming"})
    api.as_user("C")
    assert {row["id"] for row in _folders(api)} == set(folders.values()) - {folders["incoming"]}
    _error(_file(api, "named", folders["incoming"]), 404, "FOLDER_NOT_FOUND")
