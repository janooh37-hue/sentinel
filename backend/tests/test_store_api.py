"""Assets store API: stock arithmetic, count rules, Batch identity, gates, files."""

from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from threading import Barrier
from typing import Any
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.config import get_settings
from app.db.models import Base, StoreBatch, StoreCategory, StoreItem, User, UserPermission
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.schemas.store import StoreDeliveryCreate
from app.services import store_service

TODAY = date(2026, 12, 15)
_PDF = b"%PDF-1.4\n%store delivery note\n"


def _make_user(
    db: Session,
    *,
    role: str,
    email: str,
    grants: tuple[str, ...] = (),
    denies: tuple[str, ...] = (),
) -> User:
    user = User(email=email, password_hash="x", role=role, status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    db.add_all(UserPermission(user_id=user.id, capability=c, effect="grant") for c in grants)
    db.add_all(UserPermission(user_id=user.id, capability=c, effect="deny") for c in denies)
    db.commit()
    return user


def _client_for(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture(autouse=True)
def _fixed_today(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(store_service, "today", lambda: TODAY)
    settings = get_settings()
    monkeypatch.setattr(settings, "data_dir", tmp_path / "store-data")
    settings.ensure_dirs()


@pytest.fixture()
def category(api_db: Session) -> StoreCategory:
    row = StoreCategory(name_en="Pantry", name_ar="ضيافة")
    api_db.add(row)
    api_db.commit()
    return row


@pytest.fixture()
def editor(api_db: Session) -> TestClient:
    user = _make_user(
        api_db, role="operator", email="store-editor@test.ae", grants=("store.view", "store.edit")
    )
    return _client_for(api_db, user)


def _error(response: Any) -> dict[str, Any]:
    return response.json()["error"]


def _item(client: TestClient, category: StoreCategory, name: str = "Coffee", **extra: Any) -> dict:
    response = client.post(
        "/api/v1/store/items", json={"name_en": name, "category_id": category.id, **extra}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _deliver(client: TestClient, on: date, *lines: tuple[int, str | None, int]) -> Any:
    return client.post(
        "/api/v1/store/deliveries",
        json={
            "received_on": on.isoformat(),
            "lines": [{"item_id": i, "expiry": e, "quantity": q} for i, e, q in lines],
        },
    )


def _count(client: TestClient, on: date, *lines: tuple[int, str | None, int]) -> Any:
    return client.post(
        "/api/v1/store/counts",
        json={
            "counted_on": on.isoformat(),
            "lines": [{"item_id": i, "expiry": e, "quantity": q} for i, e, q in lines],
        },
    )


def _dispose(client: TestClient, on: date, item_id: int, expiry: str | None, quantity: int) -> Any:
    return client.post(
        "/api/v1/store/disposals",
        json={
            "disposed_on": on.isoformat(),
            "item_id": item_id,
            "expiry": expiry,
            "quantity": quantity,
            "reason": "damaged",
        },
    )


def _items_by_code(client: TestClient, **params: Any) -> dict[str, dict]:
    response = client.get("/api/v1/store/items", params=params)
    assert response.status_code == 200, response.text
    return {row["code"]: row for row in response.json()}


def test_usage_follows_count_windows_with_same_day_events_after_the_count(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    assert _count(editor, date(2026, 10, 1), (item, None, 10)).status_code == 201
    # Same day as the October count: happens after it, so it belongs to Oct→Nov.
    assert _deliver(editor, date(2026, 10, 1), (item, None, 5)).status_code == 201
    assert _dispose(editor, date(2026, 10, 20), item, None, 2).status_code == 201
    assert _count(editor, date(2026, 11, 1), (item, None, 6)).status_code == 201
    assert _deliver(editor, date(2026, 11, 1), (item, None, 4)).status_code == 201
    # More on the shelf than the arithmetic allows: negative usage, not clamped.
    assert _count(editor, date(2026, 12, 1), (item, None, 12)).status_code == 201
    assert _dispose(editor, date(2026, 12, 1), item, None, 1).status_code == 201

    dashboard = editor.get("/api/v1/store/dashboard").json()
    assert dashboard["usage"]["months"] == ["2026-11", "2026-12"]
    # Nov: 10 + 5 - 2 (disposal is not usage) - 6 = 7; Dec: 6 + 4 - 12 = -2.
    assert [row["values"] for row in dashboard["usage"]["rows"]] == [[7, -2]]
    # Current on-hand: December count 12, minus the same-day disposal.
    assert _items_by_code(editor)["ST-0001"]["on_hand"] == 11
    batches = editor.get("/api/v1/store/batches", params={"item_id": item}).json()
    assert [(b["expiry_date"], b["on_hand"], b["days_to_expiry"]) for b in batches] == [
        (None, 11, None)
    ]
    assert dashboard["last_count_on"] == "2026-12-01"
    assert dashboard["last_delivery_on"] == "2026-11-01"
    assert dashboard["suggestions"] == []


def test_on_hand_without_any_count_is_deliveries_less_disposals(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    _deliver(editor, date(2026, 11, 3), (item, "2027-06-30", 8))
    _deliver(editor, date(2026, 12, 2), (item, "2027-06-30", 3))
    _dispose(editor, date(2026, 12, 3), item, "2027-06-30", 4)
    assert _items_by_code(editor)["ST-0001"]["on_hand"] == 7
    assert editor.get("/api/v1/store/dashboard").json()["usage"] == {"months": [], "rows": []}


def test_count_must_include_every_batch_expected_on_the_shelf_without_leaking_quantities(
    editor: TestClient, category: StoreCategory
) -> None:
    coffee = _item(editor, category, "Coffee")["id"]
    tea = _item(editor, category, "Tea")["id"]
    _deliver(editor, date(2026, 11, 2), (coffee, None, 4), (tea, "2027-01", 6))
    # Delivered on the count's own day: happens after the count, so not expected.
    _deliver(editor, date(2026, 12, 1), (coffee, "2028-01-01", 2))

    expected = editor.get("/api/v1/store/counts/expected", params={"counted_on": "2026-12-01"})
    assert expected.status_code == 200
    rows = expected.json()
    assert [(r["item_code"], r["expiry_date"], r["expiry_month_only"]) for r in rows] == [
        ("ST-0001", None, False),
        ("ST-0002", "2027-01-31", True),
    ]
    assert all("quantity" not in row and "on_hand" not in row for row in rows)

    missing = _count(editor, date(2026, 12, 1), (coffee, None, 3), (coffee, "2030-01", 1))
    assert missing.status_code == 422
    error = _error(missing)
    assert error["code"] == "STORE_COUNT_MISSING_BATCHES"
    tea_batch = rows[1]["batch_id"]
    assert error["details"]["batches"] == [
        {"batch_id": tea_batch, "item_code": "ST-0002", "expiry_date": "2027-01-31"}
    ]
    # A rejected count leaves no Batch it would have created behind.
    coffee_batches = editor.get("/api/v1/store/batches", params={"item_id": coffee}).json()
    assert [b["expiry_date"] for b in coffee_batches] == ["2028-01-01", None]

    # Zero is a valid count; a Batch never delivered may be added.
    created = _count(
        editor,
        date(2026, 12, 1),
        (coffee, None, 0),
        (tea, "2027-01-31", 5),
        (tea, "2029-03", 1),
    )
    assert created.status_code == 201, created.text
    again = _count(editor, date(2026, 12, 9), (coffee, None, 0), (tea, "2027-01", 5))
    assert again.status_code == 409
    assert _error(again)["code"] == "STORE_COUNT_MONTH_EXISTS"

    # PUT replaces the lines; the Batch only this count used disappears with its line.
    replaced = editor.put(
        f"/api/v1/store/counts/{created.json()['id']}",
        json={
            "counted_on": "2026-12-01",
            "lines": [
                {"item_id": coffee, "expiry": None, "quantity": 1},
                {"item_id": tea, "expiry": "2027-01", "quantity": 5},
            ],
        },
    )
    assert replaced.status_code == 200, replaced.text
    tea_batches = editor.get("/api/v1/store/batches", params={"item_id": tea}).json()
    assert [b["expiry_date"] for b in tea_batches] == ["2027-01-31"]
    incomplete = editor.put(
        f"/api/v1/store/counts/{created.json()['id']}",
        json={"counted_on": "2026-12-01", "lines": [{"item_id": coffee, "quantity": 1}]},
    )
    assert _error(incomplete)["code"] == "STORE_COUNT_MISSING_BATCHES"


def test_batch_is_item_and_expiry_date_month_only_and_undated(
    editor: TestClient, category: StoreCategory, api_db: Session
) -> None:
    item = _item(editor, category)["id"]
    assert (
        _deliver(editor, date(2026, 11, 1), (item, "2027-04", 2), (item, None, 1)).status_code
        == 201
    )
    # The exact last day of a month-only Batch is the same Batch; undated stays single.
    assert (
        _deliver(editor, date(2026, 11, 2), (item, "2027-04-30", 3), (item, None, 4)).status_code
        == 201
    )
    batches = editor.get("/api/v1/store/batches", params={"item_id": item}).json()
    assert [(b["expiry_date"], b["expiry_month_only"], b["on_hand"]) for b in batches] == [
        ("2027-04-30", True, 5),
        (None, False, 5),
    ]
    assert len(api_db.scalars(select(StoreBatch)).all()) == 2

    duplicate = _deliver(editor, date(2026, 11, 3), (item, "2027-04", 1), (item, "2027-04-30", 1))
    assert duplicate.status_code == 422
    assert _error(duplicate)["code"] == "STORE_DUPLICATE_LINE"
    bad = _deliver(editor, date(2026, 11, 3), (item, "2027-13", 1))
    assert bad.status_code == 422


def test_contains_is_locked_once_the_item_has_stock_records(
    editor: TestClient, category: StoreCategory
) -> None:
    created = _item(
        editor, category, contains_qty=12, contains_unit_en="Pack", contains_unit_ar="علبة"
    )
    patched = editor.patch(
        f"/api/v1/store/items/{created['id']}",
        json={"contains_qty": 24},
        headers={"If-Match": created["version"]},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["contains_qty"] == 24

    stale = editor.patch(
        f"/api/v1/store/items/{created['id']}",
        json={"minimum_level": 3},
        headers={"If-Match": created["version"]},
    )
    assert stale.status_code == 409
    assert _error(stale)["code"] == "STORE_ITEM_VERSION_CONFLICT"

    _deliver(editor, date(2026, 11, 1), (created["id"], None, 30))
    version = patched.json()["version"]
    locked = editor.patch(
        f"/api/v1/store/items/{created['id']}",
        json={"contains_qty": None, "contains_unit_en": None, "contains_unit_ar": None},
        headers={"If-Match": version},
    )
    assert locked.status_code == 409
    assert _error(locked)["code"] == "STORE_ITEM_CONTAINS_LOCKED"
    renamed = editor.patch(
        f"/api/v1/store/items/{created['id']}",
        json={"name_en": "Coffee jar", "minimum_level": 24},
        headers={"If-Match": version},
    )
    assert renamed.status_code == 200
    assert renamed.json()["contains_qty"] == 24

    half = editor.post(
        "/api/v1/store/items",
        json={"name_en": "Cups", "category_id": category.id, "contains_qty": 50},
    )
    assert _error(half)["code"] == "STORE_ITEM_CONTAINS_INCOMPLETE"


def test_codes_are_sequential_and_never_reused_and_archive_needs_empty_shelf(
    editor: TestClient, category: StoreCategory
) -> None:
    first = _item(editor, category, "Coffee")
    second = _item(editor, category, "Tea")
    assert (first["code"], second["code"]) == ("ST-0001", "ST-0002")

    _deliver(editor, date(2026, 11, 1), (first["id"], None, 2))
    refused = editor.post(f"/api/v1/store/items/{first['id']}/archive")
    assert refused.status_code == 409
    assert _error(refused)["code"] == "STORE_ITEM_HAS_STOCK"

    archived = editor.post(f"/api/v1/store/items/{second['id']}/archive")
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None
    assert _item(editor, category, "Sugar")["code"] == "ST-0003"
    assert set(_items_by_code(editor)) == {"ST-0001", "ST-0003"}
    assert set(_items_by_code(editor, include_archived=True)) == {"ST-0001", "ST-0002", "ST-0003"}
    picker = editor.get("/api/v1/store/items/picker").json()
    assert [row["code"] for row in picker] == ["ST-0001", "ST-0003"]

    blocked = _deliver(editor, date(2026, 11, 2), (second["id"], None, 1))
    assert blocked.status_code == 409
    assert _error(blocked)["code"] == "STORE_ITEM_ARCHIVED"
    restored = editor.post(f"/api/v1/store/items/{second['id']}/restore")
    assert restored.json()["archived_at"] is None


def test_archived_items_are_not_expected_in_a_count(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    _deliver(editor, date(2026, 11, 1), (item, None, 2))
    _dispose(editor, date(2026, 12, 10), item, None, 2)
    expected_url = "/api/v1/store/counts/expected"
    assert len(editor.get(expected_url, params={"counted_on": "2026-12-01"}).json()) == 1
    assert editor.post(f"/api/v1/store/items/{item}/archive").status_code == 200
    expected = editor.get("/api/v1/store/counts/expected", params={"counted_on": "2026-12-01"})
    assert expected.json() == []


def test_future_dates_are_refused(editor: TestClient, category: StoreCategory) -> None:
    item = _item(editor, category)["id"]
    tomorrow = TODAY + timedelta(days=1)
    _deliver(editor, TODAY, (item, None, 5))
    for response in (
        _deliver(editor, tomorrow, (item, None, 1)),
        _count(editor, tomorrow, (item, None, 1)),
        _dispose(editor, tomorrow, item, None, 1),
    ):
        assert response.status_code == 422
        assert _error(response)["code"] == "STORE_DATE_IN_FUTURE"


def test_disposal_is_bounded_by_on_hand_and_deleting_records_drops_unused_batches(
    editor: TestClient, category: StoreCategory, api_db: Session
) -> None:
    item = _item(editor, category)["id"]
    delivery = _deliver(editor, date(2026, 11, 1), (item, "2027-02-14", 3)).json()
    too_many = _dispose(editor, date(2026, 11, 5), item, "2027-02-14", 4)
    assert too_many.status_code == 422
    assert _error(too_many)["code"] == "STORE_DISPOSAL_EXCEEDS_STOCK"
    assert _error(too_many)["details"]["on_hand"] == 3
    unknown = _dispose(editor, date(2026, 11, 5), item, "2027-03-01", 1)
    assert _error(unknown)["code"] == "STORE_BATCH_NOT_FOUND"

    disposal = _dispose(editor, date(2026, 11, 5), item, "2027-02-14", 3)
    assert disposal.status_code == 201
    assert _items_by_code(editor)["ST-0001"]["on_hand"] == 0

    assert editor.delete(f"/api/v1/store/deliveries/{delivery['id']}").status_code == 204
    # The disposal still uses the Batch.
    assert len(api_db.scalars(select(StoreBatch)).all()) == 1
    assert editor.delete(f"/api/v1/store/disposals/{disposal.json()['id']}").status_code == 204
    api_db.expire_all()
    assert api_db.scalars(select(StoreBatch)).all() == []


def test_capability_gates(api_db: Session, category: StoreCategory) -> None:
    viewer = _client_for(
        api_db, _make_user(api_db, role="operator", email="v@test.ae", grants=("store.view",))
    )
    assert viewer.get("/api/v1/store/items").status_code == 200
    assert viewer.get("/api/v1/store/dashboard").status_code == 200
    write = viewer.post(
        "/api/v1/store/items", json={"name_en": "Coffee", "category_id": category.id}
    )
    assert write.status_code == 403
    assert _error(write)["details"] == {"capability": "store.edit"}

    # Operators hold documents.generate (the MRF) but not store.view.
    generator = _client_for(api_db, _make_user(api_db, role="operator", email="g@test.ae"))
    assert generator.get("/api/v1/store/items").status_code == 403
    assert generator.get("/api/v1/store/items/picker").status_code == 200

    neither = _client_for(
        api_db,
        _make_user(api_db, role="operator", email="n@test.ae", denies=("documents.generate",)),
    )
    refused = neither.get("/api/v1/store/items/picker")
    assert refused.status_code == 403
    assert _error(refused)["code"] == "FORBIDDEN"


def test_delivery_note_upload_validation_download_and_removal(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    delivery = _deliver(editor, date(2026, 11, 1), (item, None, 1)).json()
    url = f"/api/v1/store/deliveries/{delivery['id']}/note-file"

    renamed = editor.put(url, files={"file": ("note.png", _PDF, "image/png")})
    assert renamed.status_code == 422
    assert _error(renamed)["code"] == "STORE_NOTE_FILE_BAD_FORMAT"
    huge = _PDF + b"0" * store_service.NOTE_FILE_MAX_BYTES
    too_large = editor.put(url, files={"file": ("note.pdf", huge, "application/pdf")})
    assert _error(too_large)["code"] == "STORE_NOTE_FILE_TOO_LARGE"

    uploaded = editor.put(url, files={"file": ("../HQ note.pdf", _PDF, "application/pdf")})
    assert uploaded.status_code == 200, uploaded.text
    note = uploaded.json()["note_file"]
    assert (note["name"], note["size"], note["url"]) == ("HQ note.pdf", len(_PDF), url)
    stored = list((get_settings().data_dir / "store_files" / str(delivery["id"])).iterdir())
    assert len(stored) == 1

    raw = editor.get(url)
    assert raw.content == _PDF
    assert raw.headers["x-content-type-options"] == "nosniff"
    encoded = editor.get(url, params={"encoding": "base64"})
    assert base64.b64decode(encoded.text) == _PDF

    removed = editor.delete(url)
    assert removed.json()["note_file"] is None
    assert not stored[0].exists()
    assert editor.get(url).status_code == 404


def test_dashboard_expired_expiring_low_stock_and_suggestions(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(
        editor,
        category,
        contains_qty=12,
        contains_unit_en="Pack",
        contains_unit_ar="علبة",
        minimum_level=20,
    )["id"]
    _count(editor, date(2026, 10, 1), (item, "2026-12-10", 24), (item, "2027-01", 36))
    _deliver(editor, date(2026, 10, 1), (item, "2027-01", 12))
    _count(editor, date(2026, 11, 1), (item, "2026-12-10", 12), (item, "2027-01", 24))
    _count(editor, date(2026, 12, 1), (item, "2026-12-10", 6), (item, "2027-01", 6))

    dashboard = editor.get("/api/v1/store/dashboard").json()
    assert dashboard["today"] == "2026-12-15"
    assert dashboard["expiring_soon_days"] == 60
    assert [(r["expiry_date"], r["on_hand"], r["days_left"]) for r in dashboard["expired"]] == [
        ("2026-12-10", 6, -5)
    ]
    assert [
        (r["expiry_date"], r["expiry_month_only"], r["on_hand"], r["days_left"])
        for r in dashboard["expiring_soon"]
    ] == [("2027-01-31", True, 6, 47)]
    assert [(r["item_code"], r["on_hand"], r["minimum_level"]) for r in dashboard["low_stock"]] == [
        ("ST-0001", 12, 20)
    ]
    # Oct→Nov: 60 + 12 - 36 = 36; Nov→Dec: 36 - 12 = 24; mean 30 - 12 on hand = 18.
    assert dashboard["usage"]["rows"][0]["values"] == [36, 24]
    assert [
        (s["average_usage"], s["on_hand"], s["suggested"], s["suggested_units"])
        for s in dashboard["suggestions"]
    ] == [(30.0, 12, 18, 2)]


def test_backdated_disposal_is_checked_against_stock_on_its_own_day(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    assert _count(editor, date(2026, 10, 1), (item, None, 10)).status_code == 201
    assert _count(editor, date(2026, 11, 1), (item, None, 0)).status_code == 201
    # Today's on-hand is 0, but on Oct 15 the shelf held 10.
    accepted = _dispose(editor, date(2026, 10, 15), item, None, 2)
    assert accepted.status_code == 201, accepted.text
    dashboard = editor.get("/api/v1/store/dashboard").json()
    assert dashboard["usage"]["rows"][0]["values"] == [8]

    other = _item(editor, category, "Tea")["id"]
    _deliver(editor, date(2026, 11, 10), (other, None, 5))
    before_delivery = _dispose(editor, date(2026, 11, 5), other, None, 1)
    assert before_delivery.status_code == 422
    assert _error(before_delivery)["code"] == "STORE_DISPOSAL_EXCEEDS_STOCK"
    assert _error(before_delivery)["details"]["on_hand"] == 0

    # Fine on its own day, but a later disposal would then exceed what was left.
    assert _dispose(editor, date(2026, 11, 12), other, None, 3).status_code == 201
    later_negative = _dispose(editor, date(2026, 11, 11), other, None, 3)
    assert later_negative.status_code == 422
    assert _error(later_negative)["details"]["on_hand"] == 2


def test_delivery_note_with_arabic_filename_downloads_raw_and_base64(
    editor: TestClient, category: StoreCategory
) -> None:
    item = _item(editor, category)["id"]
    delivery = _deliver(editor, date(2026, 11, 1), (item, None, 1)).json()
    url = f"/api/v1/store/deliveries/{delivery['id']}/note-file"
    uploaded = editor.put(url, files={"file": ("استلام.pdf", _PDF, "application/pdf")})
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["note_file"]["name"] == "استلام.pdf"

    raw = editor.get(url)
    assert raw.status_code == 200
    assert raw.content == _PDF
    assert raw.headers["content-disposition"] == (
        f"attachment; filename=\".pdf\"; filename*=UTF-8''{quote('استلام.pdf')}"
    )
    encoded = editor.get(url, params={"encoding": "base64"})
    assert encoded.status_code == 200
    assert base64.b64decode(encoded.text) == _PDF


def test_concurrent_first_use_of_a_batch_creates_it_once(tmp_path: Path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'store-race.db'}", connect_args={"check_same_thread": False}
    )
    attach_sqlite_pragmas(engine)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as setup:
        category = StoreCategory(name_en="Pantry", name_ar="ضيافة")
        setup.add(category)
        setup.flush()
        item = StoreItem(
            code="ST-0001",
            name_en="Coffee",
            category_id=category.id,
            counting_unit_en="Carton",
            counting_unit_ar="كرتون",
        )
        setup.add(item)
        setup.commit()
        item_id = item.id
    payload = StoreDeliveryCreate.model_validate(
        {
            "received_on": "2026-11-01",
            "lines": [{"item_id": item_id, "expiry": "2027-05", "quantity": 2}],
        }
    )
    barrier = Barrier(2)

    def deliver() -> int:
        with factory() as db:
            barrier.wait()
            return store_service.create_delivery(db, payload, actor="race@test.ae").id

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [future.result() for future in [pool.submit(deliver) for _ in range(2)]]
        assert len(set(results)) == 2
        with factory() as check:
            batches = check.scalars(select(StoreBatch)).all()
            assert [(b.item_id, b.expiry_date) for b in batches] == [(item_id, date(2027, 5, 31))]
    finally:
        engine.dispose()
