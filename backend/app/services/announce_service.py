"""Announcement-service helpers — Phase 2c OpenWA broadcast.

Provides:
- :func:`resolve_book_pdf` — resolves a book's served PDF bytes (mirrors the
  ``/documents/{id}/download`` endpoint logic) so a group announcement can
  attach it without going through the HTTP layer.
- :class:`Attachment`, :class:`GroupSendResult`, :class:`AnnouncementResult` —
  data-transfer objects for the group-send flow.
- :func:`groups_available` — list WhatsApp groups the connected number belongs to.
- :func:`send_announcement` — fan-out text/file send to a list of groups with
  per-group ``GroupAnnouncementSend`` logging and a ``GroupAnnouncement`` parent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.pdf_merge import merge_pdfs_to_bytes
from app.db.models import Document, GroupAnnouncement, GroupAnnouncementSend
from app.services import book_service, document_service, notify_dispatch, openwa_client


class BookPdfError(RuntimeError):
    """Raised when a book's served PDF cannot be resolved.

    Covers: book not found, no generated document, no PDF rendition, file
    missing on disk, or a path-containment security violation.
    """


def resolve_book_pdf(db: Session, book_id: int) -> tuple[str, bytes]:
    """Return ``(filename, pdf_bytes)`` for the book's currently-served PDF.

    Authorization is enforced at the route boundary (``/announcements`` routes
    are ``messages.broadcast``-gated, admin-only); this resolver performs no
    per-book permission check by design.

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


# ---------------------------------------------------------------------------
# Group-send DTOs
# ---------------------------------------------------------------------------


@dataclass
class Attachment:
    """Resolved file bytes to attach to a group announcement."""

    filename: str
    data: bytes


@dataclass
class GroupSendResult:
    """Outcome of sending an announcement to one WhatsApp group."""

    group_id: str
    group_name: str
    ok: bool
    error: str | None = None


@dataclass
class AnnouncementResult:
    """Aggregate outcome of a :func:`send_announcement` call."""

    announcement_id: int
    sent: int
    failed: int
    results: list[GroupSendResult] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Group helpers
# ---------------------------------------------------------------------------


def groups_available(db: Session) -> list[openwa_client.Group]:
    """Return the WhatsApp groups the connected number belongs to.

    Returns an empty list when OpenWA is disabled or the request fails.
    The ``db`` parameter is accepted for API consistency but unused here.
    """
    if not get_settings().openwa_enabled:
        return []
    return openwa_client.list_groups()


# ---------------------------------------------------------------------------
# Fan-out send
# ---------------------------------------------------------------------------


def send_announcement(
    db: Session,
    *,
    groups: list[tuple[str, str]],
    text: str,
    attachment: Attachment | None,
    book_id: int | None,
    sent_by: int | None,
    mentions: list[str] | None = None,
) -> AnnouncementResult:
    """Send *text* (optionally with *attachment*) to each group in *groups*.

    Parameters
    ----------
    db:
        Active database session.
    groups:
        List of ``(group_id, group_name)`` pairs to deliver to.
    text:
        Message body / caption.
    attachment:
        Optional resolved file bytes.  When present the delivery uses
        ``openwa_client.send_file``; otherwise ``openwa_client.send_to_chat``.
    book_id:
        If the attachment was resolved from a book, pass its ID here so the
        ``GroupAnnouncement`` row records ``attachment_kind = "book"``.
    sent_by:
        ``User.id`` of the operator who triggered the send (nullable).
    mentions:
        Raw phone strings (e.g. ``"971509059931"`` or ``"+971 50 905 9931"``)
        that the message text already references with ``@<digits>`` tokens.
        Normalized once here via :func:`openwa_client.mention_chat_ids` to
        ``"<digits>@c.us"`` format and forwarded to the WAHA gateway.  The
        gateway degrades to rendering them as literal text if @-mentions are
        unsupported by the session engine.

    Raises
    ------
    notify_dispatch.NotifyDisabledError
        When ``settings.openwa_enabled`` is ``False``.
    """
    if not get_settings().openwa_enabled:
        raise notify_dispatch.NotifyDisabledError("OpenWA is not enabled")

    mention_ids = openwa_client.mention_chat_ids(mentions or [])

    # Derive attachment_kind from what we received.
    if attachment is not None and book_id is not None:
        attachment_kind = "book"
    elif attachment is not None:
        attachment_kind = "upload"
    else:
        attachment_kind = "none"

    # Write the parent GroupAnnouncement row.
    parent = GroupAnnouncement(
        body=text,
        attachment_kind=attachment_kind,
        attachment_name=attachment.filename if attachment is not None else None,
        book_id=book_id,
        sent_by=sent_by,
    )
    db.add(parent)
    db.flush()  # populate parent.id without committing yet

    # Fan-out: one GroupAnnouncementSend per target group.
    results: list[GroupSendResult] = []
    for group_id, group_name in groups:
        try:
            if attachment is not None:
                send_result = openwa_client.send_file(
                    group_id,
                    data=attachment.data,
                    filename=attachment.filename,
                    caption=text,
                    mentions=mention_ids or None,
                )
            else:
                send_result = openwa_client.send_to_chat(
                    group_id, text, mentions=mention_ids or None
                )
        except Exception as exc:
            send_result_ok = False
            send_result_msg_id: str | None = None
            send_result_error: str | None = str(exc)
        else:
            send_result_ok = send_result.ok
            send_result_msg_id = send_result.message_id
            send_result_error = send_result.error

        child = GroupAnnouncementSend(
            announcement_id=parent.id,
            group_id=group_id,
            group_name=group_name,
            status="sent" if send_result_ok else "failed",
            provider_msg_id=send_result_msg_id,
            error=send_result_error,
        )
        db.add(child)
        results.append(
            GroupSendResult(
                group_id=group_id,
                group_name=group_name,
                ok=send_result_ok,
                error=send_result_error,
            )
        )

    db.commit()

    sent = sum(1 for r in results if r.ok)
    failed = len(results) - sent
    return AnnouncementResult(
        announcement_id=parent.id,
        sent=sent,
        failed=failed,
        results=results,
    )
