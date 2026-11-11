"""Ledger Book drafts, Revisions, single-manager signing and Outlook handoff.

Mounted in ``main.py`` BEFORE ``ledger.router``: its ``/ledger/{entry_id}``
catch-all would otherwise swallow ``/ledger/drafts`` and ``/ledger/books``.

  GET    /ledger/drafts                          own drafts
  POST   /ledger/drafts                          create
  GET    /ledger/drafts/{id}                     one own draft
  PATCH  /ledger/drafts/{id}                     partial update (sanitized)
  DELETE /ledger/drafts/{id}                     delete (and its images)
  POST   /ledger/drafts/{id}/images              upload an image
  GET    /ledger/drafts/{id}/images/{name}       owner only
  GET    /ledger/drafts/{id}/paper               owner only, DRAFT paper
  POST   /ledger/drafts/{id}/save-and-send       number it: a Ledger Book
  GET    /ledger/books/{id}?revision=            detail + a Revision's content
  PUT    /ledger/books/{id}/content              tracked save on the latest Revision
  GET    /ledger/books/{id}/revisions/{vid}/saves  save history
  POST   /ledger/books/{id}/corrections          new Revision from a signed one
  GET    /ledger/books/{id}/images/{name}        readers of the book
  GET    /ledger/books/{id}/paper?revision=      a Revision as hardened HTML paper
  POST   /ledger/books/{id}/sign                 assignee signs and delivers
  POST   /ledger/books/{id}/return               assignee returns with a note
  POST   /ledger/books/{id}/resubmit             writer submits return/correction
  PUT    /ledger/books/{id}/signer               writer reassigns before signing
  GET    /ledger/books/{id}/signature?revision=  readers; immutable signature image
  POST   /ledger/books/{id}/outlook-draft         writer; signed external PDF draft
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import FileResponse, HTMLResponse, Response
from sqlalchemy.orm import Session

from app.api._responses import maybe_base64
from app.api.deps import get_current_user, require_capability
from app.core.ledger_paper import paper_response
from app.db.models import User
from app.db.session import get_db
from app.schemas.ledger_book import (
    LedgerBookRead,
    LedgerContentUpdate,
    LedgerDraftCreate,
    LedgerDraftImageRead,
    LedgerDraftRead,
    LedgerDraftUpdate,
    LedgerOutlookDraftRead,
    LedgerReturnIn,
    LedgerSaveRead,
    LedgerSignerIn,
    LedgerSignRequest,
)
from app.services import ledger_book_service as service

router = APIRouter(prefix="/ledger", tags=["ledger-books"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]

_IMAGE_MEDIA_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
}

# The paper's hardened headers that apply to a PDF (no CSP: not a document we render).
_PDF_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
EncodingQuery = Annotated[str | None, Query(pattern="^base64$")]


def _pdf_response(pdf: bytes, encoding: str | None) -> Response:
    """``encoding=base64`` serves text for DocPdfCanvas, as the Word preview does."""
    if (
        b64 := maybe_base64(pdf, encoding, extra_headers={"Cache-Control": "no-store"})
    ) is not None:
        return b64
    return Response(content=pdf, media_type="application/pdf", headers=_PDF_HEADERS)


def _image_response(path: Path) -> FileResponse:
    return FileResponse(
        path,
        media_type=_IMAGE_MEDIA_TYPES[path.suffix.removeprefix(".")],
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"},
    )


@router.get("/drafts", response_model=list[LedgerDraftRead])
def list_drafts(db: DbDep, user: UserDep) -> list[LedgerDraftRead]:
    return [service.draft_read(draft) for draft in service.list_drafts(db, user)]


@router.post("/drafts", response_model=LedgerDraftRead, status_code=status.HTTP_201_CREATED)
def create_draft(payload: LedgerDraftCreate, db: DbDep, user: UserDep) -> LedgerDraftRead:
    return service.draft_read(service.create_draft(db, user, payload))


@router.get("/drafts/{draft_id}", response_model=LedgerDraftRead)
def get_draft(draft_id: int, db: DbDep, user: UserDep) -> LedgerDraftRead:
    return service.draft_read(service.get_own_draft(db, user, draft_id))


@router.patch("/drafts/{draft_id}", response_model=LedgerDraftRead)
def update_draft(
    draft_id: int, payload: LedgerDraftUpdate, db: DbDep, user: UserDep
) -> LedgerDraftRead:
    return service.draft_read(service.update_draft(db, user, draft_id, payload))


@router.delete("/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(draft_id: int, db: DbDep, user: UserDep) -> Response:
    service.delete_draft(db, user, draft_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/drafts/{draft_id}/images",
    response_model=LedgerDraftImageRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_draft_image(
    draft_id: int,
    db: DbDep,
    user: UserDep,
    file: Annotated[UploadFile, File()],
) -> LedgerDraftImageRead:
    # Read one byte past the cap so an oversized upload is refused, not truncated.
    data = await file.read(service.MAX_IMAGE_BYTES + 1)
    return service.add_draft_image(db, user, draft_id, data)


@router.get("/drafts/{draft_id}/images/{name}")
def get_draft_image(draft_id: int, name: str, db: DbDep, user: UserDep) -> FileResponse:
    return _image_response(service.draft_image_path(db, user, draft_id, name))


@router.get("/drafts/{draft_id}/paper", response_class=HTMLResponse)
def get_draft_paper(draft_id: int, db: DbDep, user: UserDep) -> HTMLResponse:
    return paper_response(service.draft_paper(db, user, draft_id))


@router.get("/drafts/{draft_id}/paper.pdf", response_class=Response)
def get_draft_paper_pdf(
    draft_id: int, db: DbDep, user: UserDep, encoding: EncodingQuery = None
) -> Response:
    """The owner's Draft as real PDF pages for the composer preview."""
    return _pdf_response(service.draft_pdf(db, user, draft_id), encoding)


