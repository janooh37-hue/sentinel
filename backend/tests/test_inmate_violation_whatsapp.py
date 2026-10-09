"""Approved Inmate Conduct Violations post their signed PDF to the chosen group.

``openwa_client`` is monkeypatched (dev has no WhatsApp); the background
executor is replaced by a recorder so each test runs the queued delivery
deterministically on its own thread.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import fitz
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_optional_user
from app.config import get_settings
from app.core.roles import ADMIN_ROLE, MANAGER_ROLE, OPERATOR_ROLE
from app.db.models import (
    Book,
    BookCategory,
    BookVersion,
    Employee,
    GroupAnnouncementSend,
    Manager,
    User,
)
from app.db.session import get_db
from app.main import create_app
from app.services import (
    book_service,
    document_service,
    inmate_violation_whatsapp,
    openwa_client,
    user_signature_service,
)

GROUP = ("120363@g.us", "غرفة العمليات")


def _write_pdf(docx_path: Path) -> Path:
    out = docx_path.with_suffix(".pdf")
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "SIGNED")
    doc.save(out)
    doc.close()
    return out


@pytest.fixture()
def env(api_db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Any]:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GSSG_OPENWA_ENABLED", "true")
    get_settings.cache_clear()
    (tmp_path / "data").mkdir()
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", _write_pdf)
    api_db.add(BookCategory(id="NAT", prefix="NAT"))
    api_db.add(Employee(id="G-2001", name_en="Reporter", name_ar="مقدم التقرير"))
    api_db.commit()

    queued: list[int] = []
    monkeypatch.setattr(
        inmate_violation_whatsapp,
        "_executor",
        SimpleNamespace(submit=lambda fn, version_id: queued.append(version_id)),
    )
    sends: list[dict[str, Any]] = []

    def send_file(cid: str, *, data: bytes, filename: str, caption: str, mentions: Any = None):
        sends.append({"cid": cid, "data": data, "filename": filename, "caption": caption})
        return openwa_client.SendResult(ok=True, message_id="m1")

    monkeypatch.setattr(openwa_client, "send_file", send_file)
    yield SimpleNamespace(db=api_db, queued=queued, sends=sends)
    get_settings.cache_clear()


def _run_queued(env: Any) -> None:
    for version_id in env.queued:
        inmate_violation_whatsapp.deliver(version_id)
    env.queued.clear()


def _manager_user(db: Session) -> tuple[User, Manager]:
    user = User(email="mgr@x.ae", password_hash="x", role=MANAGER_ROLE, status="active")
    db.add(user)
    db.commit()
    buf = io.BytesIO()
    Image.new("RGBA", (80, 40), (0, 0, 0, 255)).save(buf, format="PNG")
    user_signature_service.save_signature(db, user, "sig.png", buf.getvalue())
    sig = get_settings().data_dir / "mgr_sig.png"
    Image.new("RGBA", (80, 40), (0, 0, 0, 255)).save(sig)
    mgr = Manager(
        name_en="Manager", name_ar="المدير", sig_path=str(sig), active=True, user_id=user.id
    )
    db.add(mgr)
    db.commit()
    return user, mgr


def _generate(db: Session, mgr: Manager, *, signed: bool) -> Book:
    result = document_service.generate_document(
        db,
        employee_id=None,
        template_id=inmate_violation_whatsapp.TEMPLATE_ID,
        fields={
            "reporter_id": "G-2001",
            "report_date": "2026-09-30",
            "inmates": [{"name": "Ali Hassan", "nationality": "x", "wing": "A", "uid": "1"}],
        },
        manager_id=mgr.id,
        submitter_id=None,
        embed_signature={"manager": signed},
        commit=True,
        current_user=None,
    )
    book = db.get(Book, result.book_id)
    assert book is not None
    return book


def _configure(db: Session) -> None:
    inmate_violation_whatsapp.set_group(db, GROUP, actor="test")


def test_auto_approval_sends_signed_pdf_once_to_configured_group(env: Any) -> None:
    _configure(env.db)
    _, mgr = _manager_user(env.db)
    book = _generate(env.db, mgr, signed=True)
    assert book.approval_state == "approved"
    assert env.queued == [book.versions[-1].id]

    _run_queued(env)
    inmate_violation_whatsapp.deliver(book.versions[-1].id)  # replay: never twice

    assert len(env.sends) == 1
    sent = env.sends[0]
    assert sent["cid"] == GROUP[0]
    assert sent["data"].startswith(b"%PDF")
    assert sent["filename"] == f"{book.ref_number}.pdf"
    assert book.ref_number in sent["caption"] and "Ali Hassan" in sent["caption"]
    assert "30/09/2026" in sent["caption"]
    row = env.db.scalars(select(GroupAnnouncementSend)).one()
    assert (row.group_id, row.status) == (GROUP[0], "sent")


def test_caption_caps_inmate_names_and_skips_bad_date() -> None:
    version = BookVersion(
        fields={"inmates": [{"name": f"N{i}"} for i in range(7)], "report_date": "bad"}
    )
    text = inmate_violation_whatsapp.caption(Book(ref_number="NAT/1"), version)
    assert "N4" in text and "N5" not in text and "وآخرون (\u20682\u2069)" in text
    assert "التاريخ" not in text and "Inmate Conduct Violations" not in text


def test_no_group_configured_sends_nothing(env: Any) -> None:
    _, mgr = _manager_user(env.db)
    book = _generate(env.db, mgr, signed=True)
    assert book.approval_state == "approved"
    assert env.queued == []
    inmate_violation_whatsapp.deliver(book.versions[-1].id)
    assert env.sends == []


def test_rolled_back_approval_sends_nothing(env: Any) -> None:
    _configure(env.db)
    _, mgr = _manager_user(env.db)
    book = _generate(env.db, mgr, signed=False)
    version = book.versions[-1]
    version.status = "approved"
    inmate_violation_whatsapp.queue_send(env.db, version)
    env.db.rollback()
    env.db.commit()
    assert env.queued == []


def test_send_failure_keeps_approval(env: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(env.db)
    _, mgr = _manager_user(env.db)

    def boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("gateway down")

    monkeypatch.setattr(openwa_client, "send_file", boom)
    book = _generate(env.db, mgr, signed=True)
    _run_queued(env)  # must not raise

    env.db.expire_all()
    assert env.db.get(Book, book.id).approval_state == "approved"  # type: ignore[union-attr]
    row = env.db.scalars(select(GroupAnnouncementSend)).one()
    assert row.status == "failed" and "gateway down" in (row.error or "")


def test_manager_signing_sends_once(env: Any) -> None:
    _configure(env.db)
    mgr_user, mgr = _manager_user(env.db)
    operator = User(email="op@x.ae", password_hash="x", role=OPERATOR_ROLE, status="active")
    env.db.add(operator)
    env.db.commit()
    book = _generate(env.db, mgr, signed=False)
    assert book.approval_state == "none" and env.queued == []

    book_service.submit_for_approval(
        env.db,
        book.id,
        priority="Normal",
        approver_user_id=mgr_user.id,
        reviewer_user_ids=[],
        submitted_by_user_id=operator.id,
    )
    assert env.queued == []
    version_id = book.versions[-1].id
    book_service.sign_book(env.db, book.id, user_id=mgr_user.id, version_id=version_id)
    assert env.queued == [version_id]
    _run_queued(env)
    assert len(env.sends) == 1 and env.sends[0]["data"].startswith(b"%PDF")


def test_scan_back_signed_copy_sends_once(env: Any) -> None:
    _configure(env.db)
    _, mgr = _manager_user(env.db)
    book = _generate(env.db, mgr, signed=False)
    scan = _write_pdf(get_settings().data_dir / "scan.docx").read_bytes()

    book_service.add_attachment(env.db, book.id, "scan.pdf", scan, as_signed=True)
    assert env.queued == [book.versions[-1].id]
    _run_queued(env)
    assert len(env.sends) == 1 and env.sends[0]["cid"] == GROUP[0]


def test_picker_routes_validate_and_store_group(env: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    admin = User(email="a@x.ae", password_hash="x", role=ADMIN_ROLE, status="active")
    env.db.add(admin)
    env.db.commit()
    monkeypatch.setattr(openwa_client, "list_groups", lambda: [openwa_client.Group(*GROUP)])
    app = create_app()
    app.dependency_overrides[get_db] = lambda: env.db
    app.dependency_overrides[get_optional_user] = lambda: admin
    client = TestClient(app)

    assert client.get("/api/v1/announcements/inmate-violation-group").json() == {"group": None}
    bad = client.put("/api/v1/announcements/inmate-violation-group", json={"group_id": "x@g.us"})
    assert bad.status_code == 422
    ok = client.put("/api/v1/announcements/inmate-violation-group", json={"group_id": GROUP[0]})
    assert ok.json() == {"group": {"id": GROUP[0], "name": GROUP[1]}}
    assert inmate_violation_whatsapp.get_group(env.db) == GROUP
    cleared = client.put("/api/v1/announcements/inmate-violation-group", json={"group_id": None})
    assert cleared.json() == {"group": None}
    assert inmate_violation_whatsapp.get_group(env.db) is None


def test_picker_route_requires_broadcast_capability(env: Any) -> None:
    operator = User(email="op2@x.ae", password_hash="x", role=OPERATOR_ROLE, status="active")
    env.db.add(operator)
    env.db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: env.db
    app.dependency_overrides[get_optional_user] = lambda: operator
    resp = TestClient(app).put(
        "/api/v1/announcements/inmate-violation-group", json={"group_id": GROUP[0]}
    )
    assert resp.status_code == 403
