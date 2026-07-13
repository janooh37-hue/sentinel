"""Build + render the annual-leave digest for duty-unit supervisors.

A small, extensible bilingual list layer: future digests (returning-to-duty,
pending-approvals) reuse render helpers + the supervisor router without
touching resolution.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import DutySupervisor, Employee, Leave
from app.services import duty_supervisor_service, leave_service, notify_dispatch
from app.services import notify_format as nf


def month_bounds(d: date) -> tuple[date, date]:
    last = calendar.monthrange(d.year, d.month)[1]
    return date(d.year, d.month, 1), date(d.year, d.month, last)


def _month_name(d: date, lang: str) -> str:
    table = nf.AR_MONTHS if lang == "ar" else nf.EN_MONTHS
    return f"{table[d.month - 1]} {d.year}"


def render_leave_digest(
    unit: str,
    month: date,
    employees_leaves: list[tuple[Employee, Leave]],
    lang: str,
) -> str:
    """One bilingual message: heading (unit + month) then a line per person."""
    if lang == "ar":
        # "الإجازات السنوية" (plural) is intentional — it introduces a collective list,
        # matching the digest UI panel title "ملخص الإجازات السنوية".
        heading = f"الإجازات السنوية لوحدة «{unit}» لشهر {_month_name(month, 'ar')}:"
    else:
        heading = f'Annual leave for unit "{unit}" — {_month_name(month, "en")}:'
    lines = [heading]
    for emp, lv in employees_leaves:
        name = nf.employee_name(emp, lang)
        if lang == "ar":
            span = f"من {nf.fmt_date(lv.start_date)} إلى {nf.fmt_date(lv.end_date)}"
        else:
            span = f"{nf.fmt_date(lv.start_date)} → {nf.fmt_date(lv.end_date)}"
        lines.append(f"• {name} — {span}")
    return "\n".join(lines)


def build_unit_digest(db: Session, duty_unit: str, month: date) -> list[tuple[Employee, Leave]]:
    ms, me = month_bounds(month)
    leaves = leave_service.list_annual_overlapping(
        db, month_start=ms, month_end=me, duty_unit=duty_unit
    )
    pairs: list[tuple[Employee, Leave]] = []
    for lv in leaves:
        emp = db.get(Employee, lv.employee_id)
        if emp is not None:
            pairs.append((emp, lv))
    return pairs


@dataclass
class DigestSkip:
    duty_unit: str
    reason: str  # "no_supervisor" | "no_leaves"


@dataclass
class DigestRunResult:
    sent: int = 0
    messages: list[int] = field(default_factory=list)
    skips: list[DigestSkip] = field(default_factory=list)


def send_unit_digest(
    db: Session, duty_unit: str, *, month: date, sent_by: int | None
) -> DigestRunResult:
    """Resolve supervisors for *duty_unit*, build the digest, and send to each.

    Skips (with a logged reason) when there are no configured supervisors or
    when no annual-leave rows overlap the given *month*.
    """
    res = DigestRunResult()
    supervisors = duty_supervisor_service.resolve_supervisors(db, duty_unit)
    if not supervisors:
        res.skips.append(DigestSkip(duty_unit, "no_supervisor"))
        return res
    pairs = build_unit_digest(db, duty_unit, month)
    if not pairs:
        res.skips.append(DigestSkip(duty_unit, "no_leaves"))
        return res
    ref = f"leave_digest:{month:%Y-%m}:{duty_unit}"[:64]
    for sup in supervisors:
        lang = "ar" if (sup.msg_language or "ar") == "ar" else "en"
        body = render_leave_digest(duty_unit, month, pairs, lang)
        msg = notify_dispatch.send_direct(
            db,
            employee=sup,
            body=body,
            language=lang,
            event_type="leave_digest",
            event_ref=ref,
            sent_by=sent_by,
        )
        res.sent += 1
        res.messages.append(msg.id)
    return res


def send_all_digests(db: Session, *, month: date, sent_by: int | None) -> DigestRunResult:
    """Send the monthly digest to every mapped duty unit and aggregate results."""
    units = list(db.scalars(select(DutySupervisor.duty_unit).distinct()))
    agg = DigestRunResult()
    for unit in units:
        r = send_unit_digest(db, unit, month=month, sent_by=sent_by)
        agg.sent += r.sent
        agg.messages.extend(r.messages)
        agg.skips.extend(r.skips)
    return agg
