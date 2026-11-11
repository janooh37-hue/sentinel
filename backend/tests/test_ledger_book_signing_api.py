"""Ledger addressees and manager signing through the HTTP seam."""

from email import policy
from email.parser import BytesParser

import pytest

from app.config import Settings
from app.db.models import AddressBookContact, Manager, UserPermission
from app.services import email_service, push_service, sheet_pdf_service, user_signature_service
from tests.conftest import make_user
from tests.fakes.imap import FakeImapServer
from tests.test_email_routes import _account
from tests.test_ledger_book_api import (
    BOOKS,
    CONTENT,
    DRAFTS,
    PNG,
    content_payload,
    error,
    sign_payload,
)
from tests.test_ledger_book_api import ledger as ledger


def setup_signer(db, user):
    manager = Manager(
        name_en="Signing Manager", name_ar="المدير", title="Director", user_id=user.id
    )
    db.add(manager)
    db.commit()
    return manager


def test_draft_recipient_and_signer_roundtrip(ledger):
    client, db, _, _, manager_user, _ = ledger
    manager = setup_signer(db, manager_user)
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT}).json()
    values = {
        "external": False,
        "signer_manager_id": manager.id,
        "addressees": [
            {"role": "cc", "user_id": manager_user.id},
            {"role": "to", "user_id": manager_user.id},
        ],
    }
    response = client.patch(f"{DRAFTS}/{draft['id']}", json=values)
    assert response.status_code == 200, response.text
    for key, value in values.items():
        if key == "addressees":
            assert [(a["role"], a["user_id"]) for a in response.json()[key]] == [
                ("cc", manager_user.id),
                ("to", manager_user.id),
            ]
        else:
            assert response.json()[key] == value
    assert client.get(f"{DRAFTS}/{draft['id']}").json() == response.json()


def test_invalid_addressees_and_signer_leave_draft_unchanged(ledger):
    client, db, _, _, manager_user, _ = ledger
    setup_signer(db, manager_user)
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT}).json()
    url = f"{DRAFTS}/{draft['id']}"
    for values, code in [
        (
            {"subjects": ["Lost edit"], "addressees": [{"role": "to", "user_id": 999999}]},
            "ADDRESSEE_INVALID",
        ),
        ({"signer_manager_id": 999999}, "SIGNER_INVALID"),
        (
            {"external": True, "addressees": [{"role": "to", "user_id": manager_user.id}]},
            "ADDRESSEE_INVALID",
        ),
    ]:
        error(client.patch(url, json=values), 422, code)
        assert client.get(url).json() == draft


def test_save_and_send_requires_to_and_signer_without_burning_number(ledger):
    client, db, _, _, manager_user, _ = ledger
    manager = setup_signer(db, manager_user)
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT}).json()
    url = f"{DRAFTS}/{draft['id']}"
    error(client.post(f"{url}/save-and-send"), 422, "DRAFT_TO_REQUIRED")
    client.patch(url, json={"addressees": [{"role": "to", "user_id": manager_user.id}]})
    error(client.post(f"{url}/save-and-send"), 422, "DRAFT_SIGNER_REQUIRED")
    client.patch(url, json={"signer_manager_id": manager.id})
    response = client.post(f"{url}/save-and-send")
    assert response.status_code == 200, response.text
    assert response.json()["ref_number"] == "1/5/1"


def submitted(ledger):
    client, db, _, _, manager_user, _ = ledger
    manager = setup_signer(db, manager_user)
    to = make_user(db, role="manager", email="to@example.ae")
    to.display_name = "To Snapshot"
    cc = make_user(db, role="manager", email="cc@example.ae")
    cc.display_name = "CC Snapshot"
    db.commit()
    values = {
        "signer_manager_id": manager.id,
        "addressees": [{"role": "to", "user_id": to.id}, {"role": "cc", "user_id": cc.id}],
    }
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT, **values}).json()
    response = client.post(f"{DRAFTS}/{draft['id']}/save-and-send")
    assert response.status_code == 200, response.text
    return response.json(), to, cc


