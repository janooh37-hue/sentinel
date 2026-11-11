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
    Manager,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.services import book_service, ledger_book_service, push_service, user_signature_service
from tests.conftest import make_user

DRAFTS = "/api/v1/ledger/drafts"
BOOKS = "/api/v1/ledger/books"
PNG = b"\x89PNG\r\n\x1a\npayload"
CONTENT = {
    "addressed_to": "Printed office",
    "subjects": ["First subject", "Second subject"],
    "body_html": "<p>Original body</p>",
}


@pytest.fixture
def ledger(api_db, tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(ledger_book_service, "get_settings", lambda: settings)
    monkeypatch.setattr(book_service, "get_settings", lambda: settings)
    owner = make_user(api_db, role="manager", email="writer@example.ae")
    owner.display_name = "Ledger Writer"
    other = make_user(api_db, role="manager", email="reader@example.ae")
    signing_user = make_user(api_db, role="manager", email="signer@example.ae")
    api_db.add(Manager(name_en="Default signing manager", user_id=signing_user.id))
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


def addressees_payload(client):
    manager = client.get("/api/v1/managers").json()[0]
    return {
        "signer_manager_id": manager["id"],
        "addressees": [{"role": "to", "user_id": manager["user_id"]}],
    }


def send(client, **changes):
    draft_response = client.post(
        DRAFTS, json={"tab": 5, **CONTENT, **addressees_payload(client), **changes}
    )
    assert draft_response.status_code == 201, draft_response.text
    draft = draft_response.json()
    response = client.post(f"{DRAFTS}/{draft['id']}/save-and-send")
    assert response.status_code == 200, response.text
    return draft, response.json()


def content_payload(detail, content):
    return {
        "addressed_to": detail.get("addressed_to") or "Printed office",
        **content,
        "expected_version_id": detail["selected_version_id"],
        "expected_content_sha256": detail["content_sha256"],
    }


def sign_payload(detail):
    return {
        "expected_version_id": detail["selected_version_id"],
        "expected_content_sha256": detail["content_sha256"],
    }


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
    assert (book.grade, book.importance, book.approval_state) == ("top_secret", "high", "pending")
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
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT, **addressees_payload(client)}).json()
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
    response = client.put(f"{url}/content", json=content_payload(detail, payload))
    assert response.status_code == 200, response.text
    current = response.json()
    assert current["body_html"] == "<p>Edited</p>"
    assert current["subjects"] == payload["subjects"]
    history = saves(db, detail["selected_version_id"])
    assert len(history) == 2
    assert history[0].body_html == CONTENT["body_html"]
    assert client.put(f"{url}/content", json=content_payload(current, payload)).json() == current
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
    error(
        client.put(f"{url}/content", json=content_payload(detail, CONTENT)), 404, "BOOK_NOT_FOUND"
    )
    book = db.get(Book, detail["id"])
    book.distribution = "organization"
    db.commit()
    assert client.get(url).status_code == 200
    assert client.put(f"{url}/content", json=content_payload(detail, CONTENT)).status_code == 403
    assert client.post(f"{url}/corrections").status_code == 403


def test_signed_revision_requires_correction_and_preserves_selected_history(ledger):
    client, db, _, _, _, _ = ledger
    _, detail = send(client)
    url = f"{BOOKS}/{detail['id']}"
    error(client.post(f"{url}/corrections"), 409, "REVISION_NOT_SIGNED")
    sign(db, detail)
    error(
        client.put(f"{url}/content", json=content_payload(detail, CONTENT)), 409, "REVISION_LOCKED"
    )
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
    assert client.put(f"{url}/content", json=content_payload(corrected, updated)).status_code == 200
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
        client.put(f"{BOOKS}/{detail['id']}/content", json=content_payload(detail, CONTENT)),
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
    client, _db, actor, owner, other, _ = ledger
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
    assert (owner.display_name or owner.email) not in paper.text

    actor[0] = other
    error(client.get(f"{DRAFTS}/{draft['id']}/paper"), 404, "DRAFT_NOT_FOUND")
    assert client.get(f"{BOOKS}/{detail['id']}/paper").status_code == 404


