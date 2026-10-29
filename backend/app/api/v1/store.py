"""Assets store endpoints: categories, Store items, Batches, deliveries, counts, disposals."""

from __future__ import annotations

from datetime import date as date_t
from typing import Annotated

from fastapi import APIRouter, Depends, File, Header, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api._responses import maybe_base64
from app.api.deps import get_current_user, require_capability
from app.api.errors import AppError
from app.db.models import User
from app.db.session import get_db
from app.schemas.store import (
    StoreBatchRead,
    StoreCategoryCreate,
    StoreCategoryRead,
    StoreCategoryUpdate,
    StoreCountRead,
    StoreCountWrite,
    StoreDashboard,
    StoreDeliveryCreate,
    StoreDeliveryRead,
    StoreDisposalCreate,
    StoreDisposalRead,
    StoreExpectedBatch,
    StoreItemCreate,
    StoreItemRead,
    StoreItemUpdate,
    StorePickerItem,
)
from app.services import perm_service, store_service

router = APIRouter(prefix="/store", tags=["store"])

_View = Annotated[User, Depends(require_capability("store.view"))]
_Edit = Annotated[User, Depends(require_capability("store.edit"))]
_Db = Annotated[Session, Depends(get_db)]

_PICKER_CAPABILITIES = ("store.view", "documents.generate")


# ── Categories ───────────────────────────────────────────────────────────────


@router.get("/categories", response_model=list[StoreCategoryRead])
def list_store_categories(db: _Db, _user: _View) -> list[StoreCategoryRead]:
    return store_service.list_categories(db)


@router.post("/categories", response_model=StoreCategoryRead, status_code=status.HTTP_201_CREATED)
def create_store_category(payload: StoreCategoryCreate, db: _Db, user: _Edit) -> StoreCategoryRead:
    return store_service.create_category(db, payload, actor=user.email)


@router.patch("/categories/{category_id}", response_model=StoreCategoryRead)
def update_store_category(
    category_id: int, payload: StoreCategoryUpdate, db: _Db, user: _Edit
) -> StoreCategoryRead:
    return store_service.update_category(db, category_id, payload, actor=user.email)


# ── Store items ──────────────────────────────────────────────────────────────


@router.get("/items", response_model=list[StoreItemRead])
def list_store_items(db: _Db, _user: _View, include_archived: bool = False) -> list[StoreItemRead]:
    return store_service.list_items(db, include_archived=include_archived)


@router.get("/items/picker", response_model=list[StorePickerItem])
def list_store_picker_items(
    db: _Db, user: Annotated[User, Depends(get_current_user)]
) -> list[StorePickerItem]:
    """Active Store items for the HQ material request picker."""
    if not any(perm_service.has_capability(db, user, cap) for cap in _PICKER_CAPABILITIES):
        raise AppError(
            "FORBIDDEN",
            "Missing capability: store.view or documents.generate",
            http_status=403,
            details={"capability": "store.view", "any_of": list(_PICKER_CAPABILITIES)},
        )
    return store_service.list_picker_items(db)


@router.post("/items", response_model=StoreItemRead, status_code=status.HTTP_201_CREATED)
def create_store_item(payload: StoreItemCreate, db: _Db, user: _Edit) -> StoreItemRead:
    row = store_service.create_item(db, payload, actor=user.email, actor_user_id=user.id)
    return store_service.item_read(db, row)