def test_submission_waits_for_manager_and_snapshots_addressees(ledger):
    client, db, actor, writer, manager_user, _ = ledger
    book, to, cc = submitted(ledger)
    assert book["approval_state"] == "pending"
    assert book["signer"]["user_id"] == manager_user.id
    assert [(a["role"], a["name"]) for a in book["addressees"]] == [
        ("to", "To Snapshot"),
        ("cc", "CC Snapshot"),
    ]
    url = f"{BOOKS}/{book['id']}"
    for recipient in (to, cc):
        actor[0] = recipient
        assert client.get(url).status_code == 404
        assert client.get("/api/v1/books", params={"inbox": "received"}).json()["items"] == []
    actor[0] = manager_user
    manager_read = client.get(url)
    assert manager_read.status_code == 200, manager_read.text
    assert manager_read.json()["can_sign"] and manager_read.json()["can_return"]
    work = client.get("/api/v1/books/approval-log", params={"scope": "received"})
    assert work.status_code == 200, work.text
    row = next(row for row in work.json()["items"] if row["book_id"] == book["id"])
    assert row["template"] == "ledger"
    actor[0] = writer
    to.display_name = "New directory name"
    db.commit()
    assert client.get(url).json()["addressees"][0]["name"] == "To Snapshot"


def saved_signature(db, user, root, monkeypatch):
    monkeypatch.setattr(user_signature_service, "get_settings", lambda: Settings(data_dir=root))
    image = root / "signatures" / str(user.id) / "signature.png"
    image.parent.mkdir(parents=True, exist_ok=True)
    image.write_bytes(PNG)
    user.signature_path = image.relative_to(root).as_posix()
    db.commit()


def test_manager_signs_with_own_signature_and_delivers_after_lock(ledger, monkeypatch):
    client, db, actor, writer, manager_user, root = ledger
    monkeypatch.setattr(push_service, "send_to_user", lambda *args, **kwargs: None)
    book, to, cc = submitted(ledger)
    url = f"{BOOKS}/{book['id']}"
    assert client.post(f"{url}/sign", json=sign_payload(book)).status_code == 403
    actor[0] = manager_user
    error(client.post(f"{url}/sign", json=sign_payload(book)), 422, "NO_SIGNATURE")
    saved_signature(db, manager_user, root, monkeypatch)
    response = client.post(f"{url}/sign", json=sign_payload(book))
    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "approved"
    assert response.json()["revisions"][0]["locked"]
    signature_url = f"{url}/signature?revision={book['selected_version_id']}"
    assert client.get(signature_url).content == PNG
    paper = client.get(f"{url}/paper").text
    assert signature_url in paper
    assert "المدير" in paper and "Director" in paper
    assert "To Snapshot" in paper and "CC Snapshot" in paper
    actor[0] = writer
    error(client.put(f"{url}/content", json=content_payload(book, CONTENT)), 409, "REVISION_LOCKED")
    for recipient, purpose in [(to, "action"), (cc, "info")]:
        actor[0] = recipient
        assert client.get(url).status_code == 200
        rows = client.get("/api/v1/books", params={"inbox": "received"}).json()["items"]
        received = next(row for row in rows if row["id"] == book["id"])
        assert received["my_inbox"]["purpose"] == purpose
        assert received["my_inbox"]["sent_by_user_id"] == writer.id
        assert client.post(f"{url}/sign", json=sign_payload(book)).status_code in (403, 409)


def test_generic_send_cannot_deliver_unsigned_ledger_book(ledger):
    client, _, _, _, _, _ = ledger
    book, to, _ = submitted(ledger)
    error(
        client.post(
            f"/api/v1/books/{book['id']}/send", json={"user_ids": [to.id], "purpose": "action"}
        ),
        409,
        "LEDGER_BOOK_CHAIN_ONLY",
    )


