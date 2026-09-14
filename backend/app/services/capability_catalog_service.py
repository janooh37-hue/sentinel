"""Bilingual capability metadata for API, request, and notification consumers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
from app.core.permissions import (
    CAPABILITIES,
    CATEGORY_CAP_PREFIX,
    ROLE_DEFAULTS,
    SERVICE_CAP_PREFIX,
    SERVICE_RECORDS_CAP_PREFIX,
    Capability,
)
from app.db.models import BookCategory

_ROLE_ORDER: Final[tuple[str, ...]] = ("operator", "manager", "admin")
_SERVICE_IDS: Final[tuple[str, ...]] = (*SERVICE_IDS, OTHER_SERVICE_ID)


@dataclass(frozen=True, slots=True)
class CapabilityCatalogEntry:
    """One capability's display metadata and request policy."""

    id: str
    domain: str
    label_en: str
    label_ar: str | None
    description_en: str
    description_ar: str | None
    sensitive: bool
    requestable: bool
    default_roles: tuple[str, ...]


def _static_entry(capability: Capability) -> CapabilityCatalogEntry:
    return CapabilityCatalogEntry(
        id=capability.id,
        domain=capability.domain,
        label_en=capability.label_en,
        label_ar=capability.label_ar,
        description_en=capability.description_en,
        description_ar=capability.description_ar,
        sensitive=capability.sensitive,
        requestable=capability.requestable,
        default_roles=tuple(role for role in _ROLE_ORDER if capability.id in ROLE_DEFAULTS[role]),
    )


_STATIC_BY_ID: Final[dict[str, CapabilityCatalogEntry]] = {
    capability.id: _static_entry(capability) for capability in CAPABILITIES
}


def _service_names(service_id: str) -> tuple[str, str | None]:
    if service_id == OTHER_SERVICE_ID:
        return "Other", "أخرى"

    # Reuse the existing cached metadata authority directly. Importing
    # template_service would also calculate signing, DOCX-code, and notification
    # properties that the capability catalog neither owns nor needs.
    from app.services.document_service import load_fields_meta

    metadata = load_fields_meta().get(service_id, {})
    label_en = str(metadata.get("name_en") or service_id).strip() or service_id
    label_ar = str(metadata.get("name_ar") or "").strip() or None
    return label_en, label_ar


def _service_entries(service_id: str) -> tuple[CapabilityCatalogEntry, ...]:
    label_en, label_ar = _service_names(service_id)
    return (
        CapabilityCatalogEntry(
            id=f"{SERVICE_CAP_PREFIX}{service_id}",
            domain="services",
            label_en=label_en,
            label_ar=label_ar,
            description_en=f"Create {label_en} records.",
            description_ar=f"إنشاء سجلات {label_ar}." if label_ar else None,
            sensitive=False,
            requestable=True,
            default_roles=_ROLE_ORDER,
        ),
        CapabilityCatalogEntry(
            id=f"{SERVICE_RECORDS_CAP_PREFIX}{service_id}",
            domain="books",
            label_en=f"Records: {label_en}",
            label_ar=f"السجلات: {label_ar}" if label_ar else None,
            description_en=f"View {label_en} records.",
            description_ar=f"عرض سجلات {label_ar}." if label_ar else None,
            sensitive=False,
            requestable=True,
            default_roles=_ROLE_ORDER,
        ),
    )


def _category_entry(category: BookCategory) -> CapabilityCatalogEntry:
    capability_id = f"{CATEGORY_CAP_PREFIX}{category.id}"
    label_en = (category.name_en or "").strip() or capability_id
    label_ar = (category.name_ar or "").strip() or None
    return CapabilityCatalogEntry(
        id=capability_id,
        domain="categories",
        label_en=label_en,
        label_ar=label_ar,
        description_en=f"View records in {label_en}.",
        description_ar=f"عرض السجلات ضمن {label_ar}." if label_ar else None,
        sensitive=False,
        requestable=True,
        default_roles=_ROLE_ORDER,
    )


def list_catalog(db: Session) -> tuple[CapabilityCatalogEntry, ...]:
    """Return the complete catalog in stable presentation order."""
    static = tuple(_STATIC_BY_ID[capability.id] for capability in CAPABILITIES)
    services = tuple(entry for service_id in _SERVICE_IDS for entry in _service_entries(service_id))
    categories = tuple(
        _category_entry(category)
        for category in db.scalars(select(BookCategory).order_by(BookCategory.id)).all()
    )
    return (*static, *services, *categories)


def get_catalog_entry(db: Session, capability_id: str) -> CapabilityCatalogEntry | None:
    """Resolve one static, service, or current category capability."""
    static = _STATIC_BY_ID.get(capability_id)
    if static is not None:
        return static

    if capability_id.startswith(SERVICE_RECORDS_CAP_PREFIX):
        service_id = capability_id.removeprefix(SERVICE_RECORDS_CAP_PREFIX)
        if service_id in _SERVICE_IDS:
            return _service_entries(service_id)[1]
        return None

    if capability_id.startswith(SERVICE_CAP_PREFIX):
        service_id = capability_id.removeprefix(SERVICE_CAP_PREFIX)
        if service_id in _SERVICE_IDS:
            return _service_entries(service_id)[0]
        return None

    if capability_id.startswith(CATEGORY_CAP_PREFIX):
        category_id = capability_id.removeprefix(CATEGORY_CAP_PREFIX)
        category = db.get(BookCategory, category_id)
        return _category_entry(category) if category is not None else None

    return None


__all__ = ["CapabilityCatalogEntry", "get_catalog_entry", "list_catalog"]
