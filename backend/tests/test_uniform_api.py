"""Uniform HTTP permissions, concurrency preconditions and ledger behaviour."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Employee, UniformIssue, UniformItem, UniformReturn, User, UserPermission
from app.db.session import get_db
from app.main import create_app
from app.services import uniform_service

ROOT = "/api/v1/uniform"
TODAY = date(2026, 11, 4)


def client_for(db, role="operator", grants=(), *, employee_id=None, display_name=None):
    user = User(
        email=f"{role}-{len(db.query(User).all())}@test.ae",
        password_hash="x",
        role=role,
        status="active",
        employee_id=employee_id,
        display_name=display_name,
    )
    db.add(user)
    db.commit()
    db.add_all(UserPermission(user_id=user.id, capability=cap, effect="grant") for cap in grants)
    db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def editor(api_db: Session, monkeypatch):
    monkeypatch.setattr(uniform_service, "organization_today", lambda: TODAY)
    api_db.add(Employee(id="G1", name_en="Ali", name_ar="علي"))
    api_db.commit()
    return client_for(api_db, grants=("uniform.view", "uniform.edit"))


def item_body(name="Polo", drawing="polo"):
    return {
        "name_en": name,
        "name_ar": name,
        "group_key": "guard",
        "drawing": drawing,
        "sizes": ["M", "L"],
    }


def create_item(client, name="Polo", drawing="polo"):
    response = client.post(ROOT + "/items", json=item_body(name, drawing))
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize(
    "role,grants,read,write",
    [
        ("operator", (), 403, 403),
        ("operator", ("uniform.view",), 200, 403),
        ("operator", ("uniform.edit",), 403, 201),
        ("manager", (), 200, 403),
        ("admin", (), 200, 201),
    ],
)
def test_permission_matrix(api_db, role, grants, read, write):
    client = client_for(api_db, role, grants)
    for path in (
        "/items",
        "/receipts",
        "/issues",
        "/returns",
        "/adjustments",
        "/recipients",
        "/summary",
    ):
        assert client.get(ROOT + path).status_code == read
    assert client.post(ROOT + "/items", json=item_body()).status_code == write


def test_item_preconditions_and_drawing_lifecycle(editor):
    first = create_item(editor)
    second = create_item(editor, "Boots", "boots")
    duplicate = editor.post(ROOT + "/items", json=item_body("Other"))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "uniform_drawing_in_use"
    path = ROOT + f"/items/{second['id']}"
    conflict = editor.patch(path, json={"drawing": "polo"}, headers={"If-Match": second["version"]})
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "uniform_drawing_in_use"
    missing = editor.patch(path, json={"name_en": "Changed"})
    assert missing.status_code == 412
    updated = editor.patch(
        path,
        json={"drawing": "boots", "name_en": "Changed"},
        headers={"If-Match": second["version"]},
    )
    assert updated.status_code == 200, updated.text
    stale = editor.patch(path, json={"name_en": "Lost"}, headers={"If-Match": second["version"]})
    assert stale.status_code == 412
    assert editor.post(ROOT + f"/items/{first['id']}/archive").status_code == 200
    replacement = create_item(editor, "Replacement")
    assert replacement["drawing"] == "polo"
    assert len(editor.get(ROOT + "/items").json()) == 2
    assert len(editor.get(ROOT + "/items?include_archived=true").json()) == 3


def test_archived_size_labels_remain_available_to_history_and_void_is_rejected(editor):
    item = create_item(editor)
    size = item["sizes"][0]["id"]
    receipt = editor.post(
        ROOT + "/receipts", json={"received_on": str(TODAY), "lines": [{"size_id": size, "qty": 1}]}
    )
    assert receipt.status_code == 201
    adjusted = editor.post(
        ROOT + "/adjustments",
        json={
            "reason": "Count correction",
            "lines": [{"size_id": size, "delta": -1, "expected_on_hand": 1}],
        },
    )
    assert adjusted.status_code == 201
    assert editor.delete(ROOT + f"/sizes/{size}").status_code == 204
    current = editor.get(ROOT + "/items").json()[0]
    assert size not in {row["id"] for row in current["sizes"]}
    history = editor.get(ROOT + "/items?include_archived=true").json()[0]
    archived_size = next(row for row in history["sizes"] if row["id"] == size)
    assert archived_size["label"] == "M"
    assert archived_size["archived_at"] is not None
    void_path = ROOT + f"/adjustments/{adjusted.json()[0]['id']}/void"
    refused = editor.post(void_path, json={"reason": "Mistake"})
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "uniform_size_archived"
    assert editor.get(ROOT + "/summary").json()["shelf_total"] == 0
    assert editor.post(ROOT + f"/items/{item['id']}/archive").status_code == 200
    assert editor.get(ROOT + "/items").json() == []
    history = editor.get(ROOT + "/items?include_archived=true").json()[0]
    assert history["archived_at"] is not None
    assert next(row for row in history["sizes"] if row["id"] == size)["label"] == "M"
    refused = editor.post(void_path, json={"reason": "Mistake"})
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "uniform_item_archived"


def test_receipt_issue_return_void_and_recipient_projections(editor):
    item = create_item(editor)
    size = item["sizes"][0]["id"]
    receipt = editor.post(
        ROOT + "/receipts", json={"received_on": str(TODAY), "lines": [{"size_id": size, "qty": 5}]}
    )
    assert receipt.status_code == 201, receipt.text
    issue = editor.post(
        ROOT + "/issues",
        json={"employee_id": "G1", "lines": [{"item_id": item["id"], "size_id": size, "qty": 3}]},
    )
    assert issue.status_code == 201, issue.text
    returned = editor.post(
        ROOT + "/returns",
        json={
            "employee_id": "G1",
            "lines": [{"item_id": item["id"], "size_id": size, "qty": 1, "condition": "damaged"}],
        },
    )
    assert returned.status_code == 201, returned.text
    stock = editor.get(ROOT + "/items").json()[0]["sizes"][0]
    assert (stock["on_hand"], stock["held_qty"]) == (2, 2)
    person = editor.get(ROOT + "/employees/G1").json()
    assert person["holdings"][0]["qty"] == 2
    assert len(person["issues"]) == len(person["returns"]) == 1
    recipient = editor.get(ROOT + "/recipients?q=ali").json()[0]
    assert (recipient["held_total"], recipient["issued_total"], recipient["last_issued_on"]) == (
        2,
        3,
        str(TODAY),
    )
    assert editor.get(ROOT + "/recipients?q=missing").json() == []
    dependent = editor.post(
        ROOT + f"/issues/{issue.json()['id']}/void", json={"reason": "Correction"}
    )
    assert dependent.status_code == 409
    assert (
        editor.post(
            ROOT + f"/returns/{returned.json()['id']}/void", json={"reason": "Correction"}
        ).status_code
        == 200
    )
    assert (
        editor.post(
            ROOT + f"/issues/{issue.json()['id']}/void", json={"reason": "Correction"}
        ).status_code
        == 200
    )
    assert editor.get(ROOT + "/recipients").json() == []
    assert editor.get(ROOT + "/summary").json()["shelf_total"] == 5
    assert (
        editor.post(
            ROOT + f"/receipts/{receipt.json()['id']}/void", json={"reason": "Correction"}
        ).status_code
        == 200
    )
    assert editor.get(ROOT + "/summary").json()["shelf_total"] == 0


def test_adjustment_shortage_atomicity_sizes_and_delete(editor):
    item = create_item(editor)
    a, b = [size["id"] for size in item["sizes"]]
    adjustment = editor.post(
        ROOT + "/adjustments",
        json={"reason": "Count", "lines": [{"size_id": a, "delta": 4, "expected_on_hand": 0}]},
    )
    assert adjustment.status_code == 201, adjustment.text
    shortage = editor.post(
        ROOT + "/issues",
        json={
            "employee_id": "G1",
            "lines": [
                {"item_id": item["id"], "size_id": a, "qty": 2},
                {"item_id": item["id"], "size_id": b, "qty": 1},
            ],
        },
    )
    assert shortage.status_code == 409
    assert editor.get(ROOT + "/issues").json() == []
    assert editor.get(ROOT + "/summary").json()["shelf_total"] == 4
    assert editor.post(ROOT + f"/items/{item['id']}/archive").status_code == 409
    assert editor.delete(ROOT + f"/items/{item['id']}").status_code == 409
    low = editor.patch(ROOT + f"/sizes/{a}", json={"min_qty": 4})
    assert low.status_code == 200 and low.json()["is_low"]
    cleared = editor.patch(ROOT + f"/sizes/{a}", json={"min_qty": None})
    assert cleared.status_code == 200 and not cleared.json()["is_low"]
    assert (
        editor.post(
            ROOT + f"/adjustments/{adjustment.json()[0]['id']}/void", json={"reason": "Correction"}
        ).status_code
        == 200
    )
    assert editor.delete(ROOT + f"/sizes/{a}").status_code == 204
    assert editor.delete(ROOT + f"/sizes/{b}").status_code == 204
    disposable = create_item(editor, "Cap", "cap")
    assert editor.delete(ROOT + f"/items/{disposable['id']}").status_code == 204


def test_reusable_return_bounds_and_void_restore_holdings(editor):
    item = create_item(editor)
    size = item["sizes"][0]["id"]
    editor.post(
        ROOT + "/receipts", json={"received_on": str(TODAY), "lines": [{"size_id": size, "qty": 2}]}
    )
    editor.post(
        ROOT + "/issues",
        json={"employee_id": "G1", "lines": [{"item_id": item["id"], "size_id": size, "qty": 2}]},
    )
    body = {
        "employee_id": "G1",
        "lines": [{"item_id": item["id"], "size_id": size, "qty": 3, "condition": "reusable"}],
    }
    refused = editor.post(ROOT + "/returns", json=body)
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "uniform_over_return"
    assert editor.get(ROOT + "/returns").json() == []
    body["lines"][0]["qty"] = 2
    returned = editor.post(ROOT + "/returns", json=body)
    assert returned.status_code == 201, returned.text
    assert editor.get(ROOT + "/employees/G1").json()["holdings"] == []
    assert editor.get(ROOT + "/summary").json()["shelf_total"] == 2
    path = ROOT + f"/returns/{returned.json()['id']}/void"
    assert editor.post(path, json={"reason": "Mistake"}).status_code == 200
    assert editor.get(ROOT + "/employees/G1").json()["holdings"][0]["qty"] == 2
    assert editor.get(ROOT + "/summary").json()["shelf_total"] == 0
    assert editor.post(path, json={"reason": "Again"}).status_code == 409


def test_viewer_cannot_mutate_existing_stock(editor, api_db):
    item = create_item(editor)
    size = item["sizes"][0]["id"]
    viewer = client_for(api_db, grants=("uniform.view",))
    response = viewer.patch(
        ROOT + f"/items/{item['id']}",
        json={"name_en": "Forbidden"},
        headers={"If-Match": item["version"]},
    )
    assert response.status_code == 403
    receipt = viewer.post(
        ROOT + "/receipts", json={"received_on": str(TODAY), "lines": [{"size_id": size, "qty": 7}]}
    )
    assert receipt.status_code == 403
    assert viewer.delete(ROOT + f"/items/{item['id']}").status_code == 403
    current = editor.get(ROOT + "/items").json()[0]
    assert current["name_en"] == "Polo"
    assert current["sizes"][0]["on_hand"] == 0


def test_actor_names_follow_signed_in_giver_and_receiver_on_every_response(editor, api_db):
    api_db.add_all(
        [
            Employee(id="G2", name_en="Uniform Giver", name_ar="مسؤول التسليم"),
            Employee(id="G3", name_en="Uniform Receiver", name_ar="مسؤول الاستلام"),
        ]
    )
    api_db.commit()
    giver = client_for(
        api_db,
        grants=("uniform.view", "uniform.edit"),
        employee_id="G2",
        display_name="Not the linked giver",
    )
    receiver = client_for(
        api_db,
        grants=("uniform.view", "uniform.edit"),
        employee_id="G3",
        display_name="Not the linked receiver",
    )
    item = create_item(editor)
    size = item["sizes"][0]["id"]
    receipt = editor.post(
        ROOT + "/receipts", json={"received_on": str(TODAY), "lines": [{"size_id": size, "qty": 3}]}
    )
    assert receipt.status_code == 201, receipt.text
    issue = giver.post(
        ROOT + "/issues",
        json={"employee_id": "G1", "lines": [{"item_id": item["id"], "size_id": size, "qty": 3}]},
    )
    assert issue.status_code == 201, issue.text
    returned = receiver.post(
        ROOT + "/returns",
        json={
            "employee_id": "G1",
            "lines": [{"item_id": item["id"], "size_id": size, "qty": 1, "condition": "damaged"}],
        },
    )
    assert returned.status_code == 201, returned.text
    giver_id = api_db.query(User).filter_by(employee_id="G2").one().id
    receiver_id = api_db.query(User).filter_by(employee_id="G3").one().id

    def assert_actor_rows(issues, returns):
        assert len(issues) == len(returns) == 1
        assert issues[0]["employee_id"] == returns[0]["employee_id"] == "G1"
        assert issues[0]["created_by_id"] == giver_id
        assert returns[0]["created_by_id"] == receiver_id
        assert (issues[0]["given_by_name_en"], issues[0]["given_by_name_ar"]) == (
            "Uniform Giver",
            "مسؤول التسليم",
        )
        assert (returns[0]["received_by_name_en"], returns[0]["received_by_name_ar"]) == (
            "Uniform Receiver",
            "مسؤول الاستلام",
        )

    def assert_read_responses():
        for query in ("", "?employee_id=G1"):
            issues = editor.get(ROOT + "/issues" + query)
            returns = editor.get(ROOT + "/returns" + query)
            assert issues.status_code == returns.status_code == 200
            assert "@" not in issues.text + returns.text
            assert_actor_rows(issues.json(), returns.json())
        detail = editor.get(ROOT + "/employees/G1")
        assert detail.status_code == 200, detail.text
        assert "@" not in detail.text
        assert_actor_rows(detail.json()["issues"], detail.json()["returns"])

    assert_actor_rows([issue.json()], [returned.json()])
    assert_read_responses()
    # Voiding as a third user must preserve the original giver and receiver.
    void_return = editor.post(
        ROOT + f"/returns/{returned.json()['id']}/void", json={"reason": "Correction"}
    )
    assert void_return.status_code == 200, void_return.text
    void_issue = editor.post(
        ROOT + f"/issues/{issue.json()['id']}/void", json={"reason": "Correction"}
    )
    assert void_issue.status_code == 200, void_issue.text
    assert_actor_rows([void_issue.json()], [void_return.json()])
    assert void_issue.json()["voided_by_id"] not in (giver_id, receiver_id)
    assert void_return.json()["voided_by_id"] == void_issue.json()["voided_by_id"]
    assert_read_responses()


@pytest.mark.parametrize(
    "actor_state,expected_en",
    [("unlinked", None), ("missing", None), ("display_name", "Uniform Desk")],
)
def test_actor_names_nullable_without_email_fallback(editor, api_db, actor_state, expected_en):
    if actor_state == "display_name":
        actor = api_db.query(User).one()
        actor.display_name = expected_en
        api_db.commit()
    item = create_item(editor)
    size = item["sizes"][0]["id"]
    receipt = editor.post(
        ROOT + "/receipts", json={"received_on": str(TODAY), "lines": [{"size_id": size, "qty": 2}]}
    )
    assert receipt.status_code == 201, receipt.text
    issue = editor.post(
        ROOT + "/issues",
        json={"employee_id": "G1", "lines": [{"item_id": item["id"], "size_id": size, "qty": 2}]},
    )
    assert issue.status_code == 201, issue.text
    returned = editor.post(
        ROOT + "/returns",
        json={
            "employee_id": "G1",
            "lines": [{"item_id": item["id"], "size_id": size, "qty": 1, "condition": "damaged"}],
        },
    )
    assert returned.status_code == 201, returned.text
    for response, prefix in ((issue, "given_by"), (returned, "received_by")):
        assert response.json()[prefix + "_name_en"] == expected_en
        assert response.json()[prefix + "_name_ar"] is None
        assert "@" not in response.text
    if actor_state == "missing":
        api_db.get(UniformIssue, issue.json()["id"]).created_by_id = None
        api_db.get(UniformReturn, returned.json()["id"]).created_by_id = None
        api_db.commit()
    for path, key, prefix in (
        ("/issues", None, "given_by"),
        ("/returns", None, "received_by"),
        ("/employees/G1", "issues", "given_by"),
        ("/employees/G1", "returns", "received_by"),
    ):
        response = editor.get(ROOT + path)
        assert response.status_code == 200, response.text
        assert "@" not in response.text
        rows = response.json()[key] if key else response.json()
        assert rows[0][prefix + "_name_en"] == expected_en
        assert rows[0][prefix + "_name_ar"] is None
        if actor_state == "missing":
            assert rows[0]["created_by_id"] is None


@pytest.mark.parametrize("expected", [None, -1, True, 1.5, "0"])
def test_adjustments_require_nonnegative_integer_expected_count(editor, expected):
    size = create_item(editor)["sizes"][0]["id"]
    line = {"size_id": size, "delta": 1}
    if expected is not None:
        line["expected_on_hand"] = expected
    response = editor.post(ROOT + "/adjustments", json={"reason": "Count", "lines": [line]})
    assert response.status_code == 422
    assert editor.get(ROOT + "/adjustments").json() == []


def test_stale_adjustments_reject_entire_request_after_stock_changes(editor):
    item = create_item(editor)
    a, b = [size["id"] for size in item["sizes"]]
    receipt = editor.post(
        ROOT + "/receipts", json={"received_on": str(TODAY), "lines": [{"size_id": b, "qty": 3}]}
    )
    assert receipt.status_code == 201, receipt.text
    response = editor.post(
        ROOT + "/adjustments",
        json={
            "reason": "Count",
            "lines": [
                {"size_id": a, "delta": 2, "expected_on_hand": 0},
                {"size_id": b, "delta": 1, "expected_on_hand": 0},
            ],
        },
    )
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "uniform_stale_count"
    assert editor.get(ROOT + "/adjustments").json() == []
    assert [size["on_hand"] for size in editor.get(ROOT + "/items").json()[0]["sizes"]] == [0, 3]


def test_adjustments_preserve_repeated_size_lines_and_guard_cumulative_stock(editor):
    size = create_item(editor)["sizes"][0]["id"]
    response = editor.post(
        ROOT + "/adjustments",
        json={
            "reason": "Count",
            "lines": [
                {"size_id": size, "delta": 3, "expected_on_hand": 0},
                {"size_id": size, "delta": -1, "expected_on_hand": 0},
            ],
        },
    )
    assert response.status_code == 201, response.text
    assert [row["delta"] for row in response.json()] == [3, -1]
    assert len({row["id"] for row in response.json()}) == 2
    shortage = editor.post(
        ROOT + "/adjustments",
        json={
            "reason": "Count",
            "lines": [
                {"size_id": size, "delta": -2, "expected_on_hand": 2},
                {"size_id": size, "delta": -1, "expected_on_hand": 2},
            ],
        },
    )
    assert shortage.status_code == 409
    assert shortage.json()["error"]["code"] == "uniform_insufficient_stock"
    assert len(editor.get(ROOT + "/adjustments").json()) == 2
    assert editor.get(ROOT + "/items").json()[0]["sizes"][0]["on_hand"] == 2


def test_one_size_rule_applies_to_create_add_and_rename(editor):
    body = item_body()
    body["sizes"] = [" ONE ", "M"]
    invalid = editor.post(ROOT + "/items", json=body)
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "uniform_sizes_fixed"
    item = create_item(editor)
    a, b = [size["id"] for size in item["sizes"]]
    invalid = editor.patch(ROOT + f"/sizes/{a}", json={"label": " ONE "})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "uniform_sizes_fixed"
    assert editor.delete(ROOT + f"/sizes/{b}").status_code == 204
    renamed = editor.patch(ROOT + f"/sizes/{a}", json={"label": "one"})
    assert renamed.status_code == 200, renamed.text
    invalid = editor.post(ROOT + f"/items/{item['id']}/sizes", json={"label": "L"})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "uniform_sizes_fixed"
    invalid = editor.patch(ROOT + f"/sizes/{a}", json={"label": "M"})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "uniform_sizes_fixed"
    valid = editor.patch(ROOT + f"/sizes/{a}", json={"min_qty": 2, "sort_order": 1})
    assert valid.status_code == 200, valid.text


def test_summary_counts_only_holder_tracking_even_when_drawings_change(editor, api_db):
    holder = UniformItem(
        name_en="Tailored",
        name_ar="بدلة",
        group_key="formal",
        drawing="cap",
        tracking="holder",
        default_qty=2,
    )
    api_db.add_all([holder, Employee(id="G2", name_en="Second", name_ar="ثان")])
    api_db.commit()
    shelf = create_item(editor, "Shelf suit", "suit")
    size = shelf["sizes"][0]["id"]
    response = editor.post(
        ROOT + "/receipts", json={"received_on": str(TODAY), "lines": [{"size_id": size, "qty": 4}]}
    )
    assert response.status_code == 201, response.text
    response = editor.post(
        ROOT + "/issues",
        json={"employee_id": "G2", "lines": [{"item_id": shelf["id"], "size_id": size, "qty": 3}]},
    )
    assert response.status_code == 201, response.text
    summary = editor.get(ROOT + "/summary").json()
    assert (summary["holder_count"], summary["suits_issued"]) == (0, 0)
    response = editor.post(
        ROOT + "/issues",
        json={"employee_id": "G1", "lines": [{"item_id": holder.id, "qty": 2}]},
    )
    assert response.status_code == 201, response.text
    summary = editor.get(ROOT + "/summary").json()
    assert (summary["shelf_total"], summary["holder_count"], summary["suits_issued"]) == (1, 1, 2)
    catalog = editor.get(ROOT + "/items").json()
    holder_read = next(item for item in catalog if item["id"] == holder.id)
    assert holder_read["holders"] == [
        {"employee_id": "G1", "name_en": "Ali", "name_ar": "علي", "qty": 2}
    ]