@pytest.mark.parametrize(
    ("method", "suffix", "payload"),
    [
        ("get", "", None),
        (
            "put",
            "/content",
            {**CONTENT, "expected_version_id": 1, "expected_content_sha256": "0" * 64},
        ),
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
    client, db, actor, owner, other, root = ledger
    monkeypatch.setattr(push_service, "send_to_user", lambda *args, **kwargs: None)
    _, ledger_book = send(
        client, importance="high", addressees=[{"role": "to", "user_id": other.id}]
    )
    signer = db.get(User, ledger_book["signer"]["user_id"])
    root.mkdir(parents=True, exist_ok=True)
    (root / "test-signature.png").write_bytes(PNG)
    signer.signature_path = "test-signature.png"
    db.commit()
    monkeypatch.setattr(user_signature_service, "get_settings", lambda: Settings(data_dir=root))
    actor[0] = signer
    signed = client.post(f"{BOOKS}/{ledger_book['id']}/sign", json=sign_payload(ledger_book))
    assert signed.status_code == 200, signed.text
    actor[0] = owner
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
    for book_id in (word.id,):
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


@pytest.mark.parametrize("legacy", [False, True])
def test_signed_grade_and_paper_survive_correction_regrade(ledger, monkeypatch, legacy):
    from app.services import book_send_service

    client, db, actor, owner, _, root = ledger
    _, detail = send(client, grade="top_secret")
    url = f"{BOOKS}/{detail['id']}"
    signature = root / "signature.png"
    signature.parent.mkdir(parents=True, exist_ok=True)
    signature.write_bytes(PNG)
    monkeypatch.setattr(user_signature_service, "resolve_signature", lambda user: signature)
    monkeypatch.setattr(push_service, "send_to_user", lambda *args, **kwargs: None)
    actor[0] = db.get(User, detail["signer"]["user_id"])
    response = client.post(f"{url}/sign", json=sign_payload(detail))
    assert response.status_code == 200, response.text
    version_id = detail["selected_version_id"]
    version = db.get(BookVersion, version_id)
    if legacy:
        version.fields = {k: v for k, v in version.fields.items() if k != "_ledger_grade"}
        db.commit()
    else:
        assert version.fields["_ledger_grade"] == "top_secret"
    actor[0] = owner
    old_paper = client.get(f"{url}/paper", params={"revision": version_id}).text
    assert client.post(f"{url}/corrections").status_code == 201
    book = db.get(Book, detail["id"])
    book_send_service.set_grade(db, owner, book, "unclassified")
    assert client.get(url).json()["grade"] == "unclassified"
    assert client.get(url, params={"revision": version_id}).json()["grade"] == "top_secret"
    assert client.get(f"{url}/paper", params={"revision": version_id}).text == old_paper
    assert db.get(BookVersion, version_id).fields["_ledger_grade"] == "top_secret"


def test_grade_change_freezes_legacy_signed_revision_before_mutation(ledger):
    from app.services import book_send_service

    client, db, _, owner, _, _ = ledger
    _, detail = send(client, grade="top_secret")
    sign(db, detail)
    assert client.post(f"{BOOKS}/{detail['id']}/corrections").status_code == 201
    version = db.get(BookVersion, detail["selected_version_id"])
    version.fields = {k: v for k, v in version.fields.items() if k != "_ledger_grade"}
    db.commit()
    book_send_service.set_grade(db, owner, db.get(Book, detail["id"]), "unclassified")
    assert version.fields["_ledger_grade"] == "top_secret"


def test_downgrade_does_not_grant_historical_sensitive_revision_access(ledger):
    from app.services import book_send_service

    client, db, actor, owner, _, root = ledger
    _, detail = send(client, grade="top_secret")
    version_id = detail["selected_version_id"]
    image_name = "00000000000000000000000000000000.png"
    image_src = f"{BOOKS}/{detail['id']}/images/{image_name}"
    image_path = root / "book_attachments" / str(detail["id"]) / "images" / image_name
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(PNG)
    assert (
        client.put(
            f"{BOOKS}/{detail['id']}/content",
            json=content_payload(
                detail, {**CONTENT, "body_html": f'<p>Private image</p><img src="{image_src}">'}
            ),
        ).status_code
        == 200
    )
    sign(db, detail)
    url = f"{BOOKS}/{detail['id']}"
    correction = client.post(f"{url}/corrections")
    assert correction.status_code == 201, correction.text
    assert (
        client.put(f"{url}/content", json=content_payload(correction.json(), CONTENT)).status_code
        == 200
    )
    book = db.get(Book, detail["id"])
    book_send_service.set_grade(db, owner, book, "unclassified")
    # Admins can open Unclassified records but need to be named for Top Secret.
    admin = make_user(db, role="admin", email="grade-history-admin@test.ae")
    actor[0] = admin
    current = client.get(url)
    assert current.status_code == 200, current.text
    assert [r["version_no"] for r in current.json()["revisions"]] == [2]
    for suffix in ("", "/paper"):
        assert client.get(f"{url}{suffix}", params={"revision": version_id}).status_code == 404
    assert client.get(f"{url}/revisions/{version_id}/saves").status_code == 404
    assert client.get(image_src).status_code == 404
    # Explicit retained revision access still opens the signed revision.
    db.add(
        BookRevisionAccess(
            version_id=version_id,
            user_id=admin.id,
            kind="reviewer",
            state="reviewed",
            decided_at=datetime(2026, 1, 2),
        )
    )
    db.commit()
    old = client.get(url, params={"revision": version_id})
    assert old.status_code == 200, old.text
    assert old.json()["grade"] == "top_secret"
    assert client.get(image_src).status_code == 200


@pytest.mark.parametrize("stale", ["revision", "revision_same_content", "content"])
def test_stale_content_save_cannot_overwrite_newer_revision_or_content(ledger, stale):
    client, db, _, _, _, _ = ledger
    _, opened = send(client)
    url = f"{BOOKS}/{opened['id']}"
    current = opened
    if stale.startswith("revision"):
        sign(db, opened)
        correction = client.post(f"{url}/corrections")
        assert correction.status_code == 201, correction.text
        current = correction.json()
    updated = (
        CONTENT
        if stale == "revision_same_content"
        else {"subjects": ["New correction"], "body_html": "<p>Corrected instructions</p>"}
    )
    accepted = client.put(f"{url}/content", json=content_payload(current, updated))
    assert accepted.status_code == 200, accepted.text
    current = accepted.json()
    paper = client.get(f"{url}/paper").text
    book = db.get(Book, opened["id"])
    before = (
        book.subject,
        book.search_text,
        [(v.id, [save.id for save in saves(db, v.id)]) for v in book.versions],
    )
    stale_body = {"subjects": ["Old tab"], "body_html": "<p>Original instructions with edits</p>"}
    response = client.put(f"{url}/content", json=content_payload(opened, stale_body))
    error(response, 409, "CONTENT_CONFLICT")
    db.expire_all()
    book = db.get(Book, opened["id"])
    assert (
        book.subject,
        book.search_text,
        [(v.id, [save.id for save in saves(db, v.id)]) for v in book.versions],
    ) == before
    read = client.get(url).json()
    assert read["selected_version_id"] == current["selected_version_id"]
    assert read["content_sha256"] == current["content_sha256"]
    assert read["subjects"] == updated["subjects"]
    assert read["body_html"] == updated["body_html"]
    assert client.get(f"{url}/paper").text == paper


@pytest.mark.parametrize("missing", ["expected_version_id", "expected_content_sha256"])
def test_content_save_requires_both_expected_values(ledger, missing):
    client, db, _, _, _, _ = ledger
    _, opened = send(client)
    payload = content_payload(opened, CONTENT)
    del payload[missing]
    response = client.put(f"{BOOKS}/{opened['id']}/content", json=payload)
    assert response.status_code == 422, response.text
    assert len(saves(db, opened["selected_version_id"])) == 1


@pytest.mark.parametrize("preset", ["normal", "report"])
def test_printed_direction_is_independent_tracked_and_signed(ledger, monkeypatch, preset):
    client, db, actor, writer, signer, root = ledger
    from tests.test_ledger_book_signing_api import saved_signature

    draft = client.post(
        DRAFTS,
        json={
            "tab": 5,
            **CONTENT,
            **addressees_payload(client),
            "addressed_to": "مدير إدارة الموارد البشرية",
            "paper_preset": preset,
        },
    )
    assert draft.status_code == 201, draft.text
    assert draft.json()["addressed_to"] == "مدير إدارة الموارد البشرية"
    preview = client.get(f"{DRAFTS}/{draft.json()['id']}/paper")
    assert "مدير إدارة الموارد البشرية" in preview.text
    issued = client.post(f"{DRAFTS}/{draft.json()['id']}/save-and-send")
    assert issued.status_code == 200, issued.text
    book = issued.json()
    assert book["addressed_to"] == "مدير إدارة الموارد البشرية"
    assert book["addressees"][0]["user_id"] != writer.id
    changed = client.put(
        f"{BOOKS}/{book['id']}/content",
        json={**content_payload(book, CONTENT), "addressed_to": "<مدير جديد>"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["content_sha256"] != book["content_sha256"]
    book = changed.json()
    signer = db.get(User, book["signer"]["user_id"])
    saved_signature(db, signer, root, monkeypatch)
    actor[0] = signer
    error(
        client.post(f"{BOOKS}/{book['id']}/sign", json=sign_payload(issued.json())),
        409,
        "SIGNING_CONTENT_CONFLICT",
    )
    signed = client.post(f"{BOOKS}/{book['id']}/sign", json=sign_payload(book))
    assert signed.status_code == 200, signed.text
    actor[0] = writer
    url = f"{BOOKS}/{book['id']}"
    original = client.get(f"{url}/paper").text
    assert "&lt;مدير جديد&gt;" in original
    correction = client.post(f"{url}/corrections").json()
    assert correction["addressed_to"] == "<مدير جديد>"
    changed = client.put(
        f"{url}/content",
        json={**content_payload(correction, CONTENT), "addressed_to": "Another office"},
    )
    assert changed.status_code == 200, changed.text
    assert (
        client.get(f"{url}/paper", params={"revision": book["selected_version_id"]}).text
        == original
    )


def test_issuance_and_content_require_nonblank_direction(ledger):
    client, _, _, _, _, _ = ledger
    draft = client.post(
        DRAFTS, json={"tab": 5, **CONTENT, **addressees_payload(client), "addressed_to": "  "}
    )
    assert draft.status_code == 201, draft.text
    error(client.post(f"{DRAFTS}/{draft.json()['id']}/save-and-send"), 422, "ADDRESSED_TO_REQUIRED")
    assert (
        client.patch(f"{DRAFTS}/{draft.json()['id']}", json={"addressed_to": "Office"}).status_code
        == 200
    )
    issued = client.post(f"{DRAFTS}/{draft.json()['id']}/save-and-send")
    assert issued.status_code == 200, issued.text
    book = issued.json()
    assert book["ref_number"] == "1/5/1"
    error(
        client.put(
            f"{BOOKS}/{book['id']}/content",
            json={**content_payload(book, CONTENT), "addressed_to": " "},
        ),
        422,
        "ADDRESSED_TO_REQUIRED",
    )
    assert client.get(f"{BOOKS}/{book['id']}").json()["content_sha256"] == book["content_sha256"]


@pytest.mark.parametrize("preset", ["normal", "report"])
def test_legacy_pending_direction_hash_and_signed_paper_are_preserved(ledger, monkeypatch, preset):
    from tests.test_ledger_book_signing_api import saved_signature

    client, db, actor, writer, _, root = ledger
    _, book = send(client, paper_preset=preset)
    save = saves(db, book["selected_version_id"])[0]
    save.addressed_to = None
    save.content_sha256 = ledger_book_service._content_sha256(save.subjects, save.body_html)
    db.commit()
    url = f"{BOOKS}/{book['id']}"
    legacy = client.get(url).json()
    assert legacy["addressed_to"] is None
    assert legacy["content_sha256"] == save.content_sha256
    before = client.get(f"{url}/paper").text
    assert "Printed office" not in before
    if preset == "normal":
        assert book["addressees"][0]["name"] in before
    else:
        assert "التوجيه:" not in before
    signer = db.get(User, book["signer"]["user_id"])
    saved_signature(db, signer, root, monkeypatch)
    actor[0] = signer
    signed = client.post(f"{url}/sign", json=sign_payload(legacy))
    assert signed.status_code == 200, signed.text
    assert signed.json()["content_sha256"] == legacy["content_sha256"]
    actor[0] = writer
    paper = client.get(f"{url}/paper").text
    correction = client.post(f"{url}/corrections").json()
    assert correction["addressed_to"] is None
    assert correction["content_sha256"] == legacy["content_sha256"]
    payload = content_payload(correction, CONTENT)
    payload["addressed_to"] = "Corrected office"
    assert client.put(f"{url}/content", json=payload).status_code == 200
    assert (
        client.get(f"{url}/paper", params={"revision": legacy["selected_version_id"]}).text == paper
    )