def test_return_edit_resubmit_keeps_reference_and_allows_manager_sign(ledger, monkeypatch):
    client, db, actor, writer, manager_user, root = ledger
    monkeypatch.setattr(push_service, "send_to_user", lambda *args, **kwargs: None)
    book, _, _ = submitted(ledger)
    url = f"{BOOKS}/{book['id']}"
    assert client.post(f"{url}/return", json={"note": "Fix the subject"}).status_code == 403
    actor[0] = manager_user
    response = client.post(f"{url}/return", json={"note": "Fix the subject"})
    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "returned"
    assert response.json()["return_note"] == "Fix the subject"
    assert client.post(f"{url}/resubmit").status_code in (403, 404)
    actor[0] = writer
    changed = client.put(
        f"{url}/content",
        json=content_payload(
            book, {"subjects": ["Fixed subject"], "body_html": "<p>Fixed body</p>"}
        ),
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["can_resubmit"]
    response = client.post(f"{url}/resubmit")
    assert response.status_code == 200, response.text
    assert response.json()["ref_number"] == book["ref_number"]
    assert response.json()["approval_state"] == "pending"
    assert not response.json()["can_resubmit"]
    actor[0] = manager_user
    saved_signature(db, manager_user, root, monkeypatch)
    assert (
        client.post(f"{url}/sign", json=sign_payload(changed.json())).json()["approval_state"]
        == "approved"
    )


def test_writer_changes_pending_signer_but_not_signed_revision(ledger, monkeypatch):
    client, db, actor, writer, manager_user, root = ledger
    monkeypatch.setattr(push_service, "send_to_user", lambda *args, **kwargs: None)
    book, _, _ = submitted(ledger)
    replacement_user = make_user(db, role="manager", email="replacement@example.ae")
    replacement = setup_signer(db, replacement_user)
    replacement.name_en = "Replacement manager"
    replacement.name_ar = "البديل"
    db.commit()
    url = f"{BOOKS}/{book['id']}"
    actor[0] = manager_user
    assert client.put(f"{url}/signer", json={"manager_id": replacement.id}).status_code in (
        403,
        404,
    )
    actor[0] = writer
    response = client.put(f"{url}/signer", json={"manager_id": replacement.id})
    assert response.status_code == 200, response.text
    assert response.json()["signer"]["manager_id"] == replacement.id
    actor[0] = manager_user
    assert client.post(f"{url}/sign", json=sign_payload(book)).status_code in (403, 404)
    actor[0] = replacement_user
    assert client.get(url).json()["can_sign"]
    saved_signature(db, replacement_user, root, monkeypatch)
    signed = client.post(f"{url}/sign", json=sign_payload(book))
    assert signed.status_code == 200, signed.text
    actor[0] = writer
    error(
        client.put(f"{url}/signer", json={"manager_id": book["signer"]["manager_id"]}),
        409,
        "REVISION_LOCKED",
    )
    correction = client.post(f"{url}/corrections")
    assert correction.status_code == 201, correction.text
    assert correction.json()["can_resubmit"]
    assert client.post(f"{url}/resubmit").json()["approval_state"] == "pending"
    actor[0] = replacement_user
    assert client.post(f"{url}/sign", json=sign_payload(correction.json())).json()["revisions"][-1][
        "locked"
    ]
    actor[0] = writer
    recipients = client.get(f"/api/v1/books/{book['id']}/recipients").json()
    assert len(recipients) == 2


@pytest.mark.parametrize("grade", ["unclassified", "secret", "top_secret", "addressee_only"])
def test_external_contacts_and_signed_pdf_outlook_draft(ledger, monkeypatch, grade):
    client, db, actor, writer, manager_user, root = ledger
    manager = setup_signer(db, manager_user)
    db.add(UserPermission(user_id=writer.id, capability="books.secret", effect="grant"))
    writer._effective_caps_cache = None
    to = AddressBookContact(
        owner_user_id=writer.id, display_name="External To", address="external@example.org"
    )
    cc = AddressBookContact(
        owner_user_id=writer.id, display_name="External CC", address="copy@example.org"
    )
    db.add_all([to, cc])
    db.commit()
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT, "grade": grade}).json()
    values = {
        "external": True,
        "signer_manager_id": manager.id,
        "addressees": [{"role": "to", "contact_id": to.id}, {"role": "cc", "contact_id": cc.id}],
    }
    patched = client.patch(f"{DRAFTS}/{draft['id']}", json=values)
    assert patched.status_code == 200, patched.text
    assert patched.json()["external"]
    assert [a["contact_id"] for a in patched.json()["addressees"]] == [to.id, cc.id]
    preview = client.get(f"{DRAFTS}/{draft['id']}/paper")
    assert "External To" in preview.text and "External CC" in preview.text
    assert '<img class="signature"' not in preview.text
    if grade == "addressee_only":
        response = client.patch(
            f"{DRAFTS}/{draft['id']}", json={"addressees": [{"role": "to", "contact_id": to.id}]}
        )
        assert response.status_code == 200, response.text
    book = client.post(f"{DRAFTS}/{draft['id']}/save-and-send").json()
    url = f"{BOOKS}/{book['id']}"
    assert not book["can_create_outlook_draft"]
    actor[0] = manager_user
    saved_signature(db, manager_user, root, monkeypatch)
    assert client.post(f"{url}/sign", json=sign_payload(book)).status_code == 200
    assert client.post(f"{url}/outlook-draft").status_code in (403, 404)
    actor[0] = writer
    assert client.get(url).json()["can_create_outlook_draft"]
    account = _account(db, writer)
    server = FakeImapServer()
    folder = server.add_folder(account.drafts_folder)
    monkeypatch.setattr(email_service, "connect_imap", server.connector)
    monkeypatch.setattr(email_service, "get_settings", lambda: Settings(data_dir=root))
    printed = []

    def printer(document):
        printed.append(document)
        return b"%PDF-1.4 signed letter"

    monkeypatch.setattr(sheet_pdf_service, "print_document", printer, raising=False)
    response = client.post(f"{url}/outlook-draft")
    assert response.status_code == 200, response.text
    assert response.json()["id"] > 0
    assert len(printed) == 1
    assert "External To" in printed[0]
    assert ("External CC" in printed[0]) == (grade != "addressee_only")
    assert '<img class="signature" src="file:' in printed[0]
    assert "/api/v1/" not in printed[0]
    assert len(folder.messages) == 1
    message = BytesParser(policy=policy.default).parsebytes(folder.messages[0].raw)
    assert message["To"] == "external@example.org"
    assert message["Cc"] == (None if grade == "addressee_only" else "copy@example.org")
    assert message["Subject"] == "1/5/1 — First subject"
    attached = list(message.iter_attachments())
    assert len(attached) == 1
    assert attached[0].get_filename() == "1_5_1.pdf"
    assert attached[0].get_content_type() == "application/pdf"
    assert attached[0].get_payload(decode=True) == b"%PDF-1.4 signed letter"


