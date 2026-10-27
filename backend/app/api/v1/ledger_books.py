"""Ledger Book endpoints, Phase 2a (ADR 0007 Drafts + Save & Send, ADR 0008).

Mounted in ``main.py`` BEFORE ``ledger.router``: its ``/ledger/{entry_id}``
catch-all would otherwise swallow ``/ledger/drafts`` and ``/ledger/books``.

  GET    /ledger/drafts                          own drafts
  POST   /ledger/drafts                          create
  GET    /ledger/drafts/{id}                     one own draft
  PATCH  /ledger/drafts/{id}                     partial update (sanitized)
  DELETE /ledger/drafts/{id}                     delete (and its images)
  POST   /ledger/drafts/{id}/images              upload an image
  GET    /ledger/drafts/{id}/images/{name}       owner only
  POST   /ledger/drafts/{id}/save-and-send       number it: a Ledger Book
  GET    /ledger/books/{id}?revision=            detail + a Revision's content
  PUT    /ledger/books/{id}/content              tracked save on the latest Revision
  GET    /ledger/books/{id}/revisions/{vid}/saves  save history
  POST   /ledger/books/{id}/corrections          new Revision from a signed one
  GET    /ledger/books/{id}/images/{name}        readers of the book
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.ledger_book import (
    LedgerBookRead,
    LedgerContentUpdate,
    LedgerDraftCreate,
    LedgerDraftImageRead,
    LedgerDraftRead,
    LedgerDraftUpdate,
    LedgerSaveRead,
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


@router.put("/books/{book_id}/content", response_model=LedgerBookRead)
def save_ledger_content(
    book_id: int, payload: LedgerContentUpdate, db: DbDep, user: UserDep
) -> LedgerBookRead:
    return service.save_content(
        db, user, book_id, subjects=payload.subjects, body_html=payload.body_html
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
