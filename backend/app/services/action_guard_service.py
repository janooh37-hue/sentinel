"""Read-only action decisions shared by route guards and access diagnostics.

Capabilities are supplied explicitly so preview overlays never mutate persisted
policy. Record checks reuse the record service's revision/grade/assignment
resolution; this module must not grow a parallel visibility query.
"""

from __future__ import annotations

from collections.abc import Callable, Collection
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.core import grades
from app.db.models import Book, User


@dataclass(frozen=True)
class GuardDecision:
    allowed: bool
    rule_id: str
    blockers: tuple[str, ...] = ()
    error: AppError | None = None
    access: Any = None

    def require(self) -> Any:
        if self.error is not None:
            raise self.error
        return self.access


def capabilities_decision(
    caps: Collection[str], required: Collection[str], *, rule_id: str
) -> GuardDecision:
    missing = tuple(capability for capability in required if capability not in caps)
    if not missing:
        return GuardDecision(True, rule_id)
    capability = missing[0]
    return GuardDecision(
        False,
        rule_id,
        missing,
        AppError(
            "FORBIDDEN",
            f"Missing capability: {capability}",
            http_status=403,
            details={"capability": capability},
        ),
    )


def capability_decision(caps: Collection[str], capability: str) -> GuardDecision:
    return capabilities_decision(caps, (capability,), rule_id="capability.required")


def record_type_decision(
    caps: Collection[str],
    *,
    category_id: str | None = None,
    service_id: str | None = None,
    classification_code: str | None = None,
    category_exists: bool = True,
) -> GuardDecision:
    if category_id is not None and not category_exists:
        return GuardDecision(
            False,
            "record.type",
            error=NotFoundError(
                "BOOK_CATEGORY_NOT_FOUND",
                f"Book category {category_id!r} does not exist",
                category_id=category_id,
            ),
        )
    required = []
    if category_id is not None:
        required.append(f"books.category.{category_id}")
    if service_id is not None:
        required.append(f"books.service.{service_id}")
    if classification_code is not None:
        required.append(f"books.category.{classification_code}")
    missing = tuple(capability for capability in required if capability not in caps)
    return GuardDecision(
        not missing,
        "record.type",
        missing,
        AppError(
            "RECORD_TYPE_FORBIDDEN", "You don't have access to this record type.", http_status=403
        )
        if missing
        else None,
    )


def service_create_decision(
    caps: Collection[str],
    service_id: str,
    *,
    category_id: str | None = None,
    classification_code: str | None = None,
    grade: str | None = None,
    category_exists: bool = True,
) -> GuardDecision:
    prerequisites = capabilities_decision(
        caps, ("documents.generate", "books.view"), rule_id="service.create"
    )
    if not prerequisites.allowed:
        return prerequisites
    record_type = record_type_decision(
        caps,
        category_id=category_id,
        service_id=service_id,
        category_exists=category_exists,
        classification_code=classification_code if service_id == "General Book" else None,
    )
    if not record_type.allowed:
        return record_type
    if grade == grades.SECRET and "books.secret" not in caps:
        return GuardDecision(
            False,
            "record.grade.create",
            ("books.secret",),
            AppError(
                "SECRET_CLEARANCE_REQUIRED",
                "Secret clearance is required for Secret records.",
                http_status=403,
            ),
        )
    return GuardDecision(True, "service.create")


def service_browse_decision(caps: Collection[str], service_id: str) -> GuardDecision:
    return capabilities_decision(
        caps, ("books.view", f"books.servicerecords.{service_id}"), rule_id="service.browse"
    )


def duty_transfer_decision(
    caps: Collection[str], *, initial_placement: bool, category_exists: bool = True
) -> GuardDecision:
    prerequisites = capabilities_decision(
        caps, ("documents.generate", "documents.duty_transfer"), rule_id="duty.transfer"
    )
    if not prerequisites.allowed or initial_placement:
        return prerequisites
    return record_type_decision(
        caps,
        category_id="GS",
        service_id="General Book",
        classification_code="12/1",
        category_exists=category_exists,
    )


def template_decision(caps: Collection[str], kind: str, action: str) -> GuardDecision:
    if kind in ("notification_template", "email_template"):
        if action in ("view", "read"):
            return GuardDecision(True, "template.signed_in_view")
        if action not in ("edit", "reset"):
            raise ValueError("Unsupported message template action")
        required = ("messages.templates",)
    elif kind == "word_template":
        if action in ("view", "read"):
            required = ("books.edit",)
        elif action in ("create", "edit", "reset", "delete", "manage"):
            required = ("books.templates",)
        else:
            raise ValueError("Unsupported Word template action")
    elif kind == "editor_template":
        if action not in ("view", "read", "create", "edit", "delete", "manage"):
            raise ValueError("Unsupported editor template action")
        required = ("editor_templates.manage",)
    else:
        raise ValueError("Unsupported template family")
    return capabilities_decision(caps, required, rule_id=f"template.{kind}.{action}")


def _record_decision(rule_id: str, check: Callable[[], Any]) -> GuardDecision:
    try:
        access = check()
    except AppError as error:
        capability = error.details.get("capability") if error.details else None
        blockers = (capability,) if isinstance(capability, str) else ()
        return GuardDecision(False, rule_id, blockers, error)
    return GuardDecision(True, rule_id, access=access)


def book_read_decision(
    db: Session, user: User, book: Book, *, version_id: int | None = None
) -> GuardDecision:
    from app.services import book_service

    return _record_decision(
        "record.read.exact_revision",
        lambda: book_service._resolve_book_read_access(db, user, book, version_id=version_id),
    )


def book_edit_decision(
    db: Session, user: User, book: Book, *, version_id: int | None = None
) -> GuardDecision:
    from app.services import book_service, perm_service

    def check() -> None:
        capability_decision(perm_service.effective_caps(db, user), "books.edit").require()
        if book.deleted_at is not None:
            raise NotFoundError("BOOK_NOT_FOUND", "Record not found")
        book_service.require_full_book_access(db, user, book, write=True)
        if version_id is not None:
            current = max(book.versions, key=lambda version: version.version_no, default=None)
            if not any(version.id == version_id for version in book.versions):
                raise NotFoundError("VERSION_NOT_FOUND", "Revision not found")
            if current is None or current.id != version_id:
                raise AppError(
                    "FORBIDDEN", "Only the current revision can be edited.", http_status=403
                )
        book_service.require_ledger_revision_unlocked(db, book)

    return _record_decision("record.edit.current_revision", check)


def revision_workflow_decision(book: Book) -> GuardDecision:
    from app.services import book_service

    def check() -> None:
        book_service.require_not_ledger_book(book)
        if book.approval_state not in ("returned", "rejected", "none", "awaiting_scan"):
            raise ValidationFailedError(
                "BOOK_NOT_REVISABLE",
                "Only a draft, returned, rejected, or awaiting-scan book can be revised",
                state=book.approval_state,
            )

    return _record_decision("record.revise.workflow", check)


def book_revise_authority_decision(db: Session, user: User, book: Book | None) -> GuardDecision:
    """Authorize stored-field access independently of regeneration readiness."""
    from app.services import book_service

    return _record_decision(
        "record.revise.authority",
        lambda: book_service._require_revise_authority(db, user, book),
    )


def book_revise_decision(db: Session, user: User, book: Book | None) -> GuardDecision:
    def check() -> Any:
        version = book_revise_authority_decision(db, user, book).require()
        if book is not None:
            revision_workflow_decision(book).require()
        return version

    return _record_decision("record.revise", check)