def test_recipient_eligibility_ownership_and_exactly_one_id_are_atomic(ledger):
    client, db, _, writer, recipient, _ = ledger
    inactive = make_user(db, status="inactive", email="inactive@example.ae")
    inmate = make_user(db, role="inmate_reporter", email="inmate@example.ae")
    foreign = AddressBookContact(
        owner_user_id=recipient.id, display_name="Private", address="private@example.org"
    )
    inactive_manager = Manager(name_en="Inactive", user_id=recipient.id, active=False)
    unlinked = Manager(name_en="No login")
    db.add_all(
        [
            foreign,
            inactive_manager,
            unlinked,
            UserPermission(user_id=recipient.id, capability="books.secret", effect="deny"),
        ]
    )
    db.commit()
    recipient._effective_caps_cache = None
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT}).json()
    url = f"{DRAFTS}/{draft['id']}"
    for payload in [
        {"addressees": [{"role": "to", "user_id": recipient.id, "contact_id": foreign.id}]},
        {"addressees": [{"role": "to"}]},
        {"addressees": [{"role": "to", "user_id": inactive.id}]},
        {"addressees": [{"role": "to", "user_id": inmate.id}]},
        {"addressees": [{"role": "to", "user_id": writer.id}]},
        {"grade": "secret", "addressees": [{"role": "to", "user_id": recipient.id}]},
        {"external": True, "addressees": [{"role": "to", "contact_id": foreign.id}]},
    ]:
        error(client.patch(url, json=payload), 422, "ADDRESSEE_INVALID")
        assert client.get(url).json() == draft
    for manager in (inactive_manager, unlinked):
        error(client.patch(url, json={"signer_manager_id": manager.id}), 422, "SIGNER_INVALID")
        assert client.get(url).json() == draft


@pytest.mark.parametrize("stale", ["content", "revision"])
def test_signing_requires_the_reviewed_revision_and_content(ledger, monkeypatch, stale):
    from sqlalchemy import select

    from app.db.models import (
        AuditLog,
        Book,
        BookApprovalStep,
        BookRecipient,
        BookVersion,
        LedgerBookSave,
    )

    client, db, actor, writer, manager_user, root = ledger
    monkeypatch.setattr(push_service, "send_to_user", lambda *args, **kwargs: None)
    opened, _, _ = submitted(ledger)
    saved_signature(db, manager_user, root, monkeypatch)
    url = f"{BOOKS}/{opened['id']}"
    reviewed = {
        "expected_version_id": opened["selected_version_id"],
        "expected_content_sha256": opened["content_sha256"],
    }
    if stale == "revision":
        actor[0] = manager_user
        initial = client.post(f"{url}/sign", json=reviewed)
        assert initial.status_code == 200, initial.text
        actor[0] = writer
        correction = client.post(f"{url}/corrections")
        assert correction.status_code == 201, correction.text
        assert client.post(f"{url}/resubmit").status_code == 200
    else:
        changed = client.put(
            f"{url}/content",
            json=content_payload(
                opened, {"subjects": ["Changed"], "body_html": "<p>Transfer funds immediately</p>"}
            ),
        )
        assert changed.status_code == 200, changed.text
    actor[0] = manager_user

    def state():
        return {
            model.__tablename__: list(
                db.execute(select(model.__table__).order_by(model.__table__.c.id)).mappings()
            )
            for model in (
                Book,
                BookVersion,
                LedgerBookSave,
                BookApprovalStep,
                BookRecipient,
                AuditLog,
            )
        }

    def files():
        return {
            str(path.relative_to(root)): path.read_bytes()
            for path in root.rglob("*")
            if path.is_file()
        }

    before, before_files = state(), files()
    response = client.post(f"{url}/sign", json=reviewed)
    error(response, 409, "SIGNING_CONTENT_CONFLICT")
    assert state() == before
    assert files() == before_files
    latest = client.get(url).json()
    fresh = client.post(
        f"{url}/sign",
        json={
            "expected_version_id": latest["selected_version_id"],
            "expected_content_sha256": latest["content_sha256"],
        },
    )
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["revisions"][-1]["locked"]


