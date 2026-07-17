"""Seed a throwaway Word-editing session for WebDAV proof-of-concept.

Opens a temporary General Book over WebDAV so Word (or a human tester) can
open and edit it. Prints the DAV token, access URL, and the ms-word: launch URI.

Usage:
    venv\\Scripts\\python.exe backend\\scripts\\word_dav_proof.py \\
        --base-url http://127.0.0.1:8999

Requires: BookCategory(id="GS") and the General Book template.
"""

from __future__ import annotations

import argparse
import secrets
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        type=str,
        default=None,
        help="Public base URL (default: from settings.public_base_url)",
    )
    args = parser.parse_args()

    from app.config import get_settings
    from app.db.models import Book, BookCategory
    from app.db.session import SessionLocal

    settings = get_settings()
    base_url = args.base_url or getattr(settings, "public_base_url", "http://127.0.0.1:8765")

    db = SessionLocal()
    try:
        # Ensure BookCategory(id="GS") exists.
        category = db.query(BookCategory).filter(BookCategory.id == "GS").first()
        if not category:
            category = BookCategory(
                id="GS",
                name_en="General Services",
                name_ar="الخدمات العامة",
                prefix="GS",
                requires_approval=False,
            )
            db.add(category)
            db.flush()

        # Create a new Book.
        book = Book(
            category_id="GS",
            ref_number=f"PROOF-{int(time.time())}",
            subject="DAV proof",
        )
        db.add(book)
        db.flush()
        book_id = book.id

        # Ensure editing dir exists and copy template.
        editing_dir = settings.data_dir / "editing"
        editing_dir.mkdir(parents=True, exist_ok=True)

        template_path = BACKEND / "templates" / "GSSG-GS_300-003_General_Book.docx"
        working_path = editing_dir / f"proof-{book_id}.docx"
        working_path.write_bytes(template_path.read_bytes())

        # Create BookEditSession row (or simulate it with mock data).
        # If the table doesn't exist yet, we skip the DB insert and just mock the values.
        token = secrets.token_urlsafe(32)
        try:
            from app.db.models import BookEditSession

            session = BookEditSession(
                book_id=book_id,
                user_id=1,
                token=token,
                working_path=str(working_path),
                state="active",
            )
            db.add(session)
        except ImportError:
            # Table doesn't exist yet; just use the token in the output.
            pass

        db.commit()

        # Print the three lines.
        print(f"TOKEN: {token}")
        print(f"URL: {base_url}/dav/{token}/proof.docx")
        print(f"WORD: ms-word:ofe|u|{base_url}/dav/{token}/proof.docx")

    finally:
        db.close()


if __name__ == "__main__":  # REQUIRED — docx2pdf spawns; no guard = runs twice
    main()
