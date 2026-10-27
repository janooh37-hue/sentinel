"""Save & Send, tracked Revision content, corrections and Ledger Book access."""

import hashlib
import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.config import Settings
from app.core.constants import LEDGER_BOOK_TEMPLATE_ID
from app.db.models import (
    AuditLog,
    Book,
    BookCategory,
    BookDraft,
    BookRevisionAccess,
    BookVersion,
    LedgerBookSave,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.services import book_service, ledger_book_service
from tests.conftest import make_user

DRAFTS = "/api/v1/ledger/drafts"
BOOKS = "/api/v1/ledger/books"
PNG = b"\x89PNG\r\n\x1a\npayload"
CONTENT = {"subjects": ["First subject", "Second subject"], "body_html": "<p>Original body</p>"}


@pytest.fixture
def ledger(api_db, tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(ledger_book_service, "get_settings", lambda: settings)
    monkeypatch.setattr(book_service, "get_settings", lambda: settings)
    owner = make_user(api_db, role="manager", email="writer@example.ae")
    owner.display_name = "Ledger Writer"
    other = make_user(api_db, role="manager", email="reader@example.ae")
    api_db.commit()
    actor = [owner]
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: actor[0]
    with TestClient(app) as client:
        yield client, api_db, actor, owner, other, settings.data_dir
    app.dependency_overrides.clear()


def error(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code


def send(client, **changes):
    draft_response = client.post(DRAFTS, json={"tab": 5, **CONTENT, **changes})
    assert draft_response.status_code == 201, draft_response.text
    draft = draft_response.json()
    response = client.post(f"{DRAFTS}/{draft['id']}/save-and-send")
    assert response.status_code == 200, response.text
    return draft, response.json()


def saves(db, version_id):
    return list(
        db.scalars(
            select(LedgerBookSave)
            .where(LedgerBookSave.version_id == version_id)
            .order_by(LedgerBookSave.id)
        )
    )


def sign(db, detail):
    version = db.get(BookVersion, detail["selected_version_id"])
    version.signed_at = datetime(2026, 1, 2, 12)
    db.commit()


def test_save_and_send_materializes_numbered_book_and_provenance(ledger):
    client, db, _, owner, _, _ = ledger
    today = datetime.now().strftime("%d-%m-%Y")
    draft, result = send(client, grade="top_secret", urgency="High")
    assert result["ref_number"] == "1/5/1"
    assert result["classification_code"] == "5/1"
    assert result["paper_date"] == today
    revision = result["revisions"][0]
    assert revision["version_no"] == 1
    assert revision["trigger"] == "initial"
    assert not revision["superseded"] and not revision["locked"]
    book = db.get(Book, result["id"])
    assert book.distribution == "named"
    assert book.category_id == "GS"
    assert book.source_draft_id == draft["id"]
    assert book.subject == CONTENT["subjects"][0]
    assert all(subject.lower() in book.search_text.lower() for subject in CONTENT["subjects"])
    assert (book.grade, book.urgency, book.approval_state) == ("top_secret", "High", "none")
    assert book.created_by_user_id == book.submitted_by_user_id == owner.id
    version = db.get(BookVersion, result["selected_version_id"])
    assert version.template_id == LEDGER_BOOK_TEMPLATE_ID
    assert version.fields == {"date": today, "tab": 5}
    history = saves(db, version.id)
    assert len(history) == 1
    assert history[0].subjects == CONTENT["subjects"]
    canonical = json.dumps(CONTENT, ensure_ascii=False, sort_keys=True)
    assert history[0].content_sha256 == hashlib.sha256(canonical.encode()).hexdigest()
    assert db.get(BookDraft, draft["id"]) is None
    assert (
        db.scalar(
            select(AuditLog).where(
                AuditLog.action == "ledger_book_saved_and_sent", AuditLog.entity_id == str(book.id)
            )
        )
        is not None
    )
    _, second = send(client, tab=2)
    assert second["ref_number"] == "1/2/2"


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"tab": None}, "DRAFT_TAB_REQUIRED"),
        ({"subjects": [" ", "\t"]}, "DRAFT_SUBJECT_REQUIRED"),
        ({"body_html": "<script>x</script>"}, "DRAFT_BODY_REQUIRED"),
    ],
)
def test_invalid_send_preserves_draft_and_does_not_consume_serial(ledger, changes, code):
    client, db, _, _, _, _ = ledger
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT, **changes}).json()
    error(client.post(f"{DRAFTS}/{draft['id']}/save-and-send"), 422, code)
    assert db.get(BookDraft, draft["id"]) is not None
    _, result = send(client)
    assert result["ref_number"] == "1/5/1"


def test_operator_cannot_save_and_send(ledger):
    client, db, actor, _, _, _ = ledger
    actor[0] = make_user(db, email="operator@example.ae")
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT}).json()
    assert client.post(f"{DRAFTS}/{draft['id']}/save-and-send").status_code == 403
    assert db.get(BookDraft, draft["id"]) is not None