def test_ledger_sign_requires_a_reviewed_snapshot(ledger):
    client, _db, actor, _, manager_user, _ = ledger
    book, _, _ = submitted(ledger)
    actor[0] = manager_user
    response = client.post(f"{BOOKS}/{book['id']}/sign", json={})
    assert response.status_code == 422, response.text
    assert client.get(f"{BOOKS}/{book['id']}").json()["can_sign"]


@pytest.mark.parametrize("external", [False, True])
def test_service_rejects_legacy_addressee_only_cc_before_numbering(ledger, external):
    from sqlalchemy import func, select

    from app.api.errors import ValidationFailedError
    from app.db.models import Book, BookAddressee, BookDraft, BookRecipient, BookVersion
    from app.services import ledger_book_service

    client, db, _, writer, manager_user, _ = ledger
    manager = setup_signer(db, manager_user)
    draft = client.post(DRAFTS, json={"tab": 5, **CONTENT, "signer_manager_id": manager.id}).json()
    stored = db.get(BookDraft, draft["id"])
    # Persisted legacy/corrupt values bypass request validation deliberately.
    stored.grade = "addressee_only"
    stored.external = external
    if external:
        to = AddressBookContact(
            owner_user_id=writer.id, display_name="To", address="to@example.org"
        )
        cc = AddressBookContact(
            owner_user_id=writer.id, display_name="CC", address="cc@example.org"
        )
        db.add_all([to, cc])
        db.flush()
        stored.addressees = [
            {"role": "to", "contact_id": to.id},
            {"role": "cc", "contact_id": cc.id},
        ]
    else:
        cc = make_user(db, role="manager", email="legacy-cc@example.ae")
        stored.addressees = [
            {"role": "to", "user_id": manager_user.id},
            {"role": "cc", "user_id": cc.id},
        ]
    db.commit()
    models = (Book, BookVersion, BookAddressee, BookRecipient)
    before = [db.scalar(select(func.count()).select_from(model)) for model in models]
    with pytest.raises(ValidationFailedError) as exc:
        ledger_book_service.save_and_send(db, writer, stored.id)
    assert exc.value.code == "ADDRESSEE_ONLY_CC_NOT_ALLOWED"
    assert [db.scalar(select(func.count()).select_from(model)) for model in models] == before
    assert db.get(BookDraft, draft["id"]) is not None


def test_sign_rechecks_addressee_only_cc_after_grade_change(ledger, monkeypatch):
    from sqlalchemy import func, select

    from app.db.models import Book, BookApprovalStep, BookRecipient, BookVersion
    from app.services import book_send_service, ledger_book_service

    client, db, actor, writer, manager_user, root = ledger
    book, _, _ = submitted(ledger)
    saved_signature(db, manager_user, root, monkeypatch)
    book_send_service.set_grade(db, writer, db.get(Book, book["id"]), "addressee_only")
    actor[0] = manager_user
    error(
        client.post(f"{BOOKS}/{book['id']}/sign", json=sign_payload(book)),
        422,
        "ADDRESSEE_ONLY_CC_NOT_ALLOWED",
    )
    version = db.get(BookVersion, book["selected_version_id"])
    assert version.signed_at is None and version.signed_by_user_id is None
    step = db.scalar(select(BookApprovalStep).where(BookApprovalStep.version_id == version.id))
    assert step.state == "pending" and step.decided_at is None
    assert (
        db.scalar(
            select(func.count())
            .select_from(BookRecipient)
            .where(BookRecipient.book_id == book["id"])
        )
        == 0
    )
    assert not ledger_book_service._revision_signature_file(book["id"], version.id).exists()
