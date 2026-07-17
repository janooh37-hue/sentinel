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

        access_url = f"{base_url}/dav/{token}/proof.docx"
        word_uri = f"ms-word:ofe|u|{access_url}"

        # Print the lines.
        print(f"TOKEN: {token}")
        print(f"URL: {access_url}")
        print(f"WORD: {word_uri}")

        # Write a clickable HTML page next to the working file: open it in a
        # browser on any office PC and click the button to launch Word on the
        # server copy. Re-run against --base-url https://gssg.lan after deploy
        # to test the real cross-PC + HTTPS path.
        html = _clickable_html(word_uri, access_url)
        html_path = editing_dir / f"word-edit-test-{book_id}.html"
        html_path.write_text(html, encoding="utf-8")
        print(f"CLICKABLE: {html_path}")

    finally:
        db.close()


def _clickable_html(word_uri: str, access_url: str) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Edit-in-Word test</title>
<style>
 body{{font-family:Segoe UI,system-ui,sans-serif;background:#f5f4f1;color:#1c1f24;
   display:grid;place-items:center;min-height:100vh;margin:0}}
 .card{{background:#fff;border:1px solid #e6e4dd;border-radius:16px;padding:32px;
   max-width:520px;box-shadow:0 10px 30px rgba(15,23,42,.08);text-align:center}}
 h1{{font-size:19px;margin:0 0 6px}} p{{color:#5a6068;font-size:14px;line-height:1.5}}
 a.btn{{display:inline-flex;align-items:center;gap:10px;background:#185abd;color:#fff;
   text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:12px;margin:18px 0 8px}}
 code{{background:#f0eee8;padding:2px 6px;border-radius:6px;font-size:12px;word-break:break-all}}
 ol{{text-align:start;color:#5a6068;font-size:13px;line-height:1.7}}
</style></head><body>
<div class="card">
 <h1>Edit-in-Word — round-trip test</h1>
 <p>Clicking below launches desktop Word on the <b>server copy</b> of a document.</p>
 <a class="btn" href="{word_uri}">📝&nbsp; Open in Word</a>
 <ol>
  <li>Click <b>Open in Word</b> (allow the browser to open Word if prompted).</li>
  <li>Word should open the file <b>editable</b> (not read-only).</li>
  <li>Type something, then press <b>Ctrl+S</b>.</li>
  <li>Success = it saves with no "read-only" error. The edit is now on the server.</li>
 </ol>
 <p>Direct URL (should download/preview the .docx): <br><code>{access_url}</code></p>
</div></body></html>"""


if __name__ == "__main__":  # REQUIRED — docx2pdf spawns; no guard = runs twice
    main()