@router.patch("/items/{item_id}", response_model=StoreItemRead)
def update_store_item(
    item_id: int,
    payload: StoreItemUpdate,
    db: _Db,
    user: _Edit,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> StoreItemRead:
    row = store_service.update_item(db, item_id, payload, if_match=if_match, actor=user.email)
    return store_service.item_read(db, row)


@router.post("/items/{item_id}/archive", response_model=StoreItemRead)
def archive_store_item(item_id: int, db: _Db, user: _Edit) -> StoreItemRead:
    row = store_service.archive_item(db, item_id, actor=user.email)
    return store_service.item_read(db, row)


@router.post("/items/{item_id}/restore", response_model=StoreItemRead)
def restore_store_item(item_id: int, db: _Db, user: _Edit) -> StoreItemRead:
    row = store_service.restore_item(db, item_id, actor=user.email)
    return store_service.item_read(db, row)


# ── Batches ──────────────────────────────────────────────────────────────────


@router.get("/batches", response_model=list[StoreBatchRead])
def list_store_batches(db: _Db, _user: _View, item_id: int | None = None) -> list[StoreBatchRead]:
    return store_service.list_batches(db, item_id=item_id)


# ── Monthly deliveries ───────────────────────────────────────────────────────


@router.get("/deliveries", response_model=list[StoreDeliveryRead])
def list_store_deliveries(db: _Db, _user: _View) -> list[StoreDeliveryRead]:
    return store_service.list_deliveries(db)


@router.post("/deliveries", response_model=StoreDeliveryRead, status_code=status.HTTP_201_CREATED)
def create_store_delivery(payload: StoreDeliveryCreate, db: _Db, user: _Edit) -> StoreDeliveryRead:
    return store_service.create_delivery(db, payload, actor=user.email, actor_user_id=user.id)


@router.get("/deliveries/{delivery_id}", response_model=StoreDeliveryRead)
def get_store_delivery(delivery_id: int, db: _Db, _user: _View) -> StoreDeliveryRead:
    return store_service.get_delivery(db, delivery_id)


@router.delete("/deliveries/{delivery_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_store_delivery(delivery_id: int, db: _Db, user: _Edit) -> Response:
    store_service.delete_delivery(db, delivery_id, actor=user.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/deliveries/{delivery_id}/note-file", response_model=StoreDeliveryRead)
async def upload_store_delivery_note(
    delivery_id: int,
    db: _Db,
    user: _Edit,
    file: Annotated[UploadFile, File()],
) -> StoreDeliveryRead:
    data = await file.read(store_service.NOTE_FILE_MAX_BYTES + 1)
    return await run_in_threadpool(
        store_service.attach_note_file,
        db,
        delivery_id,
        filename=file.filename or "delivery-note",
        data=data,
        media_type=file.content_type or "",
        actor=user.email,
    )


@router.get("/deliveries/{delivery_id}/note-file")
def download_store_delivery_note(
    delivery_id: int,
    db: _Db,
    _user: _View,
    encoding: Annotated[str | None, Query()] = None,
) -> Response:
    row, path = store_service.resolve_note_file(db, delivery_id)
    raw = path.read_bytes()
    if (encoded := maybe_base64(raw, encoding)) is not None:
        return encoded
    media_type = row.note_file_media_type or "application/octet-stream"
    disposition = "inline" if media_type.startswith("image/") else "attachment"
    return Response(
        content=raw,
        media_type=media_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{row.note_file_name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/deliveries/{delivery_id}/note-file", response_model=StoreDeliveryRead)
def delete_store_delivery_note(delivery_id: int, db: _Db, user: _Edit) -> StoreDeliveryRead:
    return store_service.delete_note_file(db, delivery_id, actor=user.email)


# ── Stock counts ─────────────────────────────────────────────────────────────


@router.get("/counts", response_model=list[StoreCountRead])
def list_store_counts(db: _Db, _user: _View) -> list[StoreCountRead]:
    return store_service.list_counts(db)


@router.post("/counts", response_model=StoreCountRead, status_code=status.HTTP_201_CREATED)
def create_store_count(payload: StoreCountWrite, db: _Db, user: _Edit) -> StoreCountRead:
    return store_service.create_count(db, payload, actor=user.email, actor_user_id=user.id)


@router.get("/counts/expected", response_model=list[StoreExpectedBatch])
def get_store_count_expected(counted_on: date_t, db: _Db, _user: _View) -> list[StoreExpectedBatch]:
    """Batches a count on ``counted_on`` must include, without expected quantities."""
    return store_service.expected_batches(db, counted_on)


@router.get("/counts/{count_id}", response_model=StoreCountRead)
def get_store_count(count_id: int, db: _Db, _user: _View) -> StoreCountRead:
    return store_service.get_count(db, count_id)


@router.put("/counts/{count_id}", response_model=StoreCountRead)
def update_store_count(
    count_id: int, payload: StoreCountWrite, db: _Db, user: _Edit
) -> StoreCountRead:
    return store_service.update_count(db, count_id, payload, actor=user.email)


# ── Disposals ────────────────────────────────────────────────────────────────


@router.get("/disposals", response_model=list[StoreDisposalRead])
def list_store_disposals(db: _Db, _user: _View) -> list[StoreDisposalRead]:
    return store_service.list_disposals(db)


@router.post("/disposals", response_model=StoreDisposalRead, status_code=status.HTTP_201_CREATED)
def create_store_disposal(payload: StoreDisposalCreate, db: _Db, user: _Edit) -> StoreDisposalRead:
    return store_service.create_disposal(db, payload, actor=user.email, actor_user_id=user.id)


@router.delete("/disposals/{disposal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_store_disposal(disposal_id: int, db: _Db, user: _Edit) -> Response:
    store_service.delete_disposal(db, disposal_id, actor=user.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Dashboard ────────────────────────────────────────────────────────────────


@router.get("/dashboard", response_model=StoreDashboard)
def get_store_dashboard(db: _Db, _user: _View) -> StoreDashboard:
    return store_service.dashboard(db)