def test_send_relocates_images_and_enforces_book_reader_access(ledger):
    client, db, actor, _, other, root = ledger
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT}).json()
    image = client.post(
        f"{DRAFTS}/{draft['id']}/images", files={"file": ("x.png", PNG, "image/png")}
    ).json()
    client.patch(
        f"{DRAFTS}/{draft['id']}", json={"body_html": f'<p>Image</p><img src="{image["src"]}"> '}
    )
    response = client.post(f"{DRAFTS}/{draft['id']}/save-and-send")
    assert response.status_code == 200, response.text
    detail = response.json()
    src = f"{BOOKS}/{detail['id']}/images/{image['name']}"
    assert f'src="{src}"' in detail["body_html"]
    assert image["src"] not in detail["body_html"]
    assert not (root / "ledger_drafts" / str(draft["id"])).exists()
    assert (
        root / "book_attachments" / str(detail["id"]) / "images" / image["name"]
    ).read_bytes() == PNG
    actor[0] = other
    error(client.get(src), 404, "BOOK_NOT_FOUND")
    db.add(
        BookRevisionAccess(
            version_id=detail["selected_version_id"],
            user_id=other.id,
            kind="reviewer",
            state="reviewed",
            decided_at=datetime(2026, 1, 1),
        )
    )
    db.commit()
    response = client.get(src)
    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"


def test_content_saves_are_append_only_sanitized_and_deduplicated(ledger):
    client, db, _, owner, _, _ = ledger
    _, detail = send(client)
    url = f"{BOOKS}/{detail['id']}"
    payload = {
        "subjects": ["Changed", "Additional"],
        "body_html": '<script>bad()</script><p onerror="bad()">Edited</p>',
    }
    response = client.put(f"{url}/content", json=payload)
    assert response.status_code == 200, response.text
    current = response.json()
    assert current["body_html"] == "<p>Edited</p>"
    assert current["subjects"] == payload["subjects"]
    history = saves(db, detail["selected_version_id"])
    assert len(history) == 2
    assert history[0].body_html == CONTENT["body_html"]
    assert client.put(f"{url}/content", json=payload).json() == current
    assert len(saves(db, detail["selected_version_id"])) == 2
    response = client.get(f"{url}/revisions/{detail['selected_version_id']}/saves")
    assert response.status_code == 200
    rows = response.json()
    assert [row["id"] for row in rows] == [row.id for row in history]
    assert [row["content_sha256"] for row in rows] == [row.content_sha256 for row in history]
    assert all(
        row["saved_by_user_id"] == owner.id
        and row["saved_by_name"] == "Ledger Writer"
        and row["saved_at"]
        for row in rows
    )


def test_creator_only_writes_and_corrections_and_hidden_book_access(ledger):
    client, db, actor, _, other, _ = ledger
    _, detail = send(client)
    url = f"{BOOKS}/{detail['id']}"
    actor[0] = other
    error(client.get(url), 404, "BOOK_NOT_FOUND")
    error(client.put(f"{url}/content", json=CONTENT), 404, "BOOK_NOT_FOUND")
    book = db.get(Book, detail["id"])
    book.distribution = "organization"
    db.commit()
    assert client.get(url).status_code == 200
    assert client.put(f"{url}/content", json=CONTENT).status_code == 403
    assert client.post(f"{url}/corrections").status_code == 403


def test_signed_revision_requires_correction_and_preserves_selected_history(ledger):
    client, db, _, _, _, _ = ledger
    _, detail = send(client)
    url = f"{BOOKS}/{detail['id']}"
    error(client.post(f"{url}/corrections"), 409, "REVISION_NOT_SIGNED")
    sign(db, detail)
    error(client.put(f"{url}/content", json=CONTENT), 409, "REVISION_LOCKED")
    book = db.get(Book, detail["id"])
    book.approval_state = "approved"
    db.commit()
    response = client.post(f"{url}/corrections")
    assert response.status_code == 201, response.text
    corrected = response.json()
    assert corrected["approval_state"] == "none"
    assert corrected["subjects"] == detail["subjects"]
    assert corrected["body_html"] == detail["body_html"]
    assert corrected["content_sha256"] == detail["content_sha256"]
    first, second = corrected["revisions"]
    assert first["superseded"] and first["locked"]
    assert second["version_no"] == 2 and second["trigger"] == "correction"
    assert not second["superseded"] and not second["locked"]
    assert len(saves(db, second["version_id"])) == 1
    assert (
        db.scalar(
            select(AuditLog).where(
                AuditLog.action == "ledger_book_correction_started",
                AuditLog.entity_id == str(book.id),
            )
        )
        is not None
    )
    updated = {"subjects": ["Correction"], "body_html": "<p>Corrected body</p>"}
    assert client.put(f"{url}/content", json=updated).status_code == 200
    old = client.get(url, params={"revision": first["version_id"]}).json()
    assert old["selected_version_id"] == first["version_id"]
    assert old["body_html"] == CONTENT["body_html"]
    assert client.get(url).json()["body_html"] == updated["body_html"]


