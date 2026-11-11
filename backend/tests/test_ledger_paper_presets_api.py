"""Ledger paper presets, the bottom block and the preview PDFs through HTTP."""

import base64
from datetime import datetime

import pytest
from sqlalchemy import select

from app.db.models import (
    Book,
    BookFolder,
    BookFolderItem,
    BookLink,
    BookVersion,
    Employee,
    User,
    UserPermission,
)
from app.services import ledger_book_service, sheet_pdf_service
from tests.test_ledger_book_api import BOOKS, CONTENT, DRAFTS, addressees_payload, error, send
from tests.test_ledger_book_api import ledger as ledger
from tests.test_ledger_book_signing_api import saved_signature

FAKE_PDF = b"%PDF-1.7 fake"


def folder(db, *, owner_id, box="outgoing", name="Contracts"):
    row = BookFolder(owner_user_id=owner_id, name=name, box=box, created_by_user_id=owner_id or 1)
    db.add(row)
    db.commit()
    return row


def foreign_book(client, actor, owner, other):
    """A book ``owner`` cannot open: written by ``other``, addressed elsewhere."""
    actor[0] = other
    _, detail = send(client)
    actor[0] = owner
    return detail


def new_draft(client, **changes):
    response = client.post(
        DRAFTS, json={"tab": 5, **CONTENT, **addressees_payload(client), **changes}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_draft_carries_preset_references_and_folders(ledger):
    client, db, _actor, owner, _, _ = ledger
    _, target = send(client)
    own = folder(db, owner_id=owner.id)
    team = folder(db, owner_id=None, name="Team")
    draft = new_draft(client, paper_preset="report", reference_book_ids=[target["id"]])
    assert draft["paper_preset"] == "report"
    assert draft["reference_book_ids"] == [target["id"]]
    assert draft["folder_ids"] == []
    url = f"{DRAFTS}/{draft['id']}"
    patched = client.patch(url, json={"paper_preset": "normal", "folder_ids": [team.id, own.id]})
    assert patched.status_code == 200, patched.text
    assert patched.json()["paper_preset"] == "normal"
    assert patched.json()["folder_ids"] == [team.id, own.id]
    assert patched.json()["reference_book_ids"] == [target["id"]]
    assert client.get(url).json() == patched.json()
    assert new_draft(client)["paper_preset"] == "normal"


def test_invalid_references_and_folders_leave_the_draft_unchanged(ledger):
    client, db, actor, owner, other, _ = ledger
    _, target = send(client)
    hidden = foreign_book(client, actor, owner, other)
    incoming = folder(db, owner_id=owner.id, box="incoming")
    theirs = folder(db, owner_id=other.id)
    own = folder(db, owner_id=owner.id)
    draft = new_draft(client)
    url = f"{DRAFTS}/{draft['id']}"
    for values, code in [
        ({"reference_book_ids": [target["id"], target["id"]]}, "REFERENCE_INVALID"),
        ({"reference_book_ids": [hidden["id"]]}, "REFERENCE_INVALID"),
        ({"reference_book_ids": [999999]}, "REFERENCE_INVALID"),
        ({"folder_ids": [incoming.id]}, "FOLDER_INVALID"),
        ({"folder_ids": [theirs.id]}, "FOLDER_INVALID"),
        ({"folder_ids": [own.id, own.id]}, "FOLDER_INVALID"),
        ({"folder_ids": [999999]}, "FOLDER_INVALID"),
    ]:
        error(client.patch(url, json={"subjects": ["Lost edit"], **values}), 422, code)
        assert client.get(url).json() == draft
    error(
        client.post(DRAFTS, json={"tab": 5, "reference_book_ids": [hidden["id"]]}),
        422,
        "REFERENCE_INVALID",
    )
    too_many = client.patch(url, json={"reference_book_ids": list(range(1, 22))})
    assert too_many.status_code == 422
    assert client.patch(url, json={"folder_ids": list(range(1, 12))}).status_code == 422


def test_save_and_send_pins_preset_links_references_and_files_folders(ledger):
    client, db, _actor, owner, _other, _ = ledger
    _, first = send(client)
    _, second = send(client)
    own = folder(db, owner_id=owner.id, name="Own <file>")
    team = folder(db, owner_id=None, name="Team")
    draft = new_draft(
        client,
        paper_preset="report",
        reference_book_ids=[second["id"], first["id"]],
        folder_ids=[own.id, team.id],
    )
    response = client.post(f"{DRAFTS}/{draft['id']}/save-and-send")
    assert response.status_code == 200, response.text
    book = response.json()
    version = db.get(BookVersion, book["selected_version_id"])
    assert (version.paper_preset, version.paper_layout) == ("report", 1)
    links = db.scalars(select(BookLink).where(BookLink.book_id == book["id"])).all()
    assert {(link.target_book_id, link.kind, link.attached) for link in links} == {
        (second["id"], "reference", True),
        (first["id"], "reference", True),
    }
    filed = db.scalars(select(BookFolderItem).where(BookFolderItem.book_id == book["id"])).all()
    assert {item.folder_id for item in filed} == {own.id, team.id}
    assert book["paper_preset"] == "report"
    assert [(r["book_id"], r["ref"], r["can_open"]) for r in book["references"]] == [
        (second["id"], second["ref_number"], True),
        (first["id"], first["ref_number"], True),
    ]
    assert book["references"][0]["date"] == datetime.now().strftime("%Y-%m-%d")
    assert book["folders"] == [
        {"id": own.id, "name": "Own <file>"},
        {"id": team.id, "name": "Team"},
    ]

    # The issued book keeps its folder names even if a folder is renamed later.
    own.name = "Renamed"
    db.commit()
    paper = client.get(f"{BOOKS}/{book['id']}/paper").text
    assert paper.index("إعداد") < paper.index("إشارة إلى:") < paper.index(second["ref_number"])
    assert paper.index(second["ref_number"]) < paper.index(first["ref_number"])
    assert paper.index("نسخة إلى الملف:") < paper.index("Own &lt;file&gt;")
    assert "Renamed" not in paper


def test_reader_who_cannot_open_a_reference_still_sees_its_ref(ledger):
    client, db, actor, _owner, other, _ = ledger
    _, target = send(client)
    draft = new_draft(client, reference_book_ids=[target["id"]])
    book = client.post(f"{DRAFTS}/{draft['id']}/save-and-send").json()
    db.get(Book, book["id"]).distribution = "organization"
    db.commit()
    actor[0] = other
    read = client.get(f"{BOOKS}/{book['id']}").json()
    assert [(r["ref"], r["can_open"]) for r in read["references"]] == [
        (target["ref_number"], False)
    ]
    assert target["ref_number"] in client.get(f"{BOOKS}/{book['id']}/paper").text


def test_secret_reference_raises_the_floor_before_save_and_send(ledger):
    client, db, _actor, _owner, _, _ = ledger
    for user in db.scalars(select(User)).all():  # the writer and the To addressee
        db.add(UserPermission(user_id=user.id, capability="books.secret", effect="grant"))
        user._effective_caps_cache = None
    db.commit()
    _, target = send(client)
    db.get(Book, target["id"]).grade = "secret"
    db.commit()
    draft = new_draft(client, grade="unclassified", reference_book_ids=[target["id"]])
    url = f"{DRAFTS}/{draft['id']}"
    error(client.post(f"{url}/save-and-send"), 422, "GRADE_BELOW_FLOOR")
    assert client.get(url).status_code == 200  # rolled back: the draft survives
    assert db.scalar(select(BookLink).where(BookLink.target_book_id == target["id"])) is None
    assert client.patch(url, json={"grade": "secret"}).status_code == 200
    sent = client.post(f"{url}/save-and-send")
    assert sent.status_code == 200, sent.text
    assert sent.json()["grade"] == "secret"


def test_correction_inherits_preset_and_layout(ledger, monkeypatch):
    client, db, actor, owner, _, root = ledger
    draft = new_draft(client, paper_preset="report")
    book = client.post(f"{DRAFTS}/{draft['id']}/save-and-send").json()
    signing_user = db.get(User, db.get(Book, book["id"]).approval_steps[0].assignee_user_id)
    saved_signature(db, signing_user, root, monkeypatch)
    actor[0] = signing_user
    assert client.post(f"{BOOKS}/{book['id']}/sign").status_code == 200
    actor[0] = owner
    corrected = client.post(f"{BOOKS}/{book['id']}/corrections")
    assert corrected.status_code == 201, corrected.text
    version = db.get(BookVersion, corrected.json()["selected_version_id"])
    assert (version.paper_preset, version.paper_layout) == ("report", 1)
    assert corrected.json()["paper_preset"] == "report"


def test_paper_layout_pins_rendering(ledger):
    client, db, _, owner, _, _ = ledger
    _, book = send(client)
    version = db.get(BookVersion, book["selected_version_id"])
    assert version.paper_layout == 1
    version.paper_layout = 99  # a layout this build does not know
    db.commit()
    with pytest.raises(ValueError, match="layout"):
        ledger_book_service.book_paper(db, owner, book["id"])


def test_draft_paper_prints_report_and_bottom_block(ledger):
    client, db, _, owner, _, _ = ledger
    _, target = send(client)
    own = folder(db, owner_id=owner.id, name="Contracts")
    draft = new_draft(
        client,
        paper_preset="report",
        reference_book_ids=[target["id"]],
        folder_ids=[own.id],
    )
    paper = client.get(f"{DRAFTS}/{draft['id']}/paper").text
    assert ">تقرير<" in paper and "تحية طيبة وبعد،" not in paper
    assert paper.index("إعداد") < paper.index("إشارة إلى:") < paper.index("نسخة إلى الملف:")
    today = datetime.now().strftime("%d/%m/%Y")
    assert f'كتاب رقم <span class="ref">{target["ref_number"]}</span> بتاريخ {today}' in paper
    assert paper.index("نسخة إلى الملف:") < paper.index("Contracts")


def capture_pdf(monkeypatch):
    printed: list[str] = []

    def printer(html):
        printed.append(html)
        return FAKE_PDF

    monkeypatch.setattr(sheet_pdf_service, "print_document", printer)
    return printed


def test_draft_pdf_is_owner_only_and_uses_local_assets(ledger, monkeypatch):
    client, _, actor, _, other, _ = ledger
    printed = capture_pdf(monkeypatch)
    draft = new_draft(client)
    url = f"{DRAFTS}/{draft['id']}/paper.pdf"
    response = client.get(url)
    assert response.status_code == 200, response.text
    assert response.content == FAKE_PDF
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "/api/v1/ledger/paper-assets" not in printed[0]
    assert "file:" in printed[0] and "DRAFT" in printed[0]
    encoded = client.get(url, params={"encoding": "base64"})
    assert encoded.status_code == 200
    assert encoded.headers["content-type"].startswith("text/plain")
    assert base64.b64decode(encoded.content) == FAKE_PDF
    assert encoded.headers["cache-control"] == "no-store"
    actor[0] = other
    error(client.get(url), 404, "DRAFT_NOT_FOUND")


def test_book_pdf_follows_paper_read_access_and_revision(ledger, monkeypatch):
    client, _db, actor, _, other, _ = ledger
    printed = capture_pdf(monkeypatch)
    _, book = send(client)
    url = f"{BOOKS}/{book['id']}/paper.pdf"
    response = client.get(url, params={"revision": book["selected_version_id"]})
    assert response.status_code == 200, response.text
    assert response.content == FAKE_PDF
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["cache-control"] == "no-store"
    assert book["ref_number"] in printed[0]
    encoded = client.get(url, params={"encoding": "base64"})
    assert base64.b64decode(encoded.content) == FAKE_PDF
    error(client.get(url, params={"revision": 999999}), 404, "VERSION_NOT_FOUND")
    actor[0] = other
    error(client.get(url), 404, "BOOK_NOT_FOUND")
    assert len(printed) == 2


def test_signed_reference_paper_survives_target_correction_with_live_access(ledger, monkeypatch):
    client, db, actor, owner, other, root = ledger
    _, target = send(client)
    target_version = db.get(BookVersion, target["selected_version_id"])
    target_version.fields = {**target_version.fields, "date": "10-11-2026"}
    db.commit()
    signer = db.get(User, target["signer"]["user_id"])
    saved_signature(db, signer, root, monkeypatch)

    def sign_book(detail):
        actor[0] = signer
        response = client.post(f"{BOOKS}/{detail['id']}/sign")
        assert response.status_code == 200, response.text
        actor[0] = owner
        return response.json()

    sign_book(target)
    draft = new_draft(
        client, reference_book_ids=[target["id"]], addressees=[{"role": "to", "user_id": other.id}]
    )
    sent = client.post(f"{DRAFTS}/{draft['id']}/save-and-send")
    assert sent.status_code == 200, sent.text
    book = sign_book(sent.json())
    version_id = book["selected_version_id"]
    url = f"{BOOKS}/{book['id']}"
    paper = client.get(f"{url}/paper", params={"revision": version_id})
    assert paper.status_code == 200, paper.text
    assert "10/11/2026" in paper.text

    correction = client.post(f"{BOOKS}/{target['id']}/corrections")
    assert correction.status_code == 201, correction.text
    newer = db.get(BookVersion, correction.json()["selected_version_id"])
    newer.fields = {**newer.fields, "date": "11-11-2026"}
    db.commit()
    assert client.get(f"{url}/paper", params={"revision": version_id}).text == paper.text
    read = client.get(url, params={"revision": version_id}).json()
    assert read["references"] == [
        {
            "book_id": target["id"],
            "ref": target["ref_number"],
            "date": "2026-11-10",
            "can_open": True,
        }
    ]

    # Current access changes independently of the printed snapshot.
    actor[0] = other
    read = client.get(url, params={"revision": version_id})
    assert read.status_code == 200, read.text
    assert read.json()["references"][0]["can_open"] is False
    assert read.json()["references"][0]["date"] == "2026-11-10"
    assert "subjects" not in read.json()["references"][0]
    actor[0] = owner
    own_correction = client.post(f"{url}/corrections")
    assert own_correction.status_code == 201, own_correction.text
    assert own_correction.json()["references"][0]["date"] == "2026-11-11"
    assert client.get(f"{url}/paper", params={"revision": version_id}).text == paper.text
    assert client.post(f"{url}/resubmit").status_code == 200
    corrected = sign_book(own_correction.json())
    assert db.get(BookVersion, corrected["selected_version_id"]).fields["_ledger_references"] == [
        {"book_id": target["id"], "ref": target["ref_number"], "date": "2026-11-11"}
    ]
    db.get(Book, target["id"]).deleted_at = datetime(2026, 11, 12)
    db.commit()
    old = client.get(url, params={"revision": version_id}).json()
    assert old["references"][0]["date"] == "2026-11-10"
    assert old["references"][0]["can_open"] is False
    assert client.get(f"{url}/paper", params={"revision": version_id}).text == paper.text


def test_legacy_signed_reference_without_snapshot_uses_live_fallback(ledger):
    from tests.test_ledger_book_api import sign

    client, db, _, owner, _, _ = ledger
    _, target = send(client)
    draft = new_draft(client, reference_book_ids=[target["id"]])
    book = client.post(f"{DRAFTS}/{draft['id']}/save-and-send").json()
    sign(db, book)
    target_version = db.get(BookVersion, target["selected_version_id"])
    target_version.fields = {**target_version.fields, "date": "10-11-2026"}
    db.commit()
    read = client.get(f"{BOOKS}/{book['id']}")
    assert read.status_code == 200, read.text
    assert read.json()["references"][0]["date"] == "2026-11-10"
    owner.display_name = "Current legacy writer"
    version = db.get(BookVersion, book["selected_version_id"])
    version.paper_preset = "report"
    db.commit()
    assert "Current legacy writer" in client.get(f"{BOOKS}/{book['id']}/paper").text
    assert "_ledger_references" not in version.fields
    assert "_ledger_writer" not in version.fields


def test_signed_writer_identity_survives_profile_relink_and_correction(ledger, monkeypatch):
    client, db, actor, owner, _, root = ledger
    db.add_all(
        [
            Employee(id="G901", name_en="Original Writer", name_ar="الكاتب الأصلي"),
            Employee(id="G902", name_en="Renamed Writer", name_ar="الكاتب الجديد"),
        ]
    )
    db.commit()
    owner.employee_id = "G901"
    db.commit()
    _, book = send(client, paper_preset="report")
    signer = db.get(User, book["signer"]["user_id"])
    saved_signature(db, signer, root, monkeypatch)
    actor[0] = signer
    signed = client.post(f"{BOOKS}/{book['id']}/sign")
    assert signed.status_code == 200, signed.text
    actor[0] = owner
    url = f"{BOOKS}/{book['id']}"
    version_id = book["selected_version_id"]
    original = client.get(f"{url}/paper", params={"revision": version_id}).text
    assert "الكاتب الأصلي" in original and "G901" in original
    owner.employee_id = "G902"
    owner.display_name = "Changed profile name"
    db.commit()
    assert client.get(f"{url}/paper", params={"revision": version_id}).text == original
    correction = client.post(f"{url}/corrections")
    assert correction.status_code == 201, correction.text
    current = client.get(f"{url}/paper").text
    assert "الكاتب الجديد" in current and "G902" in current
    assert "الكاتب الأصلي" not in current
    assert client.get(f"{url}/paper", params={"revision": version_id}).text == original
