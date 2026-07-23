"""Template metadata service — thin wrapper around _fields.json.

Exports `list_templates()` and `get_template_fields()`.
The JSON is loaded once and cached via `load_fields_meta` which is re-exported
from `document_service` (single point of truth, no duplication).
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Literal

from pydantic import BaseModel

from app.api.errors import NotFoundError
from app.core import form_policy
from app.core.constants import COMPANION_TEMPLATE_IDS, TEMPLATE_FILES
from app.core.docx_engine import template_has_code
from app.core.form_policy import SigningPath
from app.services.document_service import load_fields_meta

# ---------------------------------------------------------------------------
# Response schemas (used by both service and router)
# ---------------------------------------------------------------------------


class TemplateMeta(BaseModel):
    id: str
    name_en: str
    name_ar: str
    form_number: str
    category: Literal["personnel", "admin"]
    signing_path: SigningPath
    # Whether a committed document of this template carries a scannable page-1
    # ref code. True for every form today; False only for future forms with no
    # clear corner (see _NO_CODE_FORMS) — drives the Services-tile indicator.
    has_code: bool


class AttachmentSlotRead(BaseModel):
    key: str
    label_en: str
    label_ar: str
    required: bool
    hint_en: str = ""
    hint_ar: str = ""


class TemplateField(BaseModel):
    key: str
    type: Literal[
        "text",
        "textarea",
        "date",
        "select",
        "manager_picker",
        "submitter_picker",
        "employee_picker",
        "arabic_rich",
        "arabic_rich_full",
        "signature",
        "checkbox",
        "hand_sign_checkbox",
        "clearance_table",
        "items_table",
        "employees_table",
        "violation_checkboxes",
        "violation_combo",
        "recipient_picker",
        "recipient_multi_picker",
    ]
    label_en: str
    label_ar: str
    required: bool
    options: list[str] | None = None
    default: str | None = None
    group: str | None = None


class TemplateDetailResponse(BaseModel):
    meta: TemplateMeta
    fields: list[TemplateField]
    signing_path: SigningPath
    attachment_slots: list[AttachmentSlotRead]


class TemplateListResponse(BaseModel):
    items: list[TemplateMeta]


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------


def _build_meta(template_id: str, entry: dict[str, Any]) -> TemplateMeta:
    signing_path = form_policy.signing_path_of(template_id)
    assert signing_path is not None  # registered templates always resolve
    return TemplateMeta(
        id=template_id,
        name_en=entry.get("name_en", template_id),
        name_ar=entry.get("name_ar", ""),
        form_number=entry.get("form_number", ""),
        category=entry.get("category", "personnel"),
        signing_path=signing_path,
        has_code=template_has_code(template_id),
    )


def list_templates() -> TemplateListResponse:
    """Return metadata for every non-companion registered template.

    Companion forms (COMPANION_TEMPLATE_IDS) are excluded — they only exist as
    a companion of their primary, never as a standalone service.
    """
    meta_map = load_fields_meta()
    items: list[TemplateMeta] = []
    for template_id in TEMPLATE_FILES:
        if template_id in COMPANION_TEMPLATE_IDS:
            continue
        entry = meta_map.get(template_id, {})
        items.append(_build_meta(template_id, entry))
    return TemplateListResponse(items=items)


def get_template_fields(template_id: str) -> TemplateDetailResponse:
    """Return meta + fields for one template, or raise 404."""
    if template_id not in TEMPLATE_FILES:
        raise NotFoundError(
            "TEMPLATE_NOT_FOUND",
            f"Template {template_id!r} not found",
            template_id=template_id,
        )
    meta_map = load_fields_meta()
    entry = meta_map.get(template_id, {})
    meta = _build_meta(template_id, entry)
    raw_fields: list[dict[str, Any]] = entry.get("fields", [])
    fields = [TemplateField(**f) for f in raw_fields]
    attachment_slots = [
        AttachmentSlotRead(**asdict(slot)) for slot in form_policy.attachment_slots_of(template_id)
    ]
    return TemplateDetailResponse(
        meta=meta,
        fields=fields,
        signing_path=meta.signing_path,
        attachment_slots=attachment_slots,
    )


__all__ = [
    "AttachmentSlotRead",
    "TemplateDetailResponse",
    "TemplateField",
    "TemplateListResponse",
    "TemplateMeta",
    "get_template_fields",
    "list_templates",
]
