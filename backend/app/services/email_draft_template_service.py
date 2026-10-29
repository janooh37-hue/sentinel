"""Shared plain-text draft overrides, stored in one AppSetting JSON object.

Token families match the frontend letter variants. Basket tokens use the first
item's ref/date/detail/dates, all names and the item count; salary transfer adds
bank names. Absence uses register names/count/dates (including the return date).
Tables and default wording deliberately stay in the frontend.
"""

from __future__ import annotations

import json
import re
from collections.abc import Collection
from typing import cast

from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.core.classifications import CLASSIFICATIONS
from app.core.constants import TEMPLATE_FILES
from app.db.models import AuditLog
from app.schemas.email_draft_template import EmailDraftTemplateParts, EmailDraftTemplatesRead
from app.services import settings_service

SETTING_KEY = "email.draft_templates"
# First words of Leave Application Form leave_type options in templates/_fields.json,
# matching recordsBasket.ts and ApplicationPage.tsx (National Service has no form).
LEAVE_TYPES = ("Annual", "Sick", "Compassionate", "Duty", "Emergency", "Hajj", "Others")
TOKENS = {
    "form": ["ref", "date", "names", "count", "detail"],
    "classification": ["ref", "date", "names", "count", "detail"],
    "leave": ["ref", "date", "names", "count", "start_date", "end_date"],
    "salary_transfer": ["ref", "date", "names", "count", "bank"],
    "transfer": ["ref", "date", "names", "count"],
    "absence": ["names", "count", "start_date", "end_date", "return_date"],
}
KEY_FAMILIES = {
    **dict.fromkeys(TEMPLATE_FILES, "form"),
    **dict.fromkeys((f"leave:{kind}" for kind in LEAVE_TYPES), "leave"),
    **dict.fromkeys((f"classification:{c.code}" for c in CLASSIFICATIONS), "classification"),
    "Salary Transfer Request": "salary_transfer",
    "General Book:transfer": "transfer",
    "absence:absent": "absence",
    "absence:returned": "absence",
}
_TOKEN = re.compile(r"\{(\w+)\}")
_BRACE_EXPRESSION = re.compile(r"\{([^{}]*)\}")
_HTML = re.compile(r"<(?:[^\W\d_]|[/!])|&(?:\w+;|#)")


def visible_templates(
    templates: EmailDraftTemplatesRead, caps: Collection[str]
) -> EmailDraftTemplatesRead:
    from app.services.template_capability_service import view_capability

    return templates.model_copy(
        update={
            "overrides": {
                key: value
                for key, value in templates.overrides.items()
                if key in KEY_FAMILIES and view_capability("email_template", key) in caps
            }
        }
    )


def get_templates(db: Session) -> EmailDraftTemplatesRead:
    return EmailDraftTemplatesRead(
        overrides=settings_service._get(db, SETTING_KEY, {}), tokens=TOKENS
    )


def set_template(
    db: Session,
    key: str,
    parts: EmailDraftTemplateParts | None,
    *,
    actor: str,
) -> EmailDraftTemplatesRead:
    if key not in KEY_FAMILIES:
        raise ValidationFailedError("UNKNOWN_KEY", "Unknown email draft template key", key=key)
    after = (
        {part: text for part, text in parts.model_dump(exclude_none=True).items() if text.strip()}
        if parts is not None
        else {}
    )
    unknown: set[str] = set()
    for text in after.values():
        if _HTML.search(text):
            raise ValidationFailedError(
                "HTML_NOT_ALLOWED", "Email draft templates must be plain text"
            )
        unknown.update(set(_TOKEN.findall(text)) - set(TOKENS[KEY_FAMILIES[key]]))
        unknown.update(
            expression
            for expression in _BRACE_EXPRESSION.findall(text)
            if not _TOKEN.fullmatch("{" + expression + "}")
        )
        # Preserve nested-token rejection without backtracking across opening braces.
        for prefix in text.split("}")[:-1]:
            expression = prefix.partition("{")[2]
            if "{" in expression:
                unknown.add(expression)
    if unknown:
        raise ValidationFailedError(
            "UNKNOWN_TOKEN", "Unknown email draft template tokens", tokens=sorted(unknown)
        )

    overrides = cast(dict[str, dict[str, str]], settings_service._get(db, SETTING_KEY, {}))
    before = overrides.get(key)
    if before != (after or None):
        if after:
            overrides[key] = after
        else:
            overrides.pop(key, None)
        settings_service._upsert_setting(db, SETTING_KEY, overrides)
        # Audit the edited variant, not the whole shared setting, in the same transaction.
        db.add(
            AuditLog(
                actor=actor,
                action="email_draft_template.updated"
                if parts is not None
                else "email_draft_template.reset",
                entity_type="email_draft_template",
                entity_id=key,
                payload=json.dumps({"before": before, "after": after or None}, ensure_ascii=False),
            )
        )
        db.commit()
    return EmailDraftTemplatesRead(overrides=overrides, tokens=TOKENS)
