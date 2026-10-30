"""In & out feed ordering/search and dashboard month-strip metadata."""

from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import StoreCategory, StoreDelivery, StoreDisposal, StoreHandover, User
from app.services import book_service
from tests.test_store_api import (
    TODAY,
    _client_for,
    _count,
    _deliver,
    _dispose,
    _item,
    _make_user,
)
from tests.test_store_api import _fixed_today as _fixed_today
from tests.test_store_api import category as category
from tests.test_store_api import editor as editor
from tests.test_store_handovers import _handover


@pytest.fixture()
def movements(
    editor: TestClient, category: StoreCategory, api_db: Session
) -> list[tuple[str, int]]:
    item = _item(editor, category, "Coffee", name_ar="قهوة")["id"]
    received = _deliver(editor, TODAY - timedelta(days=2), (item, "2027-02-01", 10)).json()
    # Both movements have today's business date: timestamp, not record kind, breaks the tie.
    handed = _handover(editor, TODAY, (item, 2), taken_by="Sara", note="Break room").json()
    disposed = _dispose(editor, TODAY, item, "2027-02-01", 1).json()
    delivery = api_db.get(StoreDelivery, received["id"])
    handover = api_db.get(StoreHandover, handed["id"])
    disposal = api_db.get(StoreDisposal, disposed["id"])
    assert delivery and handover and disposal
    delivery.note = "HQ shipment"
    delivery.note_file_path = "store/notes/note.pdf"
    delivery.note_file_name = "note.pdf"
    delivery.note_file_media_type = "application/pdf"
    delivery.note_file_size = 12
    delivery.created_at = datetime(2026, 12, 15, 15)
    handover.created_at = datetime(2026, 12, 15, 13)
    disposal.created_at = datetime(2026, 12, 15, 12)
    api_db.commit()
    return [("out", handed["id"]), ("disposed", disposed["id"]), ("in", received["id"])]


def test_store_movements_order_shape_and_note_file(
    editor: TestClient, movements: list[tuple[str, int]]
) -> None:
    response = editor.get("/api/v1/store/movements")
    assert response.status_code == 200, response.text
    rows = response.json()
    assert [(r["kind"], r["id"]) for r in rows] == movements
    assert rows[0]["taken_by"] == "Sara"
    assert rows[0]["note"] == "Break room"
    assert rows[0]["recorded_by_name"] == "store-editor@test.ae"
    assert rows[0]["recorded_by_name_ar"] is None
    assert rows[1]["reason"] == "damaged"
    assert rows[2]["note_file"] == {
        "name": "note.pdf",
        "media_type": "application/pdf",
        "size": 12,
        "url": f"/api/v1/store/deliveries/{movements[2][1]}/note-file",
    }
    for row in rows:
        assert len(row["lines"]) == 1
        assert row["lines"][0]["item_code"] == "ST-0001"
        assert row["lines"][0]["expiry_date"] == "2027-02-01"


@pytest.mark.parametrize("kind", ["in", "out", "disposed"])
def test_store_movements_kind_filter(
    editor: TestClient, movements: list[tuple[str, int]], kind: str
) -> None:
    rows = editor.get("/api/v1/store/movements", params={"kind": kind}).json()
    assert [(r["kind"], r["id"]) for r in rows] == [r for r in movements if r[0] == kind]
    assert editor.get("/api/v1/store/movements", params={"kind": "wrong"}).status_code == 422


@pytest.mark.parametrize(
    "query, kinds",
    [
        ("sArA", ["out"]),
        ("break ROOM", ["out"]),
        ("shipment", ["in"]),
        ("ST-0001", ["out", "disposed", "in"]),
        ("coFFee", ["out", "disposed", "in"]),
        ("قهوة", ["out", "disposed", "in"]),
        ("store-editor", ["out", "disposed", "in"]),
        ("missing", []),
        ("   ", ["out", "disposed", "in"]),
    ],
)
def test_store_movements_search(
    editor: TestClient, movements: list[tuple[str, int]], query: str, kinds: list[str]
) -> None:
    rows = editor.get("/api/v1/store/movements", params={"q": query}).json()
    assert [r["kind"] for r in rows] == kinds
    rows = editor.get("/api/v1/store/movements", params={"q": query, "kind": "in"}).json()
    assert [r["kind"] for r in rows] == [kind for kind in kinds if kind == "in"]


def test_store_movements_names_resolved_once_per_language(
    editor: TestClient,
    movements: list[tuple[str, int]],
    api_db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = api_db.scalar(select(User.id).where(User.email == "store-editor@test.ae"))
    assert user_id is not None
    calls: list[tuple[str, set[int]]] = []

    def names(_db: Session, ids: set[int]) -> dict[int, str]:
        calls.append(("en", ids))
        return {user_id: "Store Keeper"}

    def names_ar(_db: Session, ids: set[int]) -> dict[int, str | None]:
        calls.append(("ar", ids))
        return {user_id: "أمين المخزن"}

    monkeypatch.setattr(book_service, "resolve_names_by_ids", names)
    monkeypatch.setattr(book_service, "resolve_names_ar_by_ids", names_ar)
    rows = editor.get("/api/v1/store/movements", params={"q": "أمين"}).json()
    assert len(rows) == 3
    assert all(r["recorded_by_name"] == "Store Keeper" for r in rows)
    assert all(r["recorded_by_name_ar"] == "أمين المخزن" for r in rows)
    assert calls == [("en", {user_id}), ("ar", {user_id})]


def test_store_movements_requires_view(api_db: Session) -> None:
    user = _make_user(api_db, role="operator", email="no-view@test.ae")
    assert _client_for(api_db, user).get("/api/v1/store/movements").status_code == 403
    viewer = _make_user(api_db, role="operator", email="view@test.ae", grants=("store.view",))
    assert _client_for(api_db, viewer).get("/api/v1/store/movements").status_code == 200


def test_store_dashboard_month_strip(editor: TestClient, category: StoreCategory) -> None:
    data = editor.get("/api/v1/store/dashboard").json()
    assert (
        data["counts_recorded"],
        data["usage_ready"],
        data["suggestion_count"],
        data["expiring_soon_days"],
    ) == (0, False, 0, 60)
    item = _item(editor, category)["id"]
    assert _count(editor, date(2026, 10, 1), (item, None, 20)).status_code == 201
    data = editor.get("/api/v1/store/dashboard").json()
    assert (data["counts_recorded"], data["usage_ready"]) == (1, False)
    assert _count(editor, date(2026, 11, 1), (item, None, 5)).status_code == 201
    data = editor.get("/api/v1/store/dashboard").json()
    assert (data["counts_recorded"], data["usage_ready"], data["suggestion_count"]) == (2, True, 1)
    assert data["suggestion_count"] == len(data["suggestions"])
    assert data["last_count_on"] == "2026-11-01"
    assert data["last_delivery_on"] is None
