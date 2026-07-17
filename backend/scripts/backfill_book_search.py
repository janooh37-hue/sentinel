"""Backfill Book.search_text for all existing books.

For each book, reads the latest version's docx (via Document.docx_path) and
extracts plain text. For General Book / HugeRTE books whose docx has already
been processed, falls back to version.fields["body"] HTML if the docx is
missing. Skips and logs books with no recoverable text source.

Commits in batches of 100.

Usage:
    python -m scripts.backfill_book_search
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.book_text import build_search_text, docx_to_text, html_to_text
from app.db.models import Book, BookVersion, Document
from app.db.session import SessionLocal

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

_BATCH = 100


def _latest_version(db: Session, book_id: int) -> BookVersion | None:
    return (
        db.query(BookVersion)
        .filter_by(book_id=book_id)
        .order_by(BookVersion.version_no.desc())
        .first()
    )


def run(db: Session) -> None:
    books = db.query(Book).order_by(Book.id).all()
    total = len(books)
    updated = 0
    skipped = 0

    for i, book in enumerate(books, 1):
        body = ""

        version = _latest_version(db, book.id)
        if version is not None:
            # Try docx first
            doc: Document | None = (
                db.get(Document, version.document_id) if version.document_id else None
            )
            docx_path: Path | None = Path(doc.docx_path) if doc and doc.docx_path else None
            if docx_path and docx_path.exists():
                try:
                    body = docx_to_text(docx_path)
                except Exception as exc:
                    log.warning(
                        "book %d: docx_to_text failed (%s), falling back to fields", book.id, exc
                    )

            # Fall back to fields["body"] HTML (General Book / HugeRTE)
            if not body and isinstance(version.fields, dict):
                raw_body = version.fields.get("body")
                if isinstance(raw_body, str) and raw_body:
                    body = html_to_text(raw_body)

            if not body and docx_path and not docx_path.exists():
                log.warning("book %d: docx missing at %s — skipping", book.id, docx_path)
                skipped += 1
                continue

        book.search_text = build_search_text(subject=book.subject, ref=book.ref_number, body=body)
        updated += 1

        if i % _BATCH == 0:
            db.commit()
            log.info("committed batch up to book %d (%d/%d)", book.id, i, total)

    db.commit()
    print(f"Done. updated={updated}  skipped_missing={skipped}  total={total}")


if __name__ == "__main__":
    with SessionLocal() as db:
        run(db)
