"""Save & Send is atomic with classified numbering, including under contention."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path
from threading import Barrier, Event

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.db import session as session_mod
from app.db.models import (
    AuditLog,
    Base,
    Book,
    BookApprovalStep,
    BookDraft,
    BookRecipient,
    BookVersion,
    ClassifiedRefSequence,
    LedgerBookSave,
    Manager,
    User,
)
from app.db.session import attach_sqlite_pragmas
from app.schemas.ledger_book import LedgerAddresseeIn, LedgerDraftCreate, LedgerDraftUpdate
from app.services import ledger_book_service, perm_service
from tests.conftest import make_user


@pytest.fixture()
def ledger_sessions(monkeypatch, tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'concurrent-ledger.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    attach_sqlite_pragmas(engine)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(session_mod, "engine", engine)
    monkeypatch.setattr(session_mod, "SessionLocal", sessions)
    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(ledger_book_service, "get_settings", lambda: settings)
    with sessions() as db:
        perm_service.seed_role_defaults(db)
    try:
        yield sessions, settings
    finally:
        engine.dispose()


def signer_fields(db):
    user = make_user(db, role="manager", email="signing-manager@test.ae")
    manager = Manager(name_en="Signing manager", user_id=user.id)
    db.add(manager)
    db.commit()
    return {
        "addressed_to": "Printed office",
        "signer_manager_id": manager.id,
        "addressees": [LedgerAddresseeIn(role="to", user_id=user.id)],
    }


def test_concurrent_save_and_send_allocates_contiguous_unique_serials(ledger_sessions):
    sessions, _settings = ledger_sessions
    count = 8
    tab = 4
    with sessions() as db:
        writer = make_user(db, role="manager", email="concurrent-writer@test.ae")
        writer_id = writer.id
        signing = signer_fields(db)
        draft_ids = [
            ledger_book_service.create_draft(
                db,
                writer,
                LedgerDraftCreate(
                    tab=tab,
                    **signing,
                    subjects=[f"Concurrent subject {index}"],
                    body_html=f"<p>Concurrent body {index}</p>",
                ),
            ).id
            for index in range(count)
        ]

    barrier = Barrier(count)

    def send(draft_id: int) -> tuple[int, str]:
        # No Session or ORM object is shared between workers.
        with sessions() as db:
            user = db.get(User, writer_id)
            barrier.wait(timeout=30)
            book = ledger_book_service.save_and_send(db, user, draft_id)
            return book.id, book.ref_number

    with ThreadPoolExecutor(max_workers=count) as executor:
        results = list(executor.map(send, draft_ids))

    assert len({book_id for book_id, _ref in results}) == count
    assert {ref for _book_id, ref in results} == {
        f"1/{tab}/{serial}" for serial in range(1, count + 1)
    }
    with sessions() as db:
        books = list(db.scalars(select(Book)))
        assert len(books) == count
        assert {book.source_draft_id for book in books} == set(draft_ids)
        assert {book.ref_number for book in books} == {ref for _book_id, ref in results}
        assert db.scalar(select(func.count()).select_from(BookDraft)) == 0
        assert db.scalar(select(func.count()).select_from(BookVersion)) == count
        assert db.scalar(select(func.count()).select_from(LedgerBookSave)) == count
        audits = list(
            db.scalars(select(AuditLog).where(AuditLog.action == "ledger_book_saved_and_sent"))
        )
        assert len(audits) == count
        assert {row.entity_id for row in audits} == {str(book_id) for book_id, _ref in results}
        assert db.get(ClassifiedRefSequence, 1).next_value == count + 1


def test_failed_save_and_send_rolls_back_serial_rows_and_copied_images(
    ledger_sessions, monkeypatch
):
    sessions, settings = ledger_sessions
    tab = 7
    image_bytes = b"\x89PNG\r\n\x1a\nledger-image"
    with sessions() as db:
        writer = make_user(db, role="manager", email="rollback-writer@test.ae")
        # Pin an existing counter so rollback must preserve the actual row/value,
        # not merely hide an uncommitted new sequence row.
        db.add(ClassifiedRefSequence(id=1, next_value=1))
        db.commit()
        draft = ledger_book_service.create_draft(
            db,
            writer,
            LedgerDraftCreate(
                tab=tab,
                subjects=["Keep this draft"],
                body_html="<p>Keep body</p>",
                **signer_fields(db),
            ),
        )
        draft_id = draft.id
        image = ledger_book_service.add_draft_image(db, writer, draft_id, image_bytes)
        draft = ledger_book_service.update_draft(
            db,
            writer,
            draft_id,
            LedgerDraftUpdate(body_html=f'<p>Keep body</p><img src="{image.src}" alt="Evidence">'),
        )
        original_body = draft.body_html
        original_subjects = list(draft.subjects)
        original_move = ledger_book_service._move_draft_images
        copied_paths: list[Path] = []

        def fail_after_copy(draft_id, book_id, body_html, copied):
            original_move(draft_id, book_id, body_html, copied)
            copied_paths.extend(copied)
            assert copied and all(path.read_bytes() == image_bytes for path in copied)
            raise RuntimeError("injected failure after image copy and serial allocation")

        with monkeypatch.context() as patch:
            patch.setattr(ledger_book_service, "_move_draft_images", fail_after_copy)
            with pytest.raises(RuntimeError, match="injected failure after image copy"):
                ledger_book_service.save_and_send(db, writer, draft_id)

        db.expire_all()
        assert db.scalar(select(func.count()).select_from(Book)) == 0
        assert db.scalar(select(func.count()).select_from(BookVersion)) == 0
        assert db.scalar(select(func.count()).select_from(LedgerBookSave)) == 0
        assert db.scalar(select(func.count()).select_from(AuditLog)) == 0
        assert db.scalar(select(func.count()).select_from(BookDraft)) == 1
        preserved = db.get(BookDraft, draft_id)
        assert preserved.owner_user_id == writer.id
        assert preserved.tab == tab
        assert preserved.subjects == original_subjects
        assert preserved.body_html == original_body
        assert db.get(ClassifiedRefSequence, 1).next_value == 1
        assert copied_paths and all(not path.exists() for path in copied_paths)
        draft_image = settings.data_dir / "ledger_drafts" / str(draft_id) / image.name
        assert draft_image.read_bytes() == image_bytes
        assert not any(
            path.is_file() for path in (settings.data_dir / "book_attachments").rglob("*")
        )

        book = ledger_book_service.save_and_send(db, writer, draft_id)

        assert book.ref_number == f"1/{tab}/1"
        assert book.source_draft_id == draft_id
        assert db.get(ClassifiedRefSequence, 1).next_value == 2
        assert db.get(BookDraft, draft_id) is None
        assert not draft_image.parent.exists()
        copied_image = settings.data_dir / "book_attachments" / str(book.id) / "images" / image.name
        assert copied_image.read_bytes() == image_bytes
        save = db.scalar(select(LedgerBookSave))
        assert save.body_html == (
            f'<p>Keep body</p><img src="/api/v1/ledger/books/{book.id}/images/{image.name}" alt="Evidence">'
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "ledger_book_saved_and_sent")
            )
            == 1
        )


def test_copy_failing_mid_file_leaves_no_book_images(ledger_sessions, monkeypatch):
    sessions, settings = ledger_sessions
    image_bytes = b"\x89PNG\r\n\x1a\n" + b"x" * 64
    with sessions() as db:
        writer = make_user(db, role="manager", email="partial-copy@test.ae")
        draft = ledger_book_service.create_draft(
            db,
            writer,
            LedgerDraftCreate(
                tab=4, subjects=["Copy"], body_html="<p>Body</p>", **signer_fields(db)
            ),
        )
        for _ in range(2):
            ledger_book_service.add_draft_image(db, writer, draft.id, image_bytes)
        real_copy = ledger_book_service.shutil.copy2
        calls = []

        def copy_then_fail(source, target):
            calls.append(target)
            if len(calls) == 1:
                return real_copy(source, target)
            # The second copy writes part of the file, then the disk fails.
            Path(target).write_bytes(image_bytes[:5])
            raise OSError("disk full mid-copy")

        with monkeypatch.context() as patch:
            patch.setattr(ledger_book_service.shutil, "copy2", copy_then_fail)
            with pytest.raises(OSError, match="disk full"):
                ledger_book_service.save_and_send(db, writer, draft.id)

        assert len(calls) == 2
        images_root = settings.data_dir / "book_attachments"
        assert not any(path.is_file() for path in images_root.rglob("*"))
        assert db.get(BookDraft, draft.id) is not None


def test_waiting_content_save_refreshes_signed_revision_under_write_lock(
    ledger_sessions, monkeypatch
):
    from datetime import datetime

    from app.api.errors import AppError
    from app.db.repos._locking import begin_immediate_if_idle

    sessions, _ = ledger_sessions
    with sessions() as db:
        writer = make_user(db, role="manager", email="edit-race@test.ae")
        writer_id = writer.id
        draft = ledger_book_service.create_draft(
            db,
            writer,
            LedgerDraftCreate(
                tab=4, subjects=["Before"], body_html="<p>Before</p>", **signer_fields(db)
            ),
        )
        book = ledger_book_service.save_and_send(db, writer, draft.id)
        book_id, version_id = book.id, book.versions[0].id
        expected_hash = ledger_book_service.ledger_book_read(db, writer, book_id).content_sha256
    ready, edit_started, lock_attempted = Event(), Event(), Event()
    real_begin = ledger_book_service.begin_immediate_if_idle

    def begin_edit(db):
        lock_attempted.set()
        return real_begin(db)

    monkeypatch.setattr(ledger_book_service, "begin_immediate_if_idle", begin_edit)

    def edit():
        with sessions() as db:
            writer = db.get(User, writer_id)
            # Keep stale ORM objects across the other session's signing commit.
            book = ledger_book_service.get_ledger_book(db, book_id)
            assert book.versions[0].signed_at is None
            ready.set()
            edit_started.wait(timeout=10)
            try:
                ledger_book_service.save_content(
                    db,
                    writer,
                    book_id,
                    addressed_to="Printed office",
                    subjects=["Late"],
                    body_html="<p>Late</p>",
                    expected_version_id=version_id,
                    expected_content_sha256=expected_hash,
                )
            except AppError as exc:
                return exc.code
            return "saved"

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(edit)
        assert ready.wait(timeout=10)
        with sessions() as signing:
            begin_immediate_if_idle(signing)
            version = signing.get(BookVersion, version_id)
            version.signed_at = datetime(2026, 1, 2)
            signing.flush()
            edit_started.set()
            # The editing worker is blocked on this transaction until commit.
            assert lock_attempted.wait(timeout=10)
            with pytest.raises(TimeoutError):
                future.result(timeout=0.2)
            signing.commit()
        assert future.result(timeout=10) == "REVISION_LOCKED"
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(LedgerBookSave)) == 1


def test_concurrent_content_saves_accept_only_one_editor_snapshot(ledger_sessions):
    from app.api.errors import AppError

    sessions, _ = ledger_sessions
    with sessions() as db:
        writer = make_user(db, role="manager", email="competing-editors@test.ae")
        writer_id = writer.id
        draft = ledger_book_service.create_draft(
            db,
            writer,
            LedgerDraftCreate(
                tab=4, subjects=["Before"], body_html="<p>Before</p>", **signer_fields(db)
            ),
        )
        book = ledger_book_service.save_and_send(db, writer, draft.id)
        opened = ledger_book_service.ledger_book_read(db, writer, book.id)
    barrier = Barrier(2)

    def edit(index):
        with sessions() as db:
            writer = db.get(User, writer_id)
            barrier.wait(timeout=10)
            try:
                ledger_book_service.save_content(
                    db,
                    writer,
                    opened.id,
                    addressed_to="Printed office",
                    subjects=[f"Editor {index}"],
                    body_html=f"<p>Editor {index}</p>",
                    expected_version_id=opened.selected_version_id,
                    expected_content_sha256=opened.content_sha256,
                )
            except AppError as exc:
                return exc.code, index
            return "saved", index

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(edit, range(2)))
    assert sorted(code for code, _ in results) == ["CONTENT_CONFLICT", "saved"]
    winner = next(index for code, index in results if code == "saved")
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(LedgerBookSave)) == 2
        current = ledger_book_service.ledger_book_read(db, db.get(User, writer_id), opened.id)
        assert current.subjects == [f"Editor {winner}"]
        assert current.body_html == f"<p>Editor {winner}</p>"


def test_waiting_signer_rechecks_reviewed_hash_after_writer_commit(ledger_sessions, monkeypatch):
    from app.api.errors import AppError
    from app.db.repos._locking import begin_immediate_if_idle

    sessions, settings = ledger_sessions
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    signature = settings.data_dir / "manager-signature.png"
    signature.write_bytes(b"signature")
    monkeypatch.setattr(
        ledger_book_service.user_signature_service, "resolve_signature", lambda user: signature
    )
    with sessions() as db:
        writer = make_user(db, role="manager", email="sign-race-writer@test.ae")
        draft = ledger_book_service.create_draft(
            db,
            writer,
            LedgerDraftCreate(
                tab=4, subjects=["Before"], body_html="<p>Before</p>", **signer_fields(db)
            ),
        )
        book = ledger_book_service.save_and_send(db, writer, draft.id)
        opened = ledger_book_service.ledger_book_read(db, writer, book.id)
        writer_id, signer_id = writer.id, opened.signer.user_id
    ready, sign_started, lock_attempted = Event(), Event(), Event()
    real_begin = ledger_book_service.begin_immediate_if_idle

    def begin_sign(db):
        lock_attempted.set()
        return real_begin(db)

    monkeypatch.setattr(ledger_book_service, "begin_immediate_if_idle", begin_sign)

    def sign():
        with sessions() as db:
            user = db.get(User, signer_id)
            stale_book = ledger_book_service.get_ledger_book(db, opened.id)
            assert stale_book.versions[0].signed_at is None
            ready.set()
            assert sign_started.wait(timeout=10)
            try:
                ledger_book_service.sign(
                    db,
                    user,
                    opened.id,
                    expected_version_id=opened.selected_version_id,
                    expected_content_sha256=opened.content_sha256,
                )
            except AppError as exc:
                return exc.code
            return "signed"

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(sign)
        assert ready.wait(timeout=10)
        with sessions() as db:
            begin_immediate_if_idle(db)
            body = "<p>Unreviewed change</p>"
            changed_book = db.get(Book, opened.id)
            changed_book.subject = "Changed"
            changed_book.search_text = ledger_book_service._search_text(
                changed_book, ["Changed"], body
            )
            db.add(
                LedgerBookSave(
                    version_id=opened.selected_version_id,
                    saved_by_user_id=writer_id,
                    subjects=["Changed"],
                    body_html=body,
                    content_sha256=ledger_book_service._content_sha256(["Changed"], body),
                )
            )
            db.flush()
            sign_started.set()
            assert lock_attempted.wait(timeout=10)
            with pytest.raises(TimeoutError):
                future.result(timeout=0.2)
            db.commit()
        assert future.result(timeout=10) == "SIGNING_CONTENT_CONFLICT"
    with sessions() as db:
        assert db.get(BookVersion, opened.selected_version_id).signed_at is None
        assert db.scalar(select(BookApprovalStep.state)) == "pending"
        assert db.scalar(select(func.count()).select_from(BookRecipient)) == 0
        assert db.scalar(select(func.count()).select_from(LedgerBookSave)) == 2
        assert not ledger_book_service._revision_signature_file(
            opened.id, opened.selected_version_id
        ).exists()
