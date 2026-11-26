"""Armory HTTP permissions and ledger wire contract."""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.permissions import SERVICE_CAPABILITY_IDS
from app.db.models import User, UserPermission
from app.db.session import get_db
from app.main import create_app
from tests.factories.armory import (
    EDIT_CAPS,
    NOW,
    account,
    client_for,
    employee,
    pin_clock,
    seed_catalogue,
)

ROOT = "/api/v1/armory"
VIEW = ("armory.view",)
PERSON = ("employees.view",)
CLEARANCE = ("documents.generate", "books.view", "books.service.Employee Clearance Form")
EXTRA_CAPS = {"V": (), "E": ("armory.edit",), "P": PERSON, "C": CLEARANCE}
SAFE_BODY = {"name_en": "Test Safe A", "name_ar": "خزنة تجريبية"}
SETTINGS_BODY = {"day_start": "07:00", "night_start": "19:00", "grace_minutes": 45}
QUALIFICATION_BODY = {
    "course_round": 1,
    "licence_number": "LIC-TEST-1",
    "licence_expires_on": "2026-12-31",
}
ASSIGNMENT_LINE = {"item_id": 1, "qty": 1}
RETURN_BODY = {
    "assignment_id": 1,
    "lines": [{"assignment_line_id": 1, "expected_remaining_qty": 1, "returned_qty": 1}],
}

# SPEC §5. Keep these requests schema-valid independently of the fixture DB's contents.
OPERATIONS = [
    ("GET", "/safes", "V", None),
    ("POST", "/safes", "E", SAFE_BODY),
    ("GET", "/site-options", "E", None),
    ("GET", "/settings", "E", None),
    ("PATCH", "/settings", "E", SETTINGS_BODY),
    ("GET", "/items", "V", None),
    (
        "POST",
        "/items",
        "E",
        {
            "name_en": "Test Cuffs",
            "name_ar": "قيد تجريبي",
            "kind": "quantity",
            "category": "restraints",
            "drawing": "cuffs",
        },
    ),
    ("GET", "/items/1", "V", None),
    ("POST", "/items/1/serials/record", "E", {"safe_id": 1, "serial_codes": ["TEST-0001"]}),
    ("GET", "/serials/1", "V", None),
    (
        "POST",
        "/serials/1/movements",
        "E",
        {
            "action": "send_repair",
            "expected_state": "in_safe",
            "expected_safe_id": 1,
            "expected_posting_id": 1,
            "reason": "Test repair",
            "witness_employee_id": "G9002",
        },
    ),
    ("GET", "/kits", "V", None),
    (
        "POST",
        "/stock/receipts",
        "E",
        {
            "safe_id": 1,
            "kind": "receipt",
            "received_on": "2026-11-26",
            "source": "supplier",
            "reference": "REF-TEST-1",
            "lines": [{"item_id": 1, "entry": {"type": "quantity", "qty": 1}}],
        },
    ),
    ("GET", "/shift", "V", None),
    ("GET", "/people?purpose=qualification", "E", None),
    ("GET", "/issues/1", "V", None),
    (
        "POST",
        "/issues",
        "E",
        {"safe_id": 1, "employee_id": "G9002", "kit_id": 1, "lines": [ASSIGNMENT_LINE]},
    ),
    ("POST", "/returns", "E", RETURN_BODY),
    ("POST", "/returns/bulk", "E", {"safe_id": 1, "records": [RETURN_BODY]}),
    ("GET", "/custody", "V", None),
    (
        "POST",
        "/custody",
        "E",
        {
            "safe_id": 1,
            "holder_kind": "person",
            "holder_employee_id": "G9002",
            "kit_id": 1,
            "lines": [ASSIGNMENT_LINE],
        },
    ),
    ("GET", "/custody/1", "V", None),
    ("GET", "/guards", "V", None),
    ("GET", "/guards/G9002", "V", None),
    ("PUT", "/guards/G9002", "E", QUALIFICATION_BODY),
    ("GET", "/safes/1/shift-checks/draft", "E", None),
    (
        "POST",
        "/safes/1/shift-checks",
        "E",
        {
            "snapshot_token": "test",
            "observed_serial_ids": [],
            "confirm_missing": True,
            "witness_employee_id": "G9002",
        },
    ),
    ("GET", "/safes/1/monthly-counts/draft", "E", None),
    (
        "POST",
        "/safes/1/monthly-counts",
        "E",
        {
            "snapshot_token": "test",
            "witness_employee_id": "G9002",
            "lines": [{"item_id": 1, "observed_qty": 0}],
        },
    ),
    ("GET", "/counts", "V", None),
    ("GET", "/counts/1", "V", None),
    ("GET", "/discrepancies", "V", None),
    (
        "POST",
        "/discrepancies/1/decision",
        "E",
        {"outcome": "recording_error", "note": "Test finding", "witness_employee_id": "G9002"},
    ),
    ("GET", "/movements", "V", None),
    ("GET", "/movements/1", "V", None),
    ("POST", "/movements/1/void", "E", {"reason": "Test correction"}),
    ("GET", "/find", "V", None),
    ("GET", "/summary", "V", None),
    ("GET", "/employees/G9002", "P", None),
    ("GET", "/employees/G9002/clearance", "C", None),
]


