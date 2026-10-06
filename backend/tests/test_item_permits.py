"""Item permits (إدخال مواد): service + API behavior and the letter body builder."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import NotFoundError, ValidationFailedError
from app.core.permit_letter import build_item_permit_letter_html
from app.db.models import Book, BookCategory, Employee, Manager, User, UserPermission
from app.db.session import get_db
from app.main import create_app
from app.schemas.item_permit import ItemPermitCreate, ItemPermitUpdate
from app.services import document_service, item_permit_service


@pytest.fixture()
def env(api_db: Session, tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> Session:
    """Tmp data dir + stubbed PDF chain, with an employee and an operator."""
    from app.config import Settings

    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    api_db.add(BookCategory(id="GS", prefix="GS"))
    api_db.add(Employee(id="G3082", name_en="Ali", name_ar="علي", position_ar="مهندس"))
    api_db.add(User(email="op@x.ae", password_hash="x", role="admin", status="active"))
    api_db.commit()
    return api_db


def _linked_manager(db: Session) -> Manager:
    u = User(email="mgr@x.ae", password_hash="x", role="admin", status="active")
    db.add(u)
    db.commit()
    m = Manager(name_en="Boss", user_id=u.id)
    db.add(m)
    db.commit()
    return m


def _payload(**kw: Any) -> ItemPermitCreate:
    base: dict[str, Any] = dict(
        employee_id="G3082",
        items=[{"name": "كابل شبكة", "quantity": 3}, {"name": "<b>مفك</b>", "quantity": 1}],
        send_for_approval=False,
    )
    base.update(kw)
    return ItemPermitCreate(**base)


def _latest_version(db: Session, book_id: int):
    book = db.get_one(Book, book_id)
    return book, max(book.versions, key=lambda v: v.version_no)


def test_create_generates_1_5_letter_on_security_permit_paper(env: Session) -> None:
    row = item_permit_service.create_item_permit(env, _payload(), actor="op@x.ae")
    book, latest = _latest_version(env, row.book_id)
    assert book.ref_number.startswith("1/5/")
    assert latest.template_id == "Security Permit"
    assert latest.fields["subject"] == "التصاريح"
    assert latest.fields["recipient_name"] == "مسؤول وحدة التفتيش"
    body = latest.fields["body"]
    assert "المنطقة الحمراء" in body and "مبنى مركز الإصلاح والتأهيل الوثبة - 2" in body
    assert "كابل شبكة" in body and "G3082" in body and "مهندس" in body and "علي" in body
    read = item_permit_service.to_read(row, db=env)
    assert read.book_ref == book.ref_number
    assert read.employee_name == "علي" and read.employee_title == "مهندس"


def test_update_regenerates_letter(env: Session) -> None:
    row = item_permit_service.create_item_permit(env, _payload(), actor="op@x.ae")
    ref = env.get_one(Book, row.book_id).ref_number
    row = item_permit_service.update_item_permit(
        env,
        row.id,
        ItemPermitUpdate(zone="green", items=[{"name": "طابعة", "quantity": 2}]),
        actor="op@x.ae",
    )
    book, latest = _latest_version(env, row.book_id)
    assert book.ref_number == ref and len(book.versions) == 1  # draft re-rendered in place
    assert "المنطقة الخضراء" in latest.fields["body"] and "طابعة" in latest.fields["body"]
    assert "كابل شبكة" not in latest.fields["body"]
    # A signed letter is never edited in place: the edit appends a new version.
    book.approval_state = "approved"
    env.commit()
    item_permit_service.update_item_permit(env, row.id, ItemPermitUpdate(site="مبنى آخر"))
    book, latest = _latest_version(env, row.book_id)
    assert len(book.versions) == 2 and "مبنى آخر" in latest.fields["body"]


def test_pending_letter_resubmits_after_edit(env: Session) -> None:
    mgr = _linked_manager(env)
    row = item_permit_service.create_item_permit(
        env, _payload(manager_id=mgr.id, send_for_approval=True), actor="op@x.ae"
    )
    assert item_permit_service.to_read(row, db=env).approval_state == "pending"
    row = item_permit_service.update_item_permit(
        env, row.id, ItemPermitUpdate(site="مبنى آخر"), actor="op@x.ae"
    )
    book, latest = _latest_version(env, row.book_id)
    assert book.approval_state == "pending"
    assert [s.state for s in latest.approval_steps] == ["pending"]


def test_manual_submit_surfaces_chain_errors(env: Session) -> None:
    m = Manager(name_en="No Login")
    env.add(m)
    env.commit()
    row = item_permit_service.create_item_permit(env, _payload(manager_id=m.id), actor="op@x.ae")
    with pytest.raises(ValidationFailedError):
        item_permit_service.submit_item_permit_book(env, row.id, actor="op@x.ae")


@pytest.mark.parametrize(
    "bad",
    [{"items": []}, {"items": [{"name": "x", "quantity": 0}]}, {"zone": "blue"}],
)
def test_schema_rejects_invalid_payload(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        _payload(**bad)


def test_unknown_employee_rejected(env: Session) -> None:
    with pytest.raises(ValidationFailedError) as exc:
        item_permit_service.create_item_permit(env, _payload(employee_id="G0000"))
    assert exc.value.code == "ITEM_PERMIT_EMPLOYEE_NOT_FOUND"


def test_soft_delete_hides_from_list_and_get(env: Session) -> None:
    row = item_permit_service.create_item_permit(env, _payload(), actor="op@x.ae")
    item_permit_service.soft_delete_item_permit(env, row.id, actor="op@x.ae")
    assert item_permit_service.list_item_permits(env) == ([], 0)
    with pytest.raises(NotFoundError):
        item_permit_service.get_item_permit(env, row.id)


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def test_api_create_list_search_get_delete(env: Session) -> None:
    c = _client(env, env.query(User).filter_by(email="op@x.ae").one())
    r = c.post(
        "/api/v1/item-permits",
        json={"employee_id": "G3082", "items": [{"name": "كابل شبكة", "quantity": 3}]},
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["zone"] == "red" and created["employee_name"] == "علي"
    assert c.get("/api/v1/item-permits", params={"q": "كابل"}).json()["total"] == 1
    assert c.get("/api/v1/item-permits", params={"q": "nomatch"}).json()["total"] == 0
    assert c.get(f"/api/v1/item-permits/{created['id']}").status_code == 200
    assert c.delete(f"/api/v1/item-permits/{created['id']}").status_code == 204
    assert c.get(f"/api/v1/item-permits/{created['id']}").status_code == 404


def test_api_requires_permits_capabilities(env: Session) -> None:
    viewer = User(email="v@x.ae", password_hash="x", role="operator", status="active")
    denied = User(email="d@x.ae", password_hash="x", role="manager", status="active")
    env.add_all([viewer, denied])
    env.commit()
    env.add(UserPermission(user_id=denied.id, capability="permits.view", effect="deny"))
    env.commit()
    r = _client(env, denied).get("/api/v1/item-permits")
    assert r.status_code == 403 and r.json()["error"]["details"]["capability"] == "permits.view"
    c = _client(env, viewer)
    assert c.get("/api/v1/item-permits").status_code == 200
    r = c.post("/api/v1/item-permits", json={})
    assert r.status_code == 403 and r.json()["error"]["details"]["capability"] == "permits.create"


# ─── letter body builder (pure) ────────────────────────────────────────────────

_EMP = {"id": "G1", "title": "فني", "name": "سالم"}


def test_letter_zone_mapping_numbering_and_no_approval_line() -> None:
    items: list[dict[str, object]] = [
        {"name": "أ", "quantity": 2},
        {"name": "ب", "quantity": 5},
    ]
    red = build_item_permit_letter_html(zone="red", site="الموقع", items=items, employee=_EMP)
    green = build_item_permit_letter_html(zone="green", site="الموقع", items=items, employee=_EMP)
    assert "داخل المنطقة الحمراء في الموقع" in red and "المنطقة الخضراء" not in red
    assert "داخل المنطقة الخضراء في الموقع" in green and "المنطقة الحمراء" not in green
    assert "<td>1</td><td>أ</td><td>2</td>" in red
    assert "<td>2</td><td>ب</td><td>5</td>" in red
    assert "<th>م</th><th>المادة</th><th>العدد</th>" in red
    assert "<td>G1</td><td>فني</td><td>سالم</td>" in red
    assert "الإعتماد" not in red


def test_letter_escapes_user_text() -> None:
    html = build_item_permit_letter_html(
        zone="red",
        site="<i>s</i>",
        items=[{"name": "<script>x</script>", "quantity": 1}],
        employee={"id": "G1", "title": "<b>t</b>", "name": "a&b"},
    )
    assert "<script>" not in html and "<i>s" not in html and "<b>t" not in html
    assert "&lt;script&gt;" in html and "a&amp;b" in html
