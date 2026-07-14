"""Announcement-service helpers — Phase 2c OpenWA broadcast.

Currently provides :func:`resolve_book_pdf`, which resolves a book's served
PDF bytes (mirroring the ``/documents/{id}/download`` endpoint logic: signed-lock
swap, containment check, companion-PDF merge) so a group announcement can attach
it without going through the HTTP layer.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.pdf_merge import merge_pdfs_to_bytes
from app.db.models import Document
from app.services import book_service, document_service


class BookPdfError(RuntimeError):
    """Raised when a book's served PDF cannot be resolved.

    Covers: book not found, no generated document, no PDF rendition, file
    missing on disk, or a path-containment security violation.
    """


def resolve_book_pdf(db: Session, book_id: int) -> tuple[str, bytes]:
    """Return ``(filename, pdf_bytes)`` for the book's currently-served PDF.

    Mirrors the resolution in ``documents.download_document`` (non-original
    path, PDF format):

    1. Resolve the book and its current version's ``document_id``.
    2. Apply the signed-lock swap: if the version is approved+signed, serve
       ``signed_pdf_path``; otherwise serve ``Document.pdf_path``.
    3. Resolve the absolute path under ``settings.data_dir`` and perform the
       **same containment check** as the download endpoint (B2 guard).
    4. Merge companion PDFs when serving the generated ``pdf_path`` (annual-
       leave Undertaking, etc.) — identical to the download endpoint's
       ``merge_companions`` branch.

    Raises :class:`BookPdfError` with a descriptive message when anything in
    the chain is absent or fails the security check.
    """
    # ------------------------------------------------------------------ #
    # 1. Book + current version                                            #
    # ------------------------------------------------------------------ #
    try:
        book = book_service.get_book(db, book_id)
    except Exception as exc:
        raise BookPdfError(f"Book {book_id} not found") from exc

    if not book.versions:
        raise BookPdfError(f"Book {book_id} has no versions")

    current_version = book.versions[-1]
    document_id = current_version.document_id
    if document_id is None:
        raise BookPdfError(f"Book {book_id} current version has no generated document")

    # ------------------------------------------------------------------ #
    # 2. Document row                                                       #
    # ------------------------------------------------------------------ #
    row: Document | None = db.get(Document, document_id)
    if row is None:
        raise BookPdfError(f"Document {document_id} for book {book_id} not found in database")

    settings = get_settings()

    # ------------------------------------------------------------------ #
    # 3. Signed-lock swap (mirrors download_document non-original path)    #
    # ------------------------------------------------------------------ #
    locked, signed_rel = book_service.is_document_signed_locked(db, document_id)

    merge_companions = False
    if locked and signed_rel is not None:
        # Serve the signed artifact (scan-back PDF).  No companion merge —
        # identical to the download endpoint's locked branch.
        file_path: Path = settings.data_dir / signed_rel
    elif row.pdf_path:
        file_path = settings.data_dir / row.pdf_path
        merge_companions = True
    else:
        raise BookPdfError(f"Book {book_id} document {document_id} has no PDF rendition")

    # ------------------------------------------------------------------ #
    # 4. Containment check — B2 guard (copied faithfully from             #
    #    download_document lines ~507-517; do NOT weaken).                 #
    # ------------------------------------------------------------------ #
    _data_dir_resolved: Path = settings.data_dir.resolve()
    try:
        _file_resolved: Path = file_path.resolve()
    except OSError:
        _file_resolved = file_path
    if _data_dir_resolved not in _file_resolved.parents and _file_resolved != _data_dir_resolved:
        raise BookPdfError(
            f"Book {book_id}: resolved PDF path escapes data_dir (containment check failed)"
        )

    if not file_path.is_file():
        raise BookPdfError(f"Book {book_id}: PDF file not found on disk ({file_path})")

    # ------------------------------------------------------------------ #
    # 5. Read bytes — merge companions when serving the generated PDF      #
    # ------------------------------------------------------------------ #
    filename = f"{book.ref_number or book_id}.pdf"

    if merge_companions:
        comp_paths = document_service.companion_pdf_paths(db, row)
        if comp_paths:
            return filename, merge_pdfs_to_bytes(file_path, comp_paths)

    return filename, file_path.read_bytes()
