"""Per-item configuration visibility, deliberately independent of delivery."""

from __future__ import annotations

from functools import cache

NOTIFY_VIEW_PREFIX = "messages.templates.view.notify."
EMAIL_VIEW_PREFIX = "messages.templates.view.email."


def view_capability(kind: str, identifier: str) -> str:
    prefix = {
        "notification_template": NOTIFY_VIEW_PREFIX,
        "email_template": EMAIL_VIEW_PREFIX,
    }[kind]
    return prefix + identifier


@cache
def capability_ids() -> frozenset[str]:
    # Lazy imports keep the resolver independent of the delivery/template modules
    # during application initialization. The existing catalogs own item identity.
    from app.services import email_draft_template_service, sms_templates

    return frozenset(
        [view_capability("notification_template", event) for event in sms_templates.EVENTS]
        + [
            view_capability("email_template", key)
            for key in email_draft_template_service.KEY_FAMILIES
        ]
    )


def reporter_capability(capability: str) -> bool:
    from app.core.permissions import INMATE_REPORTER_CAPS

    return capability in INMATE_REPORTER_CAPS or capability in capability_ids()