def _account_with_caps(db: Session, caps: tuple[str, ...], *, role: str = "operator") -> User:
    user = account(db, employee_id="G9001", grants=caps, role=role)
    if role != "admin":
        # api_db seeds operator defaults and dynamic book capabilities are auto-granted.
        # Deny inherited capabilities explicitly so each case has exactly its intended gates.
        db.add_all(
            UserPermission(user_id=user.id, capability=cap, effect="deny")
            for cap in (*EDIT_CAPS, *PERSON, *CLEARANCE)
            if cap not in caps
        )
        db.commit()
    return user


def _as_user(user: User) -> Callable[[], User]:
    return lambda: user


@pytest.mark.parametrize(
    ("method", "path", "gate", "body"),
    [pytest.param(*op, id=f"{op[0]} {op[1]}") for op in OPERATIONS],
)
def test_permission_matrix(
    api_db: Session,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
    gate: str,
    body: dict[str, Any] | None,
) -> None:
    pin_clock(monkeypatch)
    employee(api_db, "G9001")
    employee(api_db, "G9002")

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    client = TestClient(app)
    assert client.request(method, ROOT + path, json=body).status_code == 401

    no_grants = _account_with_caps(api_db, ())
    cases = [
        ("no grants", no_grants, False),
        ("view only", _account_with_caps(api_db, VIEW), gate == "V"),
        ("edit only", _account_with_caps(api_db, ("armory.edit",)), False),
        ("view and edit", _account_with_caps(api_db, EDIT_CAPS), gate in ("V", "E")),
    ]
    if gate in ("P", "C"):
        caps = EXTRA_CAPS[gate]
        cases.append((f"{gate} without view", _account_with_caps(api_db, caps), False))
        for missing in caps:
            incomplete = VIEW + tuple(cap for cap in caps if cap != missing)
            cases.append((f"missing {missing}", _account_with_caps(api_db, incomplete), False))
        cases.append((f"view and {gate}", _account_with_caps(api_db, VIEW + caps), True))
    cases.append(("admin", _account_with_caps(api_db, (), role="admin"), True))

    for label, user, passes in cases:
        app.dependency_overrides[get_current_user] = _as_user(user)
        response = client.request(method, ROOT + path, json=body)
        if passes:
            assert response.status_code not in (401, 403), (label, response.text)
            if response.status_code == 422:
                assert response.json()["error"]["code"] != "VALIDATION_ERROR", (
                    label,
                    response.text,
                )
        else:
            assert response.status_code == 403, (label, response.text)


def test_clearance_gate_is_a_recognized_service_capability() -> None:
    assert CLEARANCE[-1] in SERVICE_CAPABILITY_IDS


