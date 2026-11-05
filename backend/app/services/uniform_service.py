"""Uniform business rules: catalogue, receipts, hand-outs, returns, adjustments, voids.

Every mutating function is one SQLite write transaction: ``BEGIN IMMEDIATE``
before the first read, then the posting rows, the cached ``on_hand`` change and
one audit row commit together. Any failure rolls the whole request back, so a
rejected request writes nothing. Shelf decrements go through the guarded
``uniform_repo.decrement_on_hand``; ``CHECK (on_hand >= 0)`` backs it up.
Shelf increments also guard the signed 64-bit SQLite integer ceiling before
adding, so overflowing requests cannot promote balances to floating point.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import status
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.errors import AppError, ConflictError, NotFoundError, ValidationFailedError
from app.core.clock import organization_today, utcnow
from app.db.models import (
    Employee,
    UniformAdjustment,
    UniformIssue,
    UniformIssueLine,
    UniformItem,
    UniformReceipt,
    UniformReceiptLine,
    UniformReturn,
    UniformReturnLine,
    UniformSize,
    User,
)
from app.db.repos import uniform_repo
from app.db.repos._locking import begin_immediate_if_idle
from app.db.repos.audit_repo import append_audit
from app.schemas.uniform import (
    UniformEmployeeRead,
    UniformHolder,
    UniformHolding,
    UniformIssueRead,
    UniformItemRead,
    UniformRecipient,
    UniformReturnRead,
    UniformSizeRead,
    UniformSummary,
)

GROUPS = frozenset({"formal", "guard", "winter"})
DRAWINGS = frozenset(
    {
        "suit",
        "boots",
        "polo",
        "cargo",
        "belt",
        "cap",
        "socks",
        "jacket",
        "vest",
        "parka",
        "dressshirt",
        "longsleeve",
    }
)
CONDITIONS = frozenset({"reusable", "damaged"})
ONE_SIZE = "one"
SIZE_LABEL_MAX = 16
REASON_MAX = 500
NAME_MAX = 120
DESCRIPTION_MAX = 500

Condition = Literal["reusable", "damaged"]


# ── Inputs ────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class ReceiptLineIn:
    size_id: int
    qty: int


@dataclass(frozen=True, slots=True)
class IssueLineIn:
    item_id: int
    size_id: int | None
    qty: int


@dataclass(frozen=True, slots=True)
class ReturnLineIn:
    item_id: int
    size_id: int | None
    qty: int
    condition: str


@dataclass(frozen=True, slots=True)
class AdjustmentLineIn:
    size_id: int
    delta: int
    expected_on_hand: int


_ITEM_EDITABLE = frozenset(
    {
        "name_en",
        "name_ar",
        "description_en",
        "description_ar",
        "group_key",
        "drawing",
        "default_qty",
        "sort_order",
    }
)


# ── Transaction and validation helpers ────────────────────────────────────────


@contextmanager
def _write(db: Session) -> Iterator[None]:
    """Lock, read, check and write as one serial step; roll back on any failure.

    A unique-index race on the active drawing becomes the same 409 as the
    service check; any other residual constraint violation is a 409 too.
    """
    begin_immediate_if_idle(db)
    try:
        yield
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        message = str(exc.orig)
        if "uniform_items.drawing" in message:
            raise _drawing_in_use() from exc
        if "ck_uniform_sizes_on_hand" in message:
            raise ConflictError(
                "uniform_insufficient_stock", "Not enough stock on the shelf."
            ) from exc
        raise ConflictError(
            "uniform_write_conflict", "Uniform records changed meanwhile; refresh and retry."
        ) from exc
    except BaseException:
        db.rollback()
        raise


def _drawing_in_use(drawing: str | None = None) -> ConflictError:
    return ConflictError(
        "uniform_drawing_in_use", "Another active item already uses this drawing.", drawing=drawing
    )


def _not_future(value: dt.date, field: str) -> dt.date:
    if value > organization_today():
        raise ValidationFailedError(
            "uniform_date_in_future",
            "The date cannot be in the future.",
            field=field,
            value=value.isoformat(),
        )
    return value


def _reason(value: str | None) -> str:
    text = (value or "").strip()
    if not text:
        raise ValidationFailedError("uniform_reason_required", "A reason is required.")
    if len(text) > REASON_MAX:
        raise ValidationFailedError(
            "uniform_reason_too_long", "The reason is too long.", max_length=REASON_MAX
        )
    return text


def _qty(value: int, field: str = "qty") -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= uniform_repo.MAX_QUANTITY
    ):
        raise ValidationFailedError(
            "uniform_invalid_qty", "Quantities must be whole numbers of at least 1.", field=field
        )
    return value


def _require_lines(lines: Sequence[object]) -> None:
    if not lines:
        raise ValidationFailedError("uniform_lines_required", "Add at least one line.")


def _clean_label(label: str) -> str:
    text = (label or "").strip()
    if not text or len(text) > SIZE_LABEL_MAX:
        raise ValidationFailedError(
            "uniform_invalid_size_label",
            "Size labels need 1 to 16 characters.",
            max_length=SIZE_LABEL_MAX,
        )
    return text


def _clean_name(value: str | None, field: str) -> str:
    text = (value or "").strip()
    if not text:
        raise ValidationFailedError(
            "uniform_name_required", "Both names are required.", field=field
        )
    if len(text) > NAME_MAX:
        raise ValidationFailedError("uniform_name_too_long", "The name is too long.", field=field)
    return text


def _clean_description(value: str | None, field: str) -> str | None:
    text = (value or "").strip()
    if len(text) > DESCRIPTION_MAX:
        raise ValidationFailedError(
            "uniform_description_too_long", "The description is too long.", field=field
        )
    return text or None


def _check_group(value: str | None) -> str:
    if value not in GROUPS:
        raise ValidationFailedError("uniform_invalid_group", "Choose a group.", value=value)
    return value


def _check_drawing(value: str | None) -> str:
    if value not in DRAWINGS:
        raise ValidationFailedError("uniform_invalid_drawing", "Choose a drawing.", value=value)
    return value


def _check_default_qty(value: int) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= uniform_repo.MAX_QUANTITY
    ):
        raise ValidationFailedError(
            "uniform_invalid_default_qty", "The default quantity must be at least 1."
        )
    return value


def _get_item(db: Session, item_id: int) -> UniformItem:
    row = db.get(UniformItem, item_id, populate_existing=True)
    if row is None:
        raise NotFoundError("uniform_item_not_found", "Uniform item not found.", item_id=item_id)
    return row


def _get_size(db: Session, size_id: int) -> UniformSize:
    row = db.get(UniformSize, size_id, populate_existing=True)
    if row is None:
        raise NotFoundError("uniform_size_not_found", "Size not found.", size_id=size_id)
    return row


def _require_employee(db: Session, employee_id: str) -> None:
    if db.get(Employee, employee_id) is None:
        raise NotFoundError(
            "uniform_employee_not_found", "Employee not found.", employee_id=employee_id
        )


def _active_item(db: Session, item_id: int) -> UniformItem:
    item = _get_item(db, item_id)
    if item.archived_at is not None:
        raise ValidationFailedError(
            "uniform_item_archived", "This item is archived.", item_id=item_id
        )
    return item


def _active_shelf_size(
    db: Session, size_id: int, *, item: UniformItem | None = None
) -> UniformSize:
    size = _get_size(db, size_id)
    owner = item if item is not None else _active_item(db, size.item_id)
    if size.item_id != owner.id:
        raise ValidationFailedError(
            "uniform_size_mismatch",
            "This size does not belong to the item.",
            item_id=owner.id,
            size_id=size_id,
        )
    if owner.tracking != "shelf":
        raise ValidationFailedError(
            "uniform_size_mismatch", "Holder items have no sizes.", item_id=owner.id
        )
    if size.archived_at is not None:
        raise ValidationFailedError(
            "uniform_size_archived", "This size is archived.", size_id=size_id
        )
    return size


def _on_hand(db: Session, size_id: int) -> int:
    return int(db.scalar(select(UniformSize.on_hand).where(UniformSize.id == size_id)) or 0)


def _take(db: Session, size_id: int, qty: int) -> None:
    """Guarded decrement; a shortage fails the whole request with 409."""
    if uniform_repo.decrement_on_hand(db, size_id, qty) == 0:
        raise ConflictError(
            "uniform_insufficient_stock",
            "Not enough stock on the shelf.",
            size_id=size_id,
            available=_on_hand(db, size_id),
        )


def _put(db: Session, size_id: int, qty: int) -> None:
    if uniform_repo.increment_on_hand(db, size_id, qty) == 0:
        raise ConflictError(
            "uniform_invalid_qty",
            "The resulting stock exceeds the supported quantity.",
            size_id=size_id,
        )


def _touch_size(db: Session, size_id: int) -> None:
    size = db.get(UniformSize, size_id)
    if size is not None:
        size.updated_at = utcnow()
        # Guarded stock SQL bypasses ORM synchronization; invalidate any cached balance.
        db.expire(size, ["on_hand"])


def _void(
    row: UniformReceipt | UniformIssue | UniformReturn | UniformAdjustment,
    reason: str,
    actor_user_id: int | None,
) -> None:
    row.voided_at = utcnow()
    row.voided_by_id = actor_user_id
    row.void_reason = reason


def _require_not_voided(
    row: UniformReceipt | UniformIssue | UniformReturn | UniformAdjustment,
) -> None:
    if row.voided_at is not None:
        raise ConflictError("uniform_already_voided", "This record is already voided.", id=row.id)


# ── Items ─────────────────────────────────────────────────────────────────────


def item_etag(row: UniformItem) -> str:
    return f'"{row.version}"'


def _require_version(row: UniformItem, if_match: str | None) -> None:
    supplied = (if_match or "").strip()
    if supplied.startswith("W/"):
        supplied = supplied[2:]
    if supplied.strip('"') != str(row.version):
        raise AppError(
            "uniform_version_conflict",
            "This item was changed meanwhile; refresh and retry.",
            http_status=status.HTTP_412_PRECONDITION_FAILED,
            details={"item_id": row.id, "version": row.version},
        )


def _name_taken(db: Session, name_en: str, *, exclude_id: int | None = None) -> bool:
    stmt = select(UniformItem.id).where(
        UniformItem.archived_at.is_(None), func.lower(UniformItem.name_en) == name_en.lower()
    )
    if exclude_id is not None:
        stmt = stmt.where(UniformItem.id != exclude_id)
    return db.scalar(stmt) is not None


def _require_drawing_free(db: Session, drawing: str, *, exclude_id: int | None = None) -> None:
    if drawing in uniform_repo.used_drawings(db, exclude_item_id=exclude_id):
        raise _drawing_in_use(drawing)


def _unique_labels(labels: Sequence[str]) -> list[str]:
    cleaned = [_clean_label(label) for label in labels]
    seen: set[str] = set()
    for label in cleaned:
        key = label.lower()
        if key in seen:
            raise ConflictError("uniform_size_exists", "This size already exists.", label=label)
        seen.add(key)
    return cleaned


def create_item(
    db: Session,
    *,
    name_en: str,
    name_ar: str,
    group_key: str,
    drawing: str,
    sizes: Sequence[str],
    default_qty: int = 1,
    description_en: str | None = None,
    description_ar: str | None = None,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> UniformItem:
    """Create a shelf item with at least one size. Holder items are seed-only."""
    clean_en = _clean_name(name_en, "name_en")
    clean_ar = _clean_name(name_ar, "name_ar")
    group = _check_group(group_key)
    kind = _check_drawing(drawing)
    qty = _check_default_qty(default_qty)
    if not sizes:
        raise ValidationFailedError("uniform_sizes_required", "Add at least one size.")
    labels = _unique_labels(sizes)
    if len(labels) > 1 and any(label.lower() == ONE_SIZE for label in labels):
        raise ValidationFailedError("uniform_sizes_fixed", "One size cannot join other sizes.")
    with _write(db):
        if _name_taken(db, clean_en):
            raise ConflictError(
                "uniform_item_name_exists",
                "An active item already has this name.",
                name_en=clean_en,
            )
        _require_drawing_free(db, kind)
        highest = db.scalar(select(UniformItem.sort_order).order_by(UniformItem.sort_order.desc()))
        row = UniformItem(
            name_en=clean_en,
            name_ar=clean_ar,
            description_en=_clean_description(description_en, "description_en"),
            description_ar=_clean_description(description_ar, "description_ar"),
            group_key=group,
            drawing=kind,
            tracking="shelf",
            default_qty=qty,
            sort_order=(highest or 0) + 1,
            created_by_id=actor_user_id,
        )
        row.sizes = [UniformSize(label=label, sort_order=i) for i, label in enumerate(labels)]
        db.add(row)
        db.flush()
        append_audit(
            db,
            action="item.created",
            entity_type="uniform_item",
            entity_id=row.id,
            actor=actor,
            payload={"name_en": clean_en, "drawing": kind, "group_key": group, "sizes": labels},
        )
    return _get_item(db, row.id)


def update_item(
    db: Session,
    item_id: int,
    changes: Mapping[str, Any],
    *,
    if_match: str | None,
    actor: str | None = None,
) -> UniformItem:
    """Edit catalogue fields under If-Match; ``tracking`` never changes."""
    if "tracking" in changes:
        raise ValidationFailedError(
            "uniform_tracking_immutable", "Tracking cannot change after an item is created."
        )
    unknown = sorted(set(changes) - _ITEM_EDITABLE)
    if unknown:
        raise ValidationFailedError(
            "uniform_item_field_unknown", "These fields cannot be edited.", fields=unknown
        )
    data: dict[str, Any] = {}
    for key, value in changes.items():
        if key in ("name_en", "name_ar"):
            data[key] = _clean_name(value, key)
        elif key in ("description_en", "description_ar"):
            data[key] = _clean_description(value, key)
        elif key == "group_key":
            data[key] = _check_group(value)
        elif key == "drawing":
            data[key] = _check_drawing(value)
        elif key == "default_qty":
            data[key] = _check_default_qty(value)
        elif key == "sort_order":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValidationFailedError("uniform_invalid_sort_order", "Invalid order.")
            data[key] = value
    with _write(db):
        row = _get_item(db, item_id)
        _require_version(row, if_match)
        if row.archived_at is None:
            if "name_en" in data and _name_taken(db, data["name_en"], exclude_id=row.id):
                raise ConflictError(
                    "uniform_item_name_exists",
                    "An active item already has this name.",
                    name_en=data["name_en"],
                )
            if "drawing" in data and data["drawing"] != row.drawing:
                _require_drawing_free(db, data["drawing"], exclude_id=row.id)
        before = {key: getattr(row, key) for key in data}
        for key, value in data.items():
            setattr(row, key, value)
        row.version += 1
        row.updated_at = utcnow()
        db.flush()
        append_audit(
            db,
            action="item.updated",
            entity_type="uniform_item",
            entity_id=row.id,
            actor=actor,
            payload={"before": before, "after": data},
        )
    return _get_item(db, item_id)


def _item_holds(db: Session, item_id: int) -> int:
    return sum(h.qty for h in uniform_repo.holdings(db, item_id=item_id))


def archive_item(db: Session, item_id: int, *, actor: str | None = None) -> UniformItem:
    """Archive when the shelf is empty and nobody holds it; frees its drawing."""
    with _write(db):
        row = _get_item(db, item_id)
        if row.archived_at is not None:
            return row
        stocked = {
            sid: qty for sid, qty in uniform_repo.balances(db, item_id=row.id).items() if qty
        }
        if stocked:
            raise ConflictError(
                "uniform_item_has_stock",
                "Items with stock on the shelf cannot be archived.",
                item_id=row.id,
                on_hand=sum(stocked.values()),
            )
        held = _item_holds(db, row.id)
        if held:
            raise ConflictError(
                "uniform_item_has_holders",
                "Items that employees still hold cannot be archived.",
                item_id=row.id,
                held=held,
            )
        row.archived_at = utcnow()
        row.version += 1
        row.updated_at = row.archived_at
        append_audit(
            db,
            action="item.archived",
            entity_type="uniform_item",
            entity_id=row.id,
            actor=actor,
            payload={"name_en": row.name_en, "drawing": row.drawing},
        )
    return _get_item(db, item_id)


def _item_has_postings(db: Session, item_id: int) -> bool:
    size_ids = select(UniformSize.id).where(UniformSize.item_id == item_id)
    return bool(
        db.scalar(
            select(
                exists().where(UniformIssueLine.item_id == item_id)
                | exists().where(UniformReturnLine.item_id == item_id)
                | exists().where(UniformReceiptLine.size_id.in_(size_ids))
                | exists().where(UniformAdjustment.size_id.in_(size_ids))
            )
        )
    )


def delete_item(db: Session, item_id: int, *, actor: str | None = None) -> None:
    """Hard delete only an item no posting has ever referenced."""
    with _write(db):
        row = _get_item(db, item_id)
        if _item_has_postings(db, row.id):
            raise ConflictError(
                "uniform_item_has_history",
                "Items with records are archived, not deleted.",
                item_id=row.id,
            )
        append_audit(
            db,
            action="item.deleted",
            entity_type="uniform_item",
            entity_id=row.id,
            actor=actor,
            payload={"name_en": row.name_en, "drawing": row.drawing},
        )
        db.delete(row)


# ── Sizes ─────────────────────────────────────────────────────────────────────


def _active_sizes(item: UniformItem) -> list[UniformSize]:
    return [size for size in item.sizes if size.archived_at is None]


def _label_taken(item: UniformItem, label: str, *, exclude_id: int | None = None) -> bool:
    return any(
        size.label.lower() == label.lower() and size.id != exclude_id
        for size in _active_sizes(item)
    )


def _check_min_qty(value: int | None) -> int | None:
    if value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value <= uniform_repo.MAX_QUANTITY
    ):
        raise ValidationFailedError("uniform_invalid_min_qty", "Alert level must be 0 or more.")
    return value


def add_size(
    db: Session,
    item_id: int,
    *,
    label: str,
    min_qty: int | None = None,
    actor: str | None = None,
) -> UniformSize:
    clean = _clean_label(label)
    minimum = _check_min_qty(min_qty)
    with _write(db):
        item = _active_item(db, item_id)
        active = _active_sizes(item)
        if item.tracking != "shelf" or any(s.label.lower() == ONE_SIZE for s in active):
            raise ValidationFailedError(
                "uniform_sizes_fixed", "This item cannot have more sizes.", item_id=item.id
            )
        if clean.lower() == ONE_SIZE and active:
            raise ValidationFailedError(
                "uniform_sizes_fixed", "One size cannot join other sizes.", item_id=item.id
            )
        if _label_taken(item, clean):
            raise ConflictError("uniform_size_exists", "This size already exists.", label=clean)
        highest = max((s.sort_order for s in item.sizes), default=-1)
        size = UniformSize(item_id=item.id, label=clean, sort_order=highest + 1, min_qty=minimum)
        item.sizes.append(size)
        db.flush()
        append_audit(
            db,
            action="size.added",
            entity_type="uniform_size",
            entity_id=size.id,
            actor=actor,
            payload={"item_id": item.id, "label": clean, "min_qty": minimum},
        )
    return _get_size(db, size.id)


def update_size(
    db: Session,
    size_id: int,
    changes: Mapping[str, Any],
    *,
    actor: str | None = None,
) -> UniformSize:
    unknown = sorted(set(changes) - {"label", "sort_order", "min_qty"})
    if unknown:
        raise ValidationFailedError(
            "uniform_size_field_unknown", "These fields cannot be edited.", fields=unknown
        )
    data: dict[str, Any] = {}
    if "label" in changes:
        data["label"] = _clean_label(changes["label"])
    if "min_qty" in changes:
        data["min_qty"] = _check_min_qty(changes["min_qty"])
    if "sort_order" in changes:
        value = changes["sort_order"]
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValidationFailedError("uniform_invalid_sort_order", "Invalid order.")
        data["sort_order"] = value
    with _write(db):
        size = _get_size(db, size_id)
        if size.archived_at is not None:
            raise ValidationFailedError("uniform_size_archived", "This size is archived.")
        item = _active_item(db, size.item_id)
        if "label" in data:
            label = data["label"].lower()
            if (size.label.lower() == ONE_SIZE and label != ONE_SIZE) or (
                label == ONE_SIZE and len(_active_sizes(item)) > 1
            ):
                raise ValidationFailedError(
                    "uniform_sizes_fixed", "One size cannot join other sizes.", item_id=item.id
                )
        if "label" in data and _label_taken(item, data["label"], exclude_id=size.id):
            raise ConflictError(
                "uniform_size_exists", "This size already exists.", label=data["label"]
            )
        before = {key: getattr(size, key) for key in data}
        for key, value in data.items():
            setattr(size, key, value)
        size.updated_at = utcnow()
        append_audit(
            db,
            action="size.updated",
            entity_type="uniform_size",
            entity_id=size.id,
            actor=actor,
            payload={"item_id": item.id, "before": before, "after": data},
        )
    return _get_size(db, size_id)


def _size_has_postings(db: Session, size_id: int) -> bool:
    return bool(
        db.scalar(
            select(
                exists().where(UniformReceiptLine.size_id == size_id)
                | exists().where(UniformIssueLine.size_id == size_id)
                | exists().where(UniformReturnLine.size_id == size_id)
                | exists().where(UniformAdjustment.size_id == size_id)
            )
        )
    )


def remove_size(
    db: Session, size_id: int, *, actor: str | None = None
) -> Literal["archived", "deleted"]:
    """Remove an empty, unheld size: archive it if referenced, else delete it."""
    with _write(db):
        size = _get_size(db, size_id)
        if size.archived_at is not None:
            return "archived"
        if size.on_hand:
            raise ConflictError(
                "uniform_size_has_stock",
                "Sizes with stock on the shelf cannot be removed.",
                size_id=size.id,
                on_hand=size.on_hand,
            )
        held = sum(
            h.qty for h in uniform_repo.holdings(db, item_id=size.item_id) if h.size_id == size.id
        )
        if held:
            raise ConflictError(
                "uniform_size_has_holders",
                "Sizes that employees still hold cannot be removed.",
                size_id=size.id,
                held=held,
            )
        outcome: Literal["archived", "deleted"]
        if _size_has_postings(db, size.id):
            size.archived_at = utcnow()
            size.updated_at = size.archived_at
            outcome = "archived"
        else:
            db.delete(size)
            outcome = "deleted"
        append_audit(
            db,
            action=f"size.{outcome}",
            entity_type="uniform_size",
            entity_id=size_id,
            actor=actor,
            payload={"item_id": size.item_id, "label": size.label},
        )
    return outcome


# ── Receipts ──────────────────────────────────────────────────────────────────


def create_receipt(
    db: Session,
    *,
    received_on: dt.date,
    lines: Sequence[ReceiptLineIn],
    reference: str | None = None,
    note: str | None = None,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> UniformReceipt:
    _not_future(received_on, "received_on")
    _require_lines(lines)
    merged: dict[int, int] = defaultdict(int)
    for line in lines:
        merged[line.size_id] = _qty(merged[line.size_id] + _qty(line.qty))
    with _write(db):
        for size_id in merged:
            _active_shelf_size(db, size_id)
        row = UniformReceipt(
            received_on=received_on,
            reference=(reference or "").strip() or None,
            note=(note or "").strip() or None,
            created_by_id=actor_user_id,
        )
        row.lines = [UniformReceiptLine(size_id=s, qty=q) for s, q in merged.items()]
        db.add(row)
        for size_id, qty in merged.items():
            _put(db, size_id, qty)
            _touch_size(db, size_id)
        db.flush()
        append_audit(
            db,
            action="receipt.created",
            entity_type="uniform_receipt",
            entity_id=row.id,
            actor=actor,
            payload={"received_on": received_on, "lines": dict(merged)},
        )
    return row


def void_receipt(
    db: Session,
    receipt_id: int,
    *,
    reason: str,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> UniformReceipt:
    text = _reason(reason)
    with _write(db):
        row = db.get(UniformReceipt, receipt_id, populate_existing=True)
        if row is None:
            raise NotFoundError("uniform_receipt_not_found", "Receipt not found.", id=receipt_id)
        _require_not_voided(row)
        for line in row.lines:
            _active_shelf_size(db, line.size_id)
            _take(db, line.size_id, line.qty)
            _touch_size(db, line.size_id)
        _void(row, text, actor_user_id)
        append_audit(
            db,
            action="receipt.voided",
            entity_type="uniform_receipt",
            entity_id=row.id,
            actor=actor,
            payload={"reason": text},
        )
    return row


# ── Hand-outs ─────────────────────────────────────────────────────────────────


def _resolve_item_line(
    db: Session, item_id: int, size_id: int | None
) -> tuple[UniformItem, UniformSize | None]:
    item = _active_item(db, item_id)
    if item.tracking == "holder":
        if size_id is not None:
            raise ValidationFailedError(
                "uniform_size_mismatch", "Holder items have no sizes.", item_id=item.id
            )
        return item, None
    if size_id is None:
        raise ValidationFailedError("uniform_size_required", "Choose a size.", item_id=item.id)
    return item, _active_shelf_size(db, size_id, item=item)


def create_issue(
    db: Session,
    *,
    employee_id: str,
    lines: Sequence[IssueLineIn],
    issued_on: dt.date | None = None,
    note: str | None = None,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> UniformIssue:
    on = _not_future(issued_on or organization_today(), "issued_on")
    _require_lines(lines)
    merged: dict[tuple[int, int | None], int] = defaultdict(int)
    for line in lines:
        key = (line.item_id, line.size_id)
        merged[key] = _qty(merged[key] + _qty(line.qty))
    with _write(db):
        _require_employee(db, employee_id)
        for item_id, size_id in merged:
            _resolve_item_line(db, item_id, size_id)
        for (_, size_id), qty in merged.items():
            if size_id is not None:
                _take(db, size_id, qty)
                _touch_size(db, size_id)
        row = UniformIssue(
            employee_id=employee_id,
            issued_on=on,
            note=(note or "").strip() or None,
            created_by_id=actor_user_id,
        )
        row.lines = [UniformIssueLine(item_id=i, size_id=s, qty=q) for (i, s), q in merged.items()]
        db.add(row)
        db.flush()
        append_audit(
            db,
            action="issue.created",
            entity_type="uniform_issue",
            entity_id=row.id,
            actor=actor,
            payload={
                "employee_id": employee_id,
                "issued_on": on,
                "lines": [{"item_id": i, "size_id": s, "qty": q} for (i, s), q in merged.items()],
            },
        )
    return row


def void_issue(
    db: Session,
    issue_id: int,
    *,
    reason: str,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> UniformIssue:
    """Undo a hand-out; refused if a later return depends on it."""
    text = _reason(reason)
    with _write(db):
        row = db.get(UniformIssue, issue_id, populate_existing=True)
        if row is None:
            raise NotFoundError("uniform_issue_not_found", "Hand-out not found.", id=issue_id)
        _require_not_voided(row)
        for line in row.lines:
            _resolve_item_line(db, line.item_id, line.size_id)
            held = uniform_repo.held_qty(
                db, employee_id=row.employee_id, item_id=line.item_id, size_id=line.size_id
            )
            if held - line.qty < 0:
                raise ConflictError(
                    "uniform_void_breaks_holdings",
                    "A later return depends on this hand-out; void that return first.",
                    item_id=line.item_id,
                    size_id=line.size_id,
                    held=held,
                )
        for line in row.lines:
            if line.size_id is not None:
                _put(db, line.size_id, line.qty)
                _touch_size(db, line.size_id)
        _void(row, text, actor_user_id)
        append_audit(
            db,
            action="issue.voided",
            entity_type="uniform_issue",
            entity_id=row.id,
            actor=actor,
            payload={"employee_id": row.employee_id, "reason": text},
        )
    return row


# ── Returns ───────────────────────────────────────────────────────────────────


def create_return(
    db: Session,
    *,
    employee_id: str,
    lines: Sequence[ReturnLineIn],
    returned_on: dt.date | None = None,
    note: str | None = None,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> UniformReturn:
    """Record returned pieces; only reusable shelf pieces go back on the shelf."""
    on = _not_future(returned_on or organization_today(), "returned_on")
    _require_lines(lines)
    merged: dict[tuple[int, int | None, str], int] = defaultdict(int)
    for line in lines:
        if line.condition not in CONDITIONS:
            raise ValidationFailedError(
                "uniform_invalid_condition", "Choose reusable or damaged.", value=line.condition
            )
        key = (line.item_id, line.size_id, line.condition)
        merged[key] = _qty(merged[key] + _qty(line.qty))
    wanted: dict[tuple[int, int | None], int] = defaultdict(int)
    for (item_id, size_id, _), qty in merged.items():
        wanted[(item_id, size_id)] += qty
    with _write(db):
        _require_employee(db, employee_id)
        for (item_id, size_id), qty in wanted.items():
            item = _get_item(db, item_id)
            if (item.tracking == "holder") != (size_id is None):
                raise ValidationFailedError(
                    "uniform_size_mismatch",
                    "Shelf items need a size and holder items have none.",
                    item_id=item_id,
                )
            if size_id is not None and _get_size(db, size_id).item_id != item_id:
                raise ValidationFailedError(
                    "uniform_size_mismatch",
                    "This size does not belong to the item.",
                    item_id=item_id,
                    size_id=size_id,
                )
            held = uniform_repo.held_qty(
                db, employee_id=employee_id, item_id=item_id, size_id=size_id
            )
            if qty > held:
                raise ValidationFailedError(
                    "uniform_over_return",
                    "More pieces than the employee holds.",
                    item_id=item_id,
                    size_id=size_id,
                    held=held,
                )
        row = UniformReturn(
            employee_id=employee_id,
            returned_on=on,
            note=(note or "").strip() or None,
            created_by_id=actor_user_id,
        )
        row.lines = [
            UniformReturnLine(item_id=i, size_id=s, qty=q, condition=c)
            for (i, s, c), q in merged.items()
        ]
        db.add(row)
        for (_, size_id, condition), qty in merged.items():
            if size_id is not None and condition == "reusable":
                _put(db, size_id, qty)
                _touch_size(db, size_id)
        db.flush()
        append_audit(
            db,
            action="return.created",
            entity_type="uniform_return",
            entity_id=row.id,
            actor=actor,
            payload={
                "employee_id": employee_id,
                "returned_on": on,
                "lines": [
                    {"item_id": i, "size_id": s, "qty": q, "condition": c}
                    for (i, s, c), q in merged.items()
                ],
            },
        )
    return row


def void_return(
    db: Session,
    return_id: int,
    *,
    reason: str,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> UniformReturn:
    text = _reason(reason)
    with _write(db):
        row = db.get(UniformReturn, return_id, populate_existing=True)
        if row is None:
            raise NotFoundError("uniform_return_not_found", "Return not found.", id=return_id)
        _require_not_voided(row)
        for line in row.lines:
            _resolve_item_line(db, line.item_id, line.size_id)
            if line.size_id is not None and line.condition == "reusable":
                _take(db, line.size_id, line.qty)
                _touch_size(db, line.size_id)
        _void(row, text, actor_user_id)
        append_audit(
            db,
            action="return.voided",
            entity_type="uniform_return",
            entity_id=row.id,
            actor=actor,
            payload={"employee_id": row.employee_id, "reason": text},
        )
    return row


# ── Adjustments ───────────────────────────────────────────────────────────────


def create_adjustments(
    db: Session,
    *,
    lines: Sequence[AdjustmentLineIn],
    reason: str,
    adjusted_on: dt.date | None = None,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> list[UniformAdjustment]:
    """One reasoned count correction per line, all in one transaction."""
    text = _reason(reason)
    on = _not_future(adjusted_on or organization_today(), "adjusted_on")
    _require_lines(lines)
    initial: dict[int, int] = {}
    for line in lines:
        if (
            isinstance(line.delta, bool)
            or not isinstance(line.delta, int)
            or not 0 < abs(line.delta) <= uniform_repo.MAX_QUANTITY
        ):
            raise ValidationFailedError(
                "uniform_invalid_delta", "Adjustments must change the count.", size_id=line.size_id
            )
        if (
            isinstance(line.expected_on_hand, bool)
            or not isinstance(line.expected_on_hand, int)
            or not 0 <= line.expected_on_hand <= uniform_repo.MAX_QUANTITY
        ):
            raise ValidationFailedError(
                "uniform_invalid_expected_on_hand", "Expected stock must be 0 or more."
            )
    with _write(db):
        # Every line compares with the same pre-write snapshot, including repeated sizes.
        for line in lines:
            if line.size_id not in initial:
                initial[line.size_id] = _active_shelf_size(db, line.size_id).on_hand
            available = initial[line.size_id]
            if line.expected_on_hand != available:
                raise ConflictError(
                    "uniform_stale_count",
                    "Stock changed meanwhile; refresh and retry.",
                    size_id=line.size_id,
                    expected_on_hand=line.expected_on_hand,
                    available=available,
                )
        rows: list[UniformAdjustment] = []
        for line in lines:
            if line.delta < 0:
                _take(db, line.size_id, -line.delta)
            else:
                _put(db, line.size_id, line.delta)
            _touch_size(db, line.size_id)
            row = UniformAdjustment(
                size_id=line.size_id,
                delta=line.delta,
                reason=text,
                adjusted_on=on,
                created_by_id=actor_user_id,
            )
            db.add(row)
            rows.append(row)
        db.flush()
        for row in rows:
            append_audit(
                db,
                action="adjustment.created",
                entity_type="uniform_adjustment",
                entity_id=row.id,
                actor=actor,
                payload={"size_id": row.size_id, "delta": row.delta, "reason": text},
            )
    return rows


def void_adjustment(
    db: Session,
    adjustment_id: int,
    *,
    reason: str,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> UniformAdjustment:
    text = _reason(reason)
    with _write(db):
        row = db.get(UniformAdjustment, adjustment_id, populate_existing=True)
        if row is None:
            raise NotFoundError(
                "uniform_adjustment_not_found", "Adjustment not found.", id=adjustment_id
            )
        _require_not_voided(row)
        _active_shelf_size(db, row.size_id)
        if row.delta > 0:
            _take(db, row.size_id, row.delta)
        else:
            _put(db, row.size_id, -row.delta)
        _touch_size(db, row.size_id)
        _void(row, text, actor_user_id)
        append_audit(
            db,
            action="adjustment.voided",
            entity_type="uniform_adjustment",
            entity_id=row.id,
            actor=actor,
            payload={"size_id": row.size_id, "delta": row.delta, "reason": text},
        )
    return row


# ── Listing (newest first by date then id; voided rows included) ──────────────


def _size_read(row: UniformSize, held_qty: int) -> UniformSizeRead:
    result = UniformSizeRead.model_validate(row)
    result.held_qty = held_qty
    result.is_low = row.min_qty is not None and row.on_hand <= row.min_qty
    return result


def size_read(db: Session, row: UniformSize) -> UniformSizeRead:
    held = sum(h.qty for h in uniform_repo.holdings(db, item_id=row.item_id) if h.size_id == row.id)
    return _size_read(row, held)


def _item_reads(
    db: Session, rows: Sequence[UniformItem], *, include_archived: bool = False
) -> list[UniformItemRead]:
    if not rows:
        return []
    holdings = uniform_repo.holdings(db, item_id=rows[0].id if len(rows) == 1 else None)
    by_item: dict[int, list[uniform_repo.Holding]] = defaultdict(list)
    held_by_size: dict[int, int] = defaultdict(int)
    holder_items = {row.id for row in rows if row.tracking == "holder"}
    employee_ids: set[str] = set()
    for holding in holdings:
        by_item[holding.item_id].append(holding)
        if holding.size_id is not None:
            held_by_size[holding.size_id] += holding.qty
        if holding.item_id in holder_items:
            employee_ids.add(holding.employee_id)
    employees = (
        {
            employee.id: employee
            for employee in db.scalars(select(Employee).where(Employee.id.in_(employee_ids)))
        }
        if employee_ids
        else {}
    )
    return [
        UniformItemRead.model_validate(
            {
                **{
                    key: getattr(row, key)
                    for key in UniformItemRead.model_fields
                    if key not in {"version", "sizes", "holders"}
                },
                "version": item_etag(row),
                "sizes": [
                    _size_read(size, held_by_size[size.id])
                    for size in row.sizes
                    if include_archived or size.archived_at is None
                ],
                "holders": [
                    UniformHolder(
                        employee_id=h.employee_id,
                        name_en=employees[h.employee_id].name_en,
                        name_ar=employees[h.employee_id].name_ar,
                        qty=h.qty,
                    )
                    for h in by_item[row.id]
                ]
                if row.tracking == "holder"
                else [],
            }
        )
        for row in rows
    ]


def item_read(db: Session, row: UniformItem) -> UniformItemRead:
    return _item_reads(db, [row])[0]


def item_reads(db: Session, *, include_archived: bool = False) -> list[UniformItemRead]:
    return _item_reads(
        db,
        uniform_repo.list_items(db, include_archived=include_archived),
        include_archived=include_archived,
    )


def recipients(db: Session, *, q: str = "") -> list[UniformRecipient]:
    held: dict[str, int] = defaultdict(int)
    for holding in uniform_repo.holdings(db):
        held[holding.employee_id] += holding.qty
    totals: dict[str, tuple[int, dt.date]] = {}
    for row in list_issues(db):
        if row.voided_at is not None:
            continue
        previous, last_on = totals.get(row.employee_id, (0, row.issued_on))
        totals[row.employee_id] = (
            previous + sum(line.qty for line in row.lines),
            max(last_on, row.issued_on),
        )
    employees = db.scalars(select(Employee).where(Employee.id.in_(totals)))
    query = q.casefold()
    return [
        UniformRecipient(
            employee_id=employee.id,
            name_en=employee.name_en,
            name_ar=employee.name_ar,
            held_total=held[employee.id],
            issued_total=totals[employee.id][0],
            last_issued_on=totals[employee.id][1],
        )
        for employee in employees
        if query in f"{employee.id} {employee.name_en} {employee.name_ar or ''}".casefold()
    ]


def employee_read(db: Session, employee_id: str) -> UniformEmployeeRead:
    _require_employee(db, employee_id)
    return UniformEmployeeRead(
        holdings=[
            UniformHolding.model_validate(holding)
            for holding in uniform_repo.holdings(db, employee_id=employee_id)
        ],
        issues=issue_reads(db, list_issues(db, employee_id=employee_id)),
        returns=return_reads(db, list_returns(db, employee_id=employee_id)),
    )


def summary(db: Session) -> UniformSummary:
    active = uniform_repo.list_items(db)
    sizes = [
        size
        for item in active
        if item.tracking == "shelf"
        for size in item.sizes
        if size.archived_at is None
    ]
    holder_items = {item.id for item in active if item.tracking == "holder"}
    holdings = [h for h in uniform_repo.holdings(db) if h.item_id in holder_items]
    return UniformSummary(
        shelf_total=sum(size.on_hand for size in sizes),
        holder_count=len({h.employee_id for h in holdings}),
        suits_issued=sum(h.qty for h in holdings),
        out_of_stock=sum(size.on_hand == 0 for size in sizes),
        low_sizes=sum(size.min_qty is not None and size.on_hand <= size.min_qty for size in sizes),
    )


def _actor_names(
    db: Session, rows: Sequence[UniformIssue] | Sequence[UniformReturn]
) -> dict[int, tuple[str | None, str | None]]:
    """Resolve linked employee names in bulk, without the Store email fallback."""
    ids = {row.created_by_id for row in rows if row.created_by_id is not None}
    if not ids:
        return {}
    return {
        user_id: (name_en or display_name, name_ar)
        for user_id, name_en, name_ar, display_name in db.execute(
            select(User.id, Employee.name_en, Employee.name_ar, User.display_name)
            .outerjoin(Employee, User.employee_id == Employee.id)
            .where(User.id.in_(ids))
        )
    }


def issue_reads(db: Session, rows: Sequence[UniformIssue]) -> list[UniformIssueRead]:
    names = _actor_names(db, rows)
    result = []
    for row in rows:
        read = UniformIssueRead.model_validate(row)
        read.given_by_name_en, read.given_by_name_ar = (
            names.get(row.created_by_id, (None, None))
            if row.created_by_id is not None
            else (None, None)
        )
        result.append(read)
    return result


def return_reads(db: Session, rows: Sequence[UniformReturn]) -> list[UniformReturnRead]:
    names = _actor_names(db, rows)
    result = []
    for row in rows:
        read = UniformReturnRead.model_validate(row)
        read.received_by_name_en, read.received_by_name_ar = (
            names.get(row.created_by_id, (None, None))
            if row.created_by_id is not None
            else (None, None)
        )
        result.append(read)
    return result


def list_receipts(db: Session) -> list[UniformReceipt]:
    stmt = select(UniformReceipt).order_by(
        UniformReceipt.received_on.desc(), UniformReceipt.id.desc()
    )
    return list(db.scalars(stmt))


def list_issues(db: Session, *, employee_id: str | None = None) -> list[UniformIssue]:
    stmt = (
        select(UniformIssue)
        .options(selectinload(UniformIssue.lines))
        .order_by(UniformIssue.issued_on.desc(), UniformIssue.id.desc())
    )
    if employee_id is not None:
        stmt = stmt.where(UniformIssue.employee_id == employee_id)
    return list(db.scalars(stmt))


def list_returns(db: Session, *, employee_id: str | None = None) -> list[UniformReturn]:
    stmt = (
        select(UniformReturn)
        .options(selectinload(UniformReturn.lines))
        .order_by(UniformReturn.returned_on.desc(), UniformReturn.id.desc())
    )
    if employee_id is not None:
        stmt = stmt.where(UniformReturn.employee_id == employee_id)
    return list(db.scalars(stmt))


def list_adjustments(db: Session) -> list[UniformAdjustment]:
    stmt = select(UniformAdjustment).order_by(
        UniformAdjustment.adjusted_on.desc(), UniformAdjustment.id.desc()
    )
    return list(db.scalars(stmt))
