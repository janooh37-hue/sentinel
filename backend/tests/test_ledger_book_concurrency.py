"""Save & Send is atomic with classified numbering, including under contention."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.db import session as session_mod
from app.db.models import (
    AuditLog,
    Base,
    Book,
    BookDraft,
    BookVersion,
    ClassifiedRefSequence,
    LedgerBookSave,
    User,
)
from app.db.session import attach_sqlite_pragmas
from app.schemas.ledger_book import LedgerDraftCreate, LedgerDraftUpdate
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


def test_concurrent_save_and_send_allocates_contiguous_unique_serials(ledger_sessions):
    sessions, _settings = ledger_sessions
    count = 8
    tab = 4
    with sessions() as db:
        writer = make_user(db, role="manager", email="concurrent-writer@test.ae")
        writer_id = writer.id
        draft_ids = [
            ledger_book_service.create_draft(
                db,
                writer,
                LedgerDraftCreate(
                    tab=tab,
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
            LedgerDraftCreate(tab=tab, subjects=["Keep this draft"], body_html="<p>Keep body</p>"),
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
