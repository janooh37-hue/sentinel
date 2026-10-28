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
from app.services import book_service, ledger_book_service, push_service
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
    draft, result = send(client, grade="top_secret", importance="high")
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
    assert (book.grade, book.importance, book.approval_state) == ("top_secret", "high", "none")
    assert book.urgency == "Normal"
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


# ---------------------------------------------------------------------------
# Importance (الأهمية): Ledger Books only; Urgency is not used by them.
# ---------------------------------------------------------------------------


def test_draft_importance_defaults_to_none_and_round_trips(ledger):
    """T-B1"""
    client, _, _, _, _, _ = ledger
    blank = client.post(DRAFTS, json={"tab": 5, **CONTENT})
    assert blank.status_code == 201, blank.text
    assert blank.json()["importance"] is None
    assert "urgency" not in blank.json()
    for level in ("medium", "high"):
        created = client.post(DRAFTS, json={"tab": 5, "importance": level})
        assert created.status_code == 201, created.text
        assert created.json()["importance"] == level
        listed = {row["id"]: row for row in client.get(DRAFTS).json()}
        assert listed[created.json()["id"]]["importance"] == level


def test_draft_importance_update_sets_and_clears_and_keeps_when_absent(ledger):
    """T-B2"""
    client, _, _, _, _, _ = ledger
    draft = client.post(DRAFTS, json={"tab": 5}).json()
    url = f"{DRAFTS}/{draft['id']}"
    assert client.patch(url, json={"importance": "high"}).json()["importance"] == "high"
    # Fields not sent stay as they are.
    assert client.patch(url, json={"tab": 2}).json()["importance"] == "high"
    assert client.patch(url, json={"importance": "medium"}).json()["importance"] == "medium"
    # An explicit null clears it back to no importance.
    assert client.patch(url, json={"importance": None}).json()["importance"] is None


@pytest.mark.parametrize(
    "payload",
    [
        {"importance": "low"},
        {"importance": "High"},
        {"importance": ""},
        {"urgency": "High"},
    ],
)
def test_draft_rejects_unknown_importance_and_urgency(ledger, payload):
    """T-B3"""
    client, _, _, _, _, _ = ledger
    assert client.post(DRAFTS, json={"tab": 5, **payload}).status_code == 422
    draft = client.post(DRAFTS, json={"tab": 5}).json()
    assert client.patch(f"{DRAFTS}/{draft['id']}", json=payload).status_code == 422


@pytest.mark.parametrize("importance", [None, "medium", "high"])
def test_save_and_send_copies_importance_and_leaves_urgency_normal(ledger, importance):
    """T-B4"""
    client, db, _, _, _, _ = ledger
    _, result = send(client, importance=importance)
    assert result["importance"] == importance
    assert "urgency" not in result
    book = db.get(Book, result["id"])
    assert (book.importance, book.urgency) == (importance, "Normal")


def test_correction_revision_keeps_importance(ledger):
    """T-B5"""
    client, db, _, _, _, _ = ledger
    _, detail = send(client, importance="high")
    sign(db, detail)
    response = client.post(f"{BOOKS}/{detail['id']}/corrections")
    assert response.status_code == 201, response.text
    assert response.json()["importance"] == "high"
    assert db.get(Book, detail["id"]).importance == "high"
    assert client.get(f"{BOOKS}/{detail['id']}").json()["importance"] == "high"


def test_desk_rows_carry_importance_and_ledger_template(ledger, monkeypatch):
    """T-B7: the BooksRoutingDesk rows (inbox scopes) and the record detail."""
    client, db, actor, owner, other, _ = ledger
    monkeypatch.setattr(push_service, "send_to_user", lambda *args, **kwargs: None)
    _, ledger_book = send(client, importance="high")
    db.add(BookCategory(id="HR", prefix="HR", requires_approval=False))
    word = Book(
        category_id="HR",
        ref_number="HR-word",
        subject="Word General Book",
        direction="outgoing",
        urgency="Very High",
        distribution="named",
        created_by_user_id=owner.id,
    )
    db.add(word)
    db.flush()
    db.add(
        BookVersion(
            book_id=word.id,
            version_no=1,
            template_id="General Book",
            fields={},
            status="none",
            created_by_user_id=owner.id,
        )
    )
    db.commit()
    for book_id in (ledger_book["id"], word.id):
        response = client.post(
            f"/api/v1/books/{book_id}/send", json={"user_ids": [other.id], "purpose": "info"}
        )
        assert response.status_code == 200, response.text

    def rows(inbox):
        response = client.get("/api/v1/books", params={"inbox": inbox})
        assert response.status_code == 200, response.text
        return {row["id"]: row for row in response.json()["items"]}

    expected = {
        ledger_book["id"]: (LEDGER_BOOK_TEMPLATE_ID, "high"),
        word.id: ("General Book", None),
    }
    sent = rows("sent")
    actor[0] = other
    received = rows("received")
    for listed in (sent, received):
        assert {
            book_id: (row["current_template_id"], row["importance"])
            for book_id, row in listed.items()
        } == expected
    detail = client.get(f"/api/v1/books/{ledger_book['id']}")
    assert detail.status_code == 200, detail.text
    assert (detail.json()["current_template_id"], detail.json()["importance"]) == (
        LEDGER_BOOK_TEMPLATE_ID,
        "high",
    )
    word_detail = client.get(f"/api/v1/books/{word.id}").json()
    # Urgency is never mapped to importance on the backend (D7 is display-only).
    assert (word_detail["urgency"], word_detail["importance"]) == ("Very High", None)


@pytest.mark.parametrize("importance", [None, "medium", "high"])
def test_papers_print_no_importance_or_urgency(ledger, importance):
    """T-B6: importance is a desk mark only; neither paper prints it nor urgency."""
    client, _, _, _, _, _ = ledger
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT, "importance": importance}).json()
    draft_paper = client.get(f"{DRAFTS}/{draft['id']}/paper")
    _, detail = send(client, importance=importance)
    issued = client.get(f"{BOOKS}/{detail['id']}/paper")
    for paper in (draft_paper, issued):
        assert paper.status_code == 200, paper.text
        assert "الأهمية" not in paper.text
        assert "الاستعجال" not in paper.text
        assert 'class="urgency"' not in paper.text
