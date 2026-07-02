"""Per-kind leave lifecycle rules — the single backend source of truth.

The Leaves spec (docs/superpowers/specs/2026-06-11-leave-kind-lifecycles-design.md)
gives each kind its own lifecycle:

- sick:             a recorded fact (certificate captured at creation via OCR;
                    no post-creation upload endpoint — accepts_certificate is
                    False). Born Approved, no actions.
- request:          Annual & the rare kinds. Born Pending; Pending → Approved/
                    Rejected/Cancelled; Approved → Cancelled. Rejected/Cancelled terminal.
- record:           Administrative Leave, Leave Permit, Passport Release, Duty
                    Resumption. Born Approved, no actions — register entries only.
- national_service: Born Pending ("Scheduled"); dates editable while Pending
                    (delay/extend); PATCH may only Cancel; Completed is set
                    exclusively by the certificate upload endpoint.

Stored vocabulary: Pending, Approved, Rejected, Cancelled, Completed.
"Generated" no longer exists post-migration-0034 but is defensively aliased to
Approved (old facts) so an unmigrated DB can't 500.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Literal

LifecycleGroup = Literal["sick", "request", "record", "national_service"]

_SICK = "sick leave"
_NS = "national service"
# The only request-group kind that closes out with a Duty Resumption. v3 rows
# sometimes stored the bare word "annual".
_ANNUAL = frozenset({"annual leave", "annual"})
_RECORD_TYPES = frozenset(
    {"administrative leave", "leave permit", "passport release", "duty resumption"}
)

ENDING_SOON_DAYS = 3  # heads-up window before a returnable leave's end date


_ARABIC = re.compile(r"[؀-ۿ]")


def _english_part(value: str) -> str:
    """Collapse bilingual labels to the English half.

    Handles both the ``' - '`` delimiter form (``'Pending - انتظار'``) and the
    dash-less form where an Arabic run simply follows the English half
    (``'Duty Resumption مباشرة عمل'``) — the latter otherwise leaks the Arabic
    into ``classify_group`` and misclassifies e.g. a Duty Resumption as a request.
    """
    head = value.partition(" - ")[0]
    match = _ARABIC.search(head)
    if match:
        head = head[: match.start()]
    return head.strip()


def classify_group(leave_type: str) -> LifecycleGroup:
    v = _english_part(leave_type).lower()
    if v == _SICK or v == "sick":  # v3 rows sometimes stored the bare word
        return "sick"
    if v == _NS:
        return "national_service"
    if v in _RECORD_TYPES:
        return "record"
    return "request"


def canonical_status(status: str) -> str:
    """English half of a stored status, with the legacy 'Generated' → 'Approved'."""
    s = _english_part(status)
    return "Approved" if s == "Generated" else s


_TRANSITIONS: dict[LifecycleGroup, dict[str, frozenset[str]]] = {
    "request": {
        "Pending": frozenset({"Approved", "Rejected", "Cancelled"}),
        "Approved": frozenset({"Cancelled"}),
    },
    "sick": {},
    "record": {},
    "national_service": {
        # Completed is reached only via the certificate endpoint, never PATCH.
        # A legacy 'Generated' NS row aliases to 'Approved' → terminal (no entry).
        "Pending": frozenset({"Cancelled"}),
    },
}


def birth_status(leave_type: str) -> str:
    group = classify_group(leave_type)
    return "Pending" if group in ("request", "national_service") else "Approved"


def allowed_transitions(leave_type: str, current_status: str) -> frozenset[str]:
    group = classify_group(leave_type)
    return _TRANSITIONS[group].get(canonical_status(current_status), frozenset())


def can_edit_dates(leave_type: str, current_status: str) -> bool:
    return (
        classify_group(leave_type) == "national_service"
        and canonical_status(current_status) == "Pending"
    )


def accepts_certificate(leave_type: str) -> bool:
    return classify_group(leave_type) == "national_service"


def is_returnable(leave_type: str) -> bool:
    """Kinds that require a Duty Resumption (return) form to close out.

    Only Annual Leave and National Service. Every other request-group kind
    (Compassionate, Duty, Emergency, Hajj, legacy 'Others') is terminal once
    Approved — no return form, no resumption document.
    """
    if _english_part(leave_type).lower() in _ANNUAL:
        return True
    return classify_group(leave_type) == "national_service"


def can_file_return(leave_type: str, status: str, *, has_certificate: bool) -> bool:
    """Whether a return form may be filed now.

    Annual Leave: only from Approved (Generated aliases to Approved).
    national_service: only from Pending AND with a certificate already on file.
    Non-returnable kinds, and Completed / Rejected / Cancelled, are never fileable.
    """
    if not is_returnable(leave_type):
        return False
    s = canonical_status(status)
    if classify_group(leave_type) == "national_service":
        return s == "Pending" and has_certificate
    return s == "Approved"


def _is_overdue(end_date: str, today_iso: str) -> bool:
    return end_date[:10] < today_iso


def needs_action(leave_type: str, status: str, end_date: str, today_iso: str) -> bool:
    """Does this leave row need a user's action now? Mirrors lifecycle.ts:needsAction.

    - request group: Pending → True; Approved → True iff overdue (awaiting return);
      else False.
    - national_service: True iff Pending AND overdue.
    - sick / record: always False.
    """
    group = classify_group(leave_type)
    s = canonical_status(status)
    if group == "request":
        if s == "Pending":
            return True
        if s == "Approved":
            # Only returnable kinds (Annual) await a return; others are terminal.
            return is_returnable(leave_type) and _is_overdue(end_date, today_iso)
        return False
    if group == "national_service":
        return s == "Pending" and _is_overdue(end_date, today_iso)
    return False


def ending_soon(leave_type: str, status: str, end_date: str, today_iso: str) -> bool:
    """Heads-up: a returnable leave in its active phase whose end is within
    ENDING_SOON_DAYS (and not already past)."""
    if not is_returnable(leave_type):
        return False
    s = canonical_status(status)
    group = classify_group(leave_type)
    active = (group == "request" and s == "Approved") or (
        group == "national_service" and s == "Pending"
    )
    if not active:
        return False
    end = end_date[:10]
    if end < today_iso:  # already ended -> that's "awaiting return", not "soon"
        return False
    ey, em, ed = (int(p) for p in end.split("-"))
    ty, tm, td = (int(p) for p in today_iso.split("-"))
    delta = (date(ey, em, ed) - date(ty, tm, td)).days
    return 0 <= delta <= ENDING_SOON_DAYS


__all__ = [
    "ENDING_SOON_DAYS",
    "LifecycleGroup",
    "accepts_certificate",
    "allowed_transitions",
    "birth_status",
    "can_edit_dates",
    "can_file_return",
    "canonical_status",
    "classify_group",
    "ending_soon",
    "is_returnable",
    "needs_action",
]