@router.post("/drafts/{draft_id}/save-and-send", response_model=LedgerBookRead)
def save_and_send(
    draft_id: int,
    db: DbDep,
    # Interim gate: Phase 2b replaces books.create with Branch membership (ADR 0008).
    user: Annotated[User, Depends(require_capability("books.create"))],
) -> LedgerBookRead:
    book = service.save_and_send(db, user, draft_id)
    return service.ledger_book_read(db, user, book.id)


@router.get("/books/{book_id}", response_model=LedgerBookRead)
def get_ledger_book(
    book_id: int,
    db: DbDep,
    user: UserDep,
    revision: Annotated[int | None, Query(description="Revision (version) id")] = None,
) -> LedgerBookRead:
    return service.ledger_book_read(db, user, book_id, version_id=revision)


@router.get("/books/{book_id}/paper", response_class=HTMLResponse)
def get_ledger_book_paper(
    book_id: int,
    db: DbDep,
    user: UserDep,
    revision: Annotated[int | None, Query(description="Revision (version) id")] = None,
) -> HTMLResponse:
    return paper_response(service.book_paper(db, user, book_id, version_id=revision))


@router.get("/books/{book_id}/paper.pdf", response_class=Response)
def get_ledger_book_paper_pdf(
    book_id: int,
    db: DbDep,
    user: UserDep,
    revision: int | None = None,
    v: Annotated[str | None, Query(pattern=r"^[0-9a-f]{64}$")] = None,
    encoding: EncodingQuery = None,
) -> Response:
    """One Revision as PDF, under the same read access as its paper."""
    return _pdf_response(
        service.book_pdf(db, user, book_id, version_id=revision, expected_content_sha256=v),
        encoding,
    )


@router.put("/books/{book_id}/content", response_model=LedgerBookRead)
def save_ledger_content(
    book_id: int, payload: LedgerContentUpdate, db: DbDep, user: UserDep
) -> LedgerBookRead:
    return service.save_content(
        db,
        user,
        book_id,
        subjects=payload.subjects,
        body_html=payload.body_html,
        expected_version_id=payload.expected_version_id,
        expected_content_sha256=payload.expected_content_sha256,
    )


@router.get("/books/{book_id}/revisions/{version_id}/saves", response_model=list[LedgerSaveRead])
def list_ledger_saves(
    book_id: int, version_id: int, db: DbDep, user: UserDep
) -> list[LedgerSaveRead]:
    return service.list_saves(db, user, book_id, version_id)


@router.post(
    "/books/{book_id}/corrections",
    response_model=LedgerBookRead,
    status_code=status.HTTP_201_CREATED,
)
def start_correction(book_id: int, db: DbDep, user: UserDep) -> LedgerBookRead:
    return service.start_correction(db, user, book_id)


@router.get("/books/{book_id}/images/{name}")
def get_book_image(book_id: int, name: str, db: DbDep, user: UserDep) -> FileResponse:
    return _image_response(service.book_image_path(db, user, book_id, name))


@router.post("/books/{book_id}/sign", response_model=LedgerBookRead)
def sign_ledger_book(
    book_id: int, payload: LedgerSignRequest, db: DbDep, user: UserDep
) -> LedgerBookRead:
    return service.sign(
        db,
        user,
        book_id,
        expected_version_id=payload.expected_version_id,
        expected_content_sha256=payload.expected_content_sha256,
    )


@router.post("/books/{book_id}/return", response_model=LedgerBookRead)
def return_ledger_book(
    book_id: int, payload: LedgerReturnIn, db: DbDep, user: UserDep
) -> LedgerBookRead:
    return service.return_book(db, user, book_id, payload.note)


@router.post("/books/{book_id}/resubmit", response_model=LedgerBookRead)
def resubmit_ledger_book(book_id: int, db: DbDep, user: UserDep) -> LedgerBookRead:
    return service.resubmit(db, user, book_id)


@router.put("/books/{book_id}/signer", response_model=LedgerBookRead)
def change_ledger_signer(
    book_id: int, payload: LedgerSignerIn, db: DbDep, user: UserDep
) -> LedgerBookRead:
    return service.change_signer(db, user, book_id, payload.manager_id)


@router.post("/books/{book_id}/outlook-draft", response_model=LedgerOutlookDraftRead)
def create_ledger_outlook_draft(book_id: int, db: DbDep, user: UserDep) -> LedgerOutlookDraftRead:
    return service.create_outlook_draft(db, user, book_id)


@router.get("/books/{book_id}/signature")
def get_ledger_signature(
    book_id: int, db: DbDep, user: UserDep, revision: int | None = None
) -> FileResponse:
    return FileResponse(
        service.signature_path(db, user, book_id, revision),
        media_type="image/png",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
