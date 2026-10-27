"""Department inbox grants remain ordinary, recallable recipient access."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import (
    BookDepartmentSend,
    BookFolder,
    BookFolderShare,
    BookRecipient,
    DepartmentMember,
    Employee,
)
from app.services import department_service
from tests.conftest import make_user
from tests.department_fixtures import department, employee, grant, link
from tests.test_book_confidentiality import API, ApiHarness, _error
from tests.test_book_confidentiality import (
    confidentiality_api as confidentiality_api,
)


@pytest.fixture()
def department_api(confidentiality_api: ApiHarness):
    api = confidentiality_api
    api.users["E"] = make_user(api.db, role="operator", email="second-member@test.ae")
    for actor, user in api.users.items():
        supervisor = "SEND-B" if actor in {"C", "C2", "E", "M"} else None
        row = employee(api.db, f"SEND-{actor}", supervisor)
        link(api.db, user, row.id)
    root = department(api.db, "Operations", "SEND-B", name_ar="العمليات")
    child = department(api.db, "Field", "SEND-M", name_ar="الميدان")
    grant(api.db, root.id, api.users["C2"], "deputy")
    assert child.parent_id == root.id
    return api, root, child


def send_department(api, department, level="directed", **extra):
    response = api.client.post(
        f"{API}/books/{api.records[level].id}/send",
        json={
            "department_ids": [department.id],
            "purpose": "action",
            "note": "Please review",
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def sends(api, level="directed"):
    response = api.client.get(f"{API}/books/{api.records[level].id}")
    assert response.status_code == 200, response.text
    return response.json()["department_sends"]


def endpoint(api, send_id, suffix="", level="directed"):
    return f"{API}/books/{api.records[level].id}/department-sends/{send_id}{suffix}"


@pytest.mark.parametrize("scoped", [False, True])
@pytest.mark.parametrize("level", ["general", "directed"])
def test_heads_receive_members_do_not_until_distributed(department_api, scoped, level):
    api, root, _child = department_api
    department_service.set_scoping(api.db, scoped, actor="test")
    result = send_department(api, root, level)
    assert {row["user_id"] for row in result["sent"]} == {
        api.users[name].id for name in ("B", "C2")
    }
    send_id = sends(api, level)[0]["id"]
    assert all(row["department_send_id"] == send_id for row in result["sent"])
    for actor in ("B", "C2"):
        api.as_user(actor)
        detail = api.client.get(f"{API}/books/{api.records[level].id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["my_inbox"]["department_name_en"] == "Operations"
        assert detail.json()["my_inbox"]["department_name_ar"] == "العمليات"
        assert detail.json()["department_sends"][0]["can_distribute"] is True
    api.as_user("C")
    incoming = api.client.get(f"{API}/books", params={"inbox": "received"})
    assert incoming.status_code == 200, incoming.text
    assert incoming.json()["items"] == []
    assert (
        api.db.scalar(
            select(BookRecipient.id).where(
                BookRecipient.book_id == api.records[level].id,
                BookRecipient.user_id == api.users["C"].id,
            )
        )
        is None
    )
    if level == "directed" or scoped:
        _error(api.client.get(f"{API}/books/{api.records[level].id}"), 404, "BOOK_NOT_FOUND")
    else:
        assert (
            api.client.get(f"{API}/books/{api.records[level].id}").json()["department_sends"] == []
        )


@pytest.mark.parametrize("actor,mode", [("B", "all"), ("C2", "members")])
def test_head_and_deputy_distribute_with_progress_and_member_privacy(department_api, actor, mode):
    api, root, child = department_api
    send_department(api, root)
    send_id = sends(api)[0]["id"]
    api.as_user(actor)
    options = api.client.get(endpoint(api, send_id, "/distribution-options"))
    assert options.status_code == 200, options.text
    assert {row["user_id"] for row in options.json()["members"]} == {
        api.users[name].id for name in ("B", "C2", "C", "E") if name != actor
    }
    assert options.json()["subdepartments"] == [
        {"id": child.id, "name_en": "Field", "name_ar": "الميدان", "has_head": True}
    ]
    response = api.client.post(
        endpoint(api, send_id, "/distribute"),
        json={
            "mode": mode,
            "user_ids": [api.users["C"].id],
            "purpose": "reply",
            "note": "Reply please",
        },
    )
    assert response.status_code == 200, response.text
    assert {row["user_id"] for row in response.json()["sent"]} == {
        api.users[name].id for name in (("C", "E") if mode == "all" else ("C",))
    }
    assert all(row["sent_by_user_id"] == api.users[actor].id for row in response.json()["sent"])
    assert all(
        row["purpose"] == "reply" and row["note"] == "Reply please"
        for row in response.json()["sent"]
    )
    api.as_user("C")
    detail = api.client.get(f"{API}/books/{api.records['directed'].id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["my_inbox"]["department_send_id"] == send_id
    assert detail.json()["department_sends"] == []
    assert (
        api.client.post(f"{API}/books/{api.records['directed'].id}/inbox/done").status_code == 200
    )
    api.as_user("A")
    rollup = sends(api)[0]
    assert rollup["heads_total"] == 2
    assert rollup["members_reached"] == (2 if mode == "all" else 1)
    assert rollup["done_count"] == 1
    if mode == "members":
        api.as_user("E")
        _error(api.client.get(f"{API}/books/{api.records['directed'].id}"), 404, "BOOK_NOT_FOUND")


def test_head_keeping_a_delivery_is_recorded_for_the_sender_progress(department_api):
    api, root, _child = department_api
    send_department(api, root)
    send_id = sends(api)[0]["id"]
    assert sends(api)[0]["kept_at"] is None
    api.as_user("C")
    _error(
        api.client.post(endpoint(api, send_id, "/distribute"), json={"mode": "keep"}),
        404,
        "DEPARTMENT_SEND_NOT_FOUND",
    )
    api.as_user("B")
    kept = api.client.post(endpoint(api, send_id, "/distribute"), json={"mode": "keep"})
    assert kept.status_code == 200, kept.text
    assert kept.json()["sent"] == [] and kept.json()["skipped"] == []
    api.as_user("A")
    first = sends(api)[0]
    assert first["kept_at"] is not None
    assert first["kept_by_user_id"] == api.users["B"].id
    assert first["kept_by_name"] == "SEND-B"
    assert first["members_reached"] == 0
    api.as_user("C2")
    again = api.client.post(endpoint(api, send_id, "/distribute"), json={"mode": "keep"})
    assert again.status_code == 200, again.text
    api.as_user("A")
    assert sends(api)[0]["kept_at"] == first["kept_at"]
    assert sends(api)[0]["kept_by_user_id"] == api.users["B"].id


@pytest.mark.parametrize("actor", ["B", "C2"])
def test_distribution_options_include_derived_members_and_viewer_grants(department_api, actor):
    api, root, child = department_api
    viewer = make_user(api.db, role="operator", email="distribution-viewer@test.ae")
    viewer_employee = employee(api.db, "SEND-VIEWER")
    link(api.db, viewer, viewer_employee.id)
    grant(api.db, root.id, viewer, "viewer")
    send_department(api, root)
    send_id = sends(api)[0]["id"]
    api.as_user(actor)
    response = api.client.get(endpoint(api, send_id, "/distribution-options"))
    assert response.status_code == 200, response.text
    expected = {
        api.users["B"].id: "head",
        api.users["C2"].id: "deputy",
        api.users["C"].id: "member",
        api.users["E"].id: "member",
        viewer.id: "viewer",
    }
    expected.pop(api.users[actor].id)
    members = response.json()["members"]
    assert {row["user_id"]: row["role"] for row in members} == expected
    assert len(members) == len(expected)
    assert response.json()["subdepartments"] == [
        {"id": child.id, "name_en": "Field", "name_ar": "الميدان", "has_head": True}
    ]
    distributed = api.client.post(
        endpoint(api, send_id, "/distribute"),
        json={"mode": "members", "user_ids": [viewer.id]},
    )
    assert distributed.status_code == 200, distributed.text
    assert [row["user_id"] for row in distributed.json()["sent"]] == [viewer.id]


def test_subdepartment_chain_and_root_recall_cascade(department_api):
    api, root, child = department_api
    employee_row = api.db.get(Employee, "SEND-E")
    employee_row.supervisor_id = "SEND-M"
    grandchild = department(api.db, "Patrol", employee_row.id, name_ar="الدوريات")
    assert grandchild.parent_id == child.id
    send_department(api, root)
    root_send = sends(api)[0]["id"]
    api.as_user("B")
    member = api.client.post(
        endpoint(api, root_send, "/distribute"),
        json={"mode": "members", "user_ids": [api.users["C"].id]},
    )
    assert member.status_code == 200, member.text
    child_response = api.client.post(
        endpoint(api, root_send, "/distribute"),
        json={"mode": "subdepartment", "subdepartment_id": child.id},
    )
    assert child_response.status_code == 200, child_response.text
    child_send = child_response.json()["sent"][0]["department_send_id"]
    api.as_user("M")
    grand_response = api.client.post(
        endpoint(api, child_send, "/distribute"),
        json={"mode": "subdepartment", "subdepartment_id": grandchild.id},
    )
    assert grand_response.status_code == 200, grand_response.text
    grand_send = grand_response.json()["sent"][0]["department_send_id"]
    api.as_user("A")
    deliveries = sends(api)
    assert [row["parent_send_id"] for row in deliveries] == [None, root_send, child_send]
    assert api.client.delete(endpoint(api, root_send)).status_code == 204
    assert all(row["revoked_at"] is not None for row in sends(api))
    for actor in ("B", "C2", "C", "E"):
        api.as_user(actor)
        _error(api.client.get(f"{API}/books/{api.records['directed'].id}"), 404, "BOOK_NOT_FOUND")
        assert api.client.get(f"{API}/books", params={"inbox": "received"}).json()["items"] == []
    assert (
        api.db.scalar(
            select(BookRecipient.id).where(
                BookRecipient.department_send_id.in_([root_send, child_send, grand_send]),
                BookRecipient.revoked_at.is_(None),
            )
        )
        is None
    )
    api.as_user("B")
    _error(
        api.client.post(endpoint(api, root_send, "/distribute"), json={"mode": "all"}),
        409,
        "DEPARTMENT_SEND_REVOKED",
    )


def test_nonhead_hidden_nonmember_rejected_and_parent_heads_can_recall_child(department_api):
    api, root, child = department_api
    send_department(api, root)
    root_send = sends(api)[0]["id"]
    for actor in ("C", "M"):
        api.as_user(actor)
        _error(
            api.client.get(endpoint(api, root_send, "/distribution-options")),
            404,
            "DEPARTMENT_SEND_NOT_FOUND",
        )
        _error(
            api.client.post(endpoint(api, root_send, "/distribute"), json={"mode": "all"}),
            404,
            "DEPARTMENT_SEND_NOT_FOUND",
        )
    api.as_user("B")
    _error(
        api.client.post(
            endpoint(api, root_send, "/distribute"),
            json={"mode": "members", "user_ids": [api.users["A"].id]},
        ),
        422,
        "DISTRIBUTE_NOT_MEMBER",
    )
    _error(
        api.client.post(
            endpoint(api, root_send, "/distribute"),
            json={"mode": "subdepartment", "subdepartment_id": root.id},
        ),
        422,
        "DISTRIBUTE_NOT_SUBDEPARTMENT",
    )
    result = api.client.post(
        endpoint(api, root_send, "/distribute"),
        json={"mode": "subdepartment", "subdepartment_id": child.id},
    )
    assert result.status_code == 200, result.text
    child_send = result.json()["sent"][0]["department_send_id"]
    api.as_user("C2")
    assert api.client.delete(endpoint(api, child_send)).status_code == 204
    assert api.db.get(BookDepartmentSend, root_send).revoked_at is None
    assert api.db.get(BookDepartmentSend, child_send).revoked_at is not None


def test_personal_empty_targets_and_headless_department_are_refused_atomically(department_api):
    api, root, _child = department_api
    personal = api.client.post(
        f"{API}/books/{api.records['personal'].id}/send",
        json={"department_ids": [root.id], "purpose": "info", "make_directed": True},
    )
    _error(personal, 409, "PERSONAL_DEPARTMENT_SEND")
    assert api.records["personal"].confidentiality == "personal"
    _error(
        api.client.post(f"{API}/books/{api.records['directed'].id}/send", json={"purpose": "info"}),
        422,
        "VALIDATION_ERROR",
    )
    head = employee(api.db, "SEND-UNLINKED")
    empty = department(api.db, "No account", head.id, name_ar="بلا حساب")
    response = api.client.post(
        f"{API}/books/{api.records['directed'].id}/send",
        json={
            "department_ids": [root.id, empty.id],
            "user_ids": [api.users["E"].id],
            "purpose": "info",
        },
    )
    assert _error(response, 422, "DEPARTMENT_HAS_NO_HEAD")["details"]["department_ids"] == [
        empty.id
    ]
    assert list(api.db.scalars(select(BookDepartmentSend))) == []
    assert list(api.db.scalars(select(BookRecipient))) == []
    api.as_user("D")
    deputy = api.db.scalar(
        select(DepartmentMember).where(
            DepartmentMember.user_id == api.users["C2"].id,
            DepartmentMember.department_id == root.id,
        )
    )
    deputy.user_id = api.users["A"].id
    api.db.commit()
    _error(
        api.client.post(
            f"{API}/books/{api.records['secret'].id}/send",
            json={"department_ids": [root.id], "purpose": "info"},
        ),
        422,
        "DEPARTMENT_NO_CLEARED_HEAD",
    )


def test_secret_skips_uncleared_heads_and_members_and_duplicate_department(department_api):
    api, root, _child = department_api
    api.as_user("D")
    result = send_department(api, root, "secret")
    assert [row["user_id"] for row in result["sent"]] == [api.users["C2"].id]
    assert result["skipped"] == [
        {"user_id": api.users["B"].id, "department_id": root.id, "reason": "not_cleared"}
    ]
    send_id = sends(api, "secret")[0]["id"]
    repeated = send_department(api, root, "secret")
    assert repeated["sent"] == []
    assert repeated["skipped"] == [
        {"user_id": None, "department_id": root.id, "reason": "already_sent"}
    ]
    api.as_user("C2")
    response = api.client.post(
        endpoint(api, send_id, "/distribute", "secret"), json={"mode": "all"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["sent"] == []
    assert {
        row["user_id"] for row in response.json()["skipped"] if row["reason"] == "not_cleared"
    } == {api.users[name].id for name in ("B", "C", "E")}


def test_sender_who_receives_for_the_department_is_skipped_as_self(department_api):
    api, root, _child = department_api
    grant(api.db, root.id, api.users["A"], "deputy")
    result = send_department(api, root)
    assert {row["user_id"] for row in result["sent"]} == {
        api.users[name].id for name in ("B", "C2")
    }
    assert result["skipped"] == [
        {"user_id": api.users["A"].id, "department_id": root.id, "reason": "self"}
    ]


def test_existing_recipient_is_not_relinked_and_single_recall_remains_independent(department_api):
    api, root, _child = department_api
    response = api.client.post(
        f"{API}/books/{api.records['directed'].id}/send",
        json={"user_ids": [api.users["B"].id], "purpose": "info"},
    )
    assert response.status_code == 200, response.text
    original = response.json()["sent"][0]
    result = send_department(api, root)
    assert [row["user_id"] for row in result["sent"]] == [api.users["C2"].id]
    assert result["skipped"] == [
        {"user_id": api.users["B"].id, "department_id": root.id, "reason": "already_recipient"}
    ]
    send_id = sends(api)[0]["id"]
    api.as_user("B")
    distributed = api.client.post(
        endpoint(api, send_id, "/distribute"),
        json={"mode": "members", "user_ids": [api.users["C"].id]},
    )
    assert distributed.status_code == 200, distributed.text
    recipient_id = distributed.json()["sent"][0]["id"]
    assert (
        api.client.delete(
            f"{API}/books/{api.records['directed'].id}/recipients/{recipient_id}"
        ).status_code
        == 204
    )
    api.as_user("A")
    assert api.client.delete(endpoint(api, send_id)).status_code == 204
    assert api.db.get(BookRecipient, original["id"]).revoked_at is None
    assert api.db.get(BookRecipient, original["id"]).department_send_id is None


def test_department_cannot_be_deleted_while_any_record_is_stamped(department_api):
    api, _root, _child = department_api
    api.as_user("D")
    head = employee(api.db, "SEND-RETIRED")
    standalone = department(api.db, "Retired", head.id, name_ar="متقاعد")
    api.records["directed"].department_id = standalone.id
    api.db.commit()
    url = f"{API}/departments/{standalone.id}"
    _error(api.client.delete(url), 409, "DEPARTMENT_IN_USE")
    api.records["directed"].deleted_at = api.records["directed"].created_at
    api.db.commit()
    _error(api.client.delete(url), 409, "DEPARTMENT_IN_USE")
    response = api.client.patch(url, json={"active": False})
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("reference", ["send", "folder"])
def test_department_cannot_be_deleted_while_send_or_folder_references_it(department_api, reference):
    api, _root, _child = department_api
    api.as_user("D")
    head = employee(api.db, "SEND-REFERENCED")
    standalone = department(api.db, "Referenced", head.id, name_ar="مرجعي")
    if reference == "send":
        api.db.add(
            BookDepartmentSend(
                book_id=api.records["directed"].id,
                department_id=standalone.id,
                sent_by_user_id=api.users["A"].id,
                purpose="info",
            )
        )
    else:
        folder = BookFolder(name="Referenced folder", created_by_user_id=api.users["A"].id)
        api.db.add(folder)
        api.db.flush()
        api.db.add(BookFolderShare(folder_id=folder.id, department_id=standalone.id))
    api.db.commit()
    _error(api.client.delete(f"{API}/departments/{standalone.id}"), 409, "DEPARTMENT_IN_USE")


def test_sender_outgoing_includes_department_send_when_heads_already_have_other_grants(
    department_api,
):
    api, root, _child = department_api
    response = api.client.post(
        f"{API}/books/{api.records['directed'].id}/send",
        json={
            "user_ids": [api.users["B"].id, api.users["C2"].id],
            "purpose": "info",
        },
    )
    assert response.status_code == 200, response.text
    api.as_user("B")
    assert send_department(api, root)["sent"] == []
    outgoing = api.client.get(f"{API}/books", params={"inbox": "sent"})
    assert outgoing.status_code == 200, outgoing.text
    assert [row["id"] for row in outgoing.json()["items"]] == [api.records["directed"].id]
    assert len(outgoing.json()["items"][0]["department_sends"]) == 1
    assert api.client.get(f"{API}/books/inbox/summary").json()["sent"] == 1
    send_id = sends(api)[0]["id"]
    assert api.client.delete(endpoint(api, send_id)).status_code == 204
    assert api.client.get(f"{API}/books", params={"inbox": "sent"}).json()["items"] == []
    assert api.client.get(f"{API}/books/inbox/summary").json()["sent"] == 0