@pytest.mark.parametrize("state", ["voided_at", "deleted_at"])
def test_voided_or_deleted_books_cannot_be_edited(ledger, state):
    client, db, _, _, _, _ = ledger
    _, detail = send(client)
    setattr(db.get(Book, detail["id"]), state, datetime(2026, 1, 1))
    db.commit()
    error(
        client.put(f"{BOOKS}/{detail['id']}/content", json=CONTENT),
        409,
        "BOOK_VOIDED" if state == "voided_at" else "BOOK_DELETED",
    )


def test_version_scoped_reader_cannot_see_newer_revision_or_its_saves(ledger):
    client, db, actor, _, other, _ = ledger
    _, detail = send(client)
    sign(db, detail)
    corrected = client.post(f"{BOOKS}/{detail['id']}/corrections").json()
    v1, v2 = [revision["version_id"] for revision in corrected["revisions"]]
    db.add(
        BookRevisionAccess(
            version_id=v1,
            user_id=other.id,
            kind="reviewer",
            state="reviewed",
            decided_at=datetime(2026, 1, 1),
        )
    )
    db.commit()
    actor[0] = other
    url = f"{BOOKS}/{detail['id']}"
    response = client.get(url)
    assert response.status_code == 200, response.text
    assert response.json()["selected_version_id"] == v1
    assert [row["version_id"] for row in response.json()["revisions"]] == [v1]
    assert client.get(f"{url}/revisions/{v1}/saves").status_code == 200
    assert client.get(url, params={"revision": v2}).status_code in (403, 404)
    assert client.get(f"{url}/revisions/{v2}/saves").status_code in (403, 404)
    assert client.get(f"{url}/paper", params={"revision": v1}).status_code == 200
    assert client.get(f"{url}/paper", params={"revision": v2}).status_code in (403, 404)


def test_papers_follow_read_access_and_are_hardened(ledger):
    client, db, actor, owner, other, _ = ledger
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT}).json()
    draft_paper = client.get(f"{DRAFTS}/{draft['id']}/paper")
    assert draft_paper.status_code == 200, draft_paper.text
    assert "DRAFT" in draft_paper.text and draft["draft_number"] in draft_paper.text
    assert "*GSSG+" not in draft_paper.text

    _, detail = send(client, grade="top_secret")
    paper = client.get(f"{BOOKS}/{detail['id']}/paper")
    assert paper.status_code == 200, paper.text
    assert paper.headers["content-security-policy"].startswith("sandbox allow-same-origin")
    assert paper.headers["cache-control"] == "no-store"
    assert detail["ref_number"] in paper.text and "Second subject" in paper.text
    assert (owner.display_name or owner.email) in paper.text  # Secret viewer watermark

    actor[0] = other
    error(client.get(f"{DRAFTS}/{draft['id']}/paper"), 404, "DRAFT_NOT_FOUND")
    assert client.get(f"{BOOKS}/{detail['id']}/paper").status_code == 404


@pytest.mark.parametrize(
    ("method", "suffix", "payload"),
    [
        ("get", "", None),
        ("put", "/content", CONTENT),
        ("get", "/revisions/1/saves", None),
        ("post", "/corrections", None),
        ("get", "/images/00000000000000000000000000000000.png", None),
        ("get", "/paper", None),
    ],
)
def test_non_ledger_books_are_not_exposed_by_ledger_routes(ledger, method, suffix, payload):
    client, db, _, owner, _, _ = ledger
    db.add(BookCategory(id="plain", prefix="P"))
    book = Book(category_id="plain", ref_number="P/1", created_by_user_id=owner.id)
    db.add(book)
    db.commit()
    kwargs = {"json": payload} if payload is not None else {}
    error(client.request(method, f"{BOOKS}/{book.id}{suffix}", **kwargs), 404, "BOOK_NOT_FOUND")


def test_denied_classification_hides_organization_visible_ledger_book(ledger):
    client, db, actor, _, other, _ = ledger
    _, detail = send(client)
    book = db.get(Book, detail["id"])
    book.distribution = "organization"
    db.commit()
    actor[0] = other
    assert client.get(f"{BOOKS}/{book.id}").status_code == 200
    visible = client.get("/api/v1/books")
    assert visible.status_code == 200, visible.text
    assert book.id in [row["id"] for row in visible.json()["items"]]
    db.add(UserPermission(user_id=other.id, capability="books.category.5/1", effect="deny"))
    db.commit()
    other._effective_caps_cache = None
    response = client.get(f"{BOOKS}/{book.id}")
    assert response.status_code in (403, 404), response.text
    if response.status_code == 403:
        assert response.json()["error"]["code"] == "RECORD_TYPE_FORBIDDEN"
    response = client.get("/api/v1/books")
    assert response.status_code == 200, response.text
    assert book.id not in [row["id"] for row in response.json()["items"]]