@pytest.fixture
def editor(api_db: Session, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    pin_clock(monkeypatch)
    actor = employee(api_db, "G9001")
    return client_for(api_db, account(api_db, employee_id=actor.id))


def test_settings_etag_and_if_match(editor: TestClient) -> None:
    path = ROOT + "/settings"
    initial = editor.get(path)
    assert initial.status_code == 200, initial.text
    assert initial.headers["ETag"] == '"0"'
    assert initial.json() == {
        "version": 0,
        "current": {
            "day_start": "06:00",
            "night_start": "18:00",
            "grace_minutes": 30,
            "effective_on": None,
        },
        "pending": None,
    }

    missing = editor.patch(path, json=SETTINGS_BODY)
    assert missing.status_code == 412, missing.text
    assert missing.json()["error"]["code"] == "armory_version_mismatch"
    assert missing.json()["error"]["details"] == {"version": 0}
    assert editor.get(path).json() == initial.json()

    saved = editor.patch(path, json=SETTINGS_BODY, headers={"If-Match": initial.headers["ETag"]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] > 0
    assert saved.headers["ETag"] == f'"{saved.json()["version"]}"'
    assert saved.json()["current"] == initial.json()["current"]
    assert saved.json()["pending"] == {**SETTINGS_BODY, "effective_on": "2026-11-27"}

    stale = editor.patch(path, json=SETTINGS_BODY, headers={"If-Match": '"0"'})
    assert stale.status_code == 412, stale.text
    assert stale.json()["error"]["details"] == {"version": saved.json()["version"]}
    reread = editor.get(path)
    assert reread.headers["ETag"] == saved.headers["ETag"]
    assert reread.json() == saved.json()


def test_guard_requires_if_match_zero_before_first_save(
    editor: TestClient, api_db: Session
) -> None:
    employee(api_db, "G9002")
    path = ROOT + "/guards/G%39%30%30%32"
    initial = editor.get(path)
    assert initial.status_code == 200, initial.text
    assert initial.headers["ETag"] == '"0"'
    assert initial.json()["person"]["employee_id"] == "G9002"
    assert initial.json()["qualification"] == {
        "version": 0,
        "course_round": None,
        "licence_number": None,
        "licence_expires_on": None,
        "licence_status": "missing",
        "licence_days_left": None,
        "updated_at": None,
    }

    missing = editor.put(path, json=QUALIFICATION_BODY)
    assert missing.status_code == 412, missing.text
    assert missing.json()["error"]["code"] == "armory_version_mismatch"

    saved = editor.put(path, json=QUALIFICATION_BODY, headers={"If-Match": '"0"'})
    assert saved.status_code == 200, saved.text
    assert saved.headers["ETag"] == '"1"'
    qualification = saved.json()["qualification"]
    assert qualification["version"] == 1
    assert {key: qualification[key] for key in QUALIFICATION_BODY} == QUALIFICATION_BODY

    stale = editor.put(path, json=QUALIFICATION_BODY, headers={"If-Match": '"0"'})
    assert stale.status_code == 412, stale.text
    assert stale.json()["error"]["details"] == {"version": 1}
    reread = editor.get(path)
    assert reread.headers["ETag"] == saved.headers["ETag"]
    assert reread.json() == saved.json()


_POSTING_KEYS = {
    "id",
    "record_ref",
    "kind",
    "safe_id",
    "occurred_on",
    "occurred_at",
    "voided_at",
    "safe",
    "destination_safe",
    "related_posting_id",
    "created_at",
    "actor",
    "witness",
    "person",
    "reference",
    "source",
    "reason",
    "note",
    "serial_action",
    "decision_outcome",
    "voided_by",
    "void_reason",
    "void_witness",
    "lines",
    "discrepancy_ids",
}
_MOVEMENT_LINE_KEYS = {
    "id",
    "item",
    "qty",
    "serial_id",
    "serial_code",
    "batch",
    "stock_delta",
    "before_on_hand",
    "after_on_hand",
    "before_state",
    "after_state",
    "before_safe_id",
    "after_safe_id",
    "assignment_line_id",
    "remaining_before",
    "remaining_after",
    "condition",
    "fault_note",
}
_ASSIGNMENT_KEYS = {
    "id",
    "record_ref",
    "kind",
    "state",
    "safe",
    "holder",
    "issuer",
    "issued_at",
    "due_at",
    "overdue_minutes",
    "licence_warning_acknowledged",
    "changed_kit",
    "lines",
    "kit_id",
    "course_round_snapshot",
    "licence_status_at_issue",
    "shift_window",
    "grace_minutes",
    "off_duty_reason",
    "off_duty_note",
    "excess_rounds_reason",
    "condition_note",
    "ended_at",
    "ended_by",
    "return_ids",
    "voided_at",
    "voided_by",
    "void_reason",
    "receipt",
}
_ASSIGNMENT_LINE_KEYS = {"id", "item", "qty", "remaining_qty", "serial_id", "serial_code", "batch"}


def test_equipment_receipt_issue_return_and_movement_wire_contract(
    editor: TestClient, api_db: Session
) -> None:
    catalogue = seed_catalogue(api_db)
    employee(api_db, "G9002")
    item_id = catalogue.item("cuffs")
    today = NOW.date().isoformat()

    created = editor.post(ROOT + "/safes", json=SAFE_BODY)
    assert created.status_code == 201, created.text
    safe = created.json()
    assert safe["vehicle_site"] is None
    assert safe["duty_post"] is None

    received = editor.post(
        ROOT + "/stock/receipts",
        json={
            "safe_id": safe["id"],
            "kind": "receipt",
            "received_on": today,
            "source": "supplier",
            "reference": "REF-TEST-1",
            "lines": [{"item_id": item_id, "entry": {"type": "quantity", "qty": 3}}],
        },
    )
    assert received.status_code == 201, received.text
    receipt = received.json()
    assert receipt.keys() == _POSTING_KEYS
    assert receipt["safe"] == safe
    assert receipt["occurred_at"] is None
    assert receipt["related_posting_id"] is None
    assert receipt["witness"] is None
    assert receipt["lines"][0].keys() == _MOVEMENT_LINE_KEYS
    assert receipt["lines"][0]["stock_delta"] == 3
    assert receipt["lines"][0]["serial_id"] is None

    created_issue = editor.post(
        ROOT + "/issues",
        json={
            "safe_id": safe["id"],
            "employee_id": "G9002",
            "kit_id": catalogue.kit("equipment"),
            "lines": [{"item_id": item_id, "qty": 2}],
            "off_duty_reason": "cover",
        },
    )
    assert created_issue.status_code == 201, created_issue.text
    issue = created_issue.json()
    assert issue.keys() == _ASSIGNMENT_KEYS
    assert issue["state"] == "active"
    assert issue["holder"]["employee"]["employee_id"] == "G9002"
    assert issue["receipt"] is None
    assert issue["ended_at"] is None
    assert issue["ended_by"] is None
    assert issue["return_ids"] == []
    assert issue["voided_by"] is None
    assert issue["lines"][0].keys() == _ASSIGNMENT_LINE_KEYS
    assert issue["lines"][0]["remaining_qty"] == 2
    assert issue["lines"][0]["batch"] is None

    recorded_return = editor.post(
        ROOT + "/returns",
        json={
            "assignment_id": issue["id"],
            "lines": [
                {
                    "assignment_line_id": issue["lines"][0]["id"],
                    "expected_remaining_qty": 2,
                    "returned_qty": 2,
                }
            ],
        },
    )
    assert recorded_return.status_code == 201, recorded_return.text
    returned = recorded_return.json()
    posting = returned["posting"]
    assert posting.keys() == _POSTING_KEYS
    assert posting["related_posting_id"] == issue["id"]
    assert posting["lines"][0].keys() == _MOVEMENT_LINE_KEYS
    assert posting["lines"][0]["stock_delta"] == 2
    assert posting["lines"][0]["remaining_before"] == 2
    assert posting["lines"][0]["remaining_after"] == 0
    assert returned["assignment"]["state"] == "ended"
    assert returned["assignment"]["lines"][0]["remaining_qty"] == 0

    movement = editor.get(ROOT + f"/movements/{posting['id']}")
    assert movement.status_code == 200, movement.text
    assert movement.json() == posting
    closed_issue = editor.get(ROOT + f"/issues/{issue['id']}")
    assert closed_issue.status_code == 200, closed_issue.text
    assert closed_issue.json().keys() == _ASSIGNMENT_KEYS
    assert closed_issue.json()["return_ids"] == [posting["id"]]

    ledger = editor.get(
        ROOT + "/movements", params={"from": today, "to": today, "safe_id": safe["id"]}
    )
    assert ledger.status_code == 200, ledger.text
    page = ledger.json()
    assert page.keys() == {"items", "page", "page_size", "total"}
    assert (page["page"], page["page_size"], page["total"]) == (1, 50, 3)
    assert {row["id"] for row in page["items"]} == {receipt["id"], issue["id"], posting["id"]}
    earlier = editor.get(ROOT + "/movements", params={"to": "2026-11-25"})
    assert earlier.status_code == 200, earlier.text
    assert earlier.json()["items"] == []


def test_domain_error_envelopes(editor: TestClient) -> None:
    invalid = editor.patch(
        ROOT + "/settings",
        json={**SETTINGS_BODY, "night_start": "06:00"},
        headers={"If-Match": '"0"'},
    )
    assert invalid.status_code == 422, invalid.text
    error = invalid.json()["error"]
    assert error["code"] == "armory_invalid_input"
    assert error["details"] == {"field": "night_start"}
    assert editor.get(ROOT + "/settings").headers["ETag"] == '"0"'

    unknown = editor.get(ROOT + "/movements/1")
    assert unknown.status_code == 404, unknown.text
    error = unknown.json()["error"]
    assert error["code"] == "armory_not_found"
    assert error["details"] == {"resource": "movement"}


def test_structural_query_and_path_validation(editor: TestClient) -> None:
    for path, field in (
        ("/items/0", "item_id"),
        ("/items?safe_id=0", "safe_id"),
        ("/items?category=unknown", "category"),
        ("/items?stock_view=unknown", "stock_view"),
        (f"/find?q={'x' * 121}", "q"),
        (f"/movements?serial={'x' * 81}", "serial"),
        ("/movements?from=not-a-date", "from"),
        ("/movements?to=not-a-date", "to"),
        ("/movements?kind=unknown", "kind"),
        ("/people", "purpose"),
        ("/people?purpose=unknown", "purpose"),
        ("/people?purpose=qualification&limit=0", "limit"),
        ("/people?purpose=qualification&limit=51", "limit"),
        ("/counts?month=2026-13", "month"),
        ("/counts?kind=return", "kind"),
        ("/custody?state=voided", "state"),
        ("/custody?page=0", "page"),
        ("/guards?licence_status=unknown", "licence_status"),
        ("/guards?page_size=0", "page_size"),
        ("/guards?page_size=101", "page_size"),
        ("/discrepancies?status=voided", "status"),
        ("/discrepancies?discrepancy_id=0", "discrepancy_id"),
        ("/find?recent_safe_id=0", "recent_safe_id"),
    ):
        response = editor.get(ROOT + path)
        assert response.status_code == 422, (path, response.text)
        error = response.json()["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert error["details"]["errors"][0]["loc"][-1] == field

    trimmed = editor.get(ROOT + "/find", params={"q": " " * 121 + "test" + " " * 121})
    assert trimmed.status_code == 200, trimmed.text


def test_invalid_movement_range_and_missing_picker_safe(editor: TestClient) -> None:
    for path, params in (
        ("/movements", {"from": "2026-11-27", "to": "2026-11-26"}),
        ("/people", {"purpose": "issue"}),
        ("/people", {"purpose": "witness"}),
    ):
        response = editor.get(ROOT + path, params=params)
        assert response.status_code == 422, (path, response.text)
        assert response.json()["error"]["code"] == "armory_invalid_input"
