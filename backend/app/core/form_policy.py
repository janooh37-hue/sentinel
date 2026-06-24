"""Per-form signing-path + attachment-slot policy (spec 2026-06-11 §3).

Code, not _fields.json: the JSON is regenerable and carries no metadata channel.
Keys are template_ids from core.constants.TEMPLATE_FILES.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

SigningPath = Literal["auto", "in_app", "scan", "chain"]

SIGNING_PATHS: dict[str, SigningPath] = {
    "Material Request Form": "in_app",
    "General Book": "chain",
    "Violation Form": "scan",
    "Acknowledgment Form": "scan",
    "Warning Form": "scan",
    "Passport Release List": "scan",
}

_DEFAULT_PATH: SigningPath = "auto"


def signing_path_of(template_id: str | None) -> SigningPath | None:
    """Path for a registered template; None for unknown/legacy (no policy applies)."""
    if not template_id:
        return None
    from app.core.constants import TEMPLATE_FILES  # local import: avoid cycles

    if template_id not in TEMPLATE_FILES:
        return None
    return SIGNING_PATHS.get(template_id, _DEFAULT_PATH)


@dataclass(frozen=True)
class AttachmentSlot:
    key: str
    label_en: str
    label_ar: str
    required: bool
    hint_en: str = ""
    hint_ar: str = ""


ATTACHMENT_SLOTS: dict[str, list[AttachmentSlot]] = {
    "Salary Transfer Request": [
        AttachmentSlot(
            key="iban_letter",
            label_en="IBAN letter (new bank)",
            label_ar="رسالة الآيبان (البنك الجديد)",
            required=True,
        ),
        AttachmentSlot(
            key="old_bank_clearance",
            label_en="Clearance letter (old bank)",
            label_ar="رسالة مخالصة (البنك السابق)",
            required=False,
            hint_en="Some banks don't issue a clearance — attach it only when the old bank provides one.",
            hint_ar="بعض البنوك لا تصدر مخالصة — أرفقها فقط عند توفرها.",
        ),
    ],
}


def attachment_slots_of(template_id: str | None) -> list[AttachmentSlot]:
    if not template_id:
        return []
    return list(ATTACHMENT_SLOTS.get(template_id, []))
