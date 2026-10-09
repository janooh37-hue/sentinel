"""Post each approved Inmate Conduct Violations record to one WhatsApp group.

The target group is a single organization-global ``AppSetting``; unset means
the feature is off. Every approval site calls :func:`queue_send` before its
own commit; the send runs only after that commit lands, on a background
thread, so a WhatsApp failure can never fail or roll back the approval.
"""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import AppSetting, AuditLog, Book, BookVersion
from app.services import notify_format as nf

log = logging.getLogger(__name__)

TEMPLATE_ID = "Inmate Conduct Violations"
SETTING_KEY = "settings.inmate_violation_whatsapp_group"
SENT_ACTION = "inmate_violation.whatsapp_sent"
_PENDING = "inmate_violation_whatsapp_pending"

# One worker serializes deliveries, so the claim-then-send dedupe below cannot race.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="icv-whatsapp")


def get_group(db: Session) -> tuple[str, str] | None:
    """The configured ``(group_id, group_name)``, or None when the feature is off."""
    row = db.get(AppSetting, SETTING_KEY)
    value = json.loads(row.value) if row is not None else None
    if not isinstance(value, dict) or not value.get("id"):
        return None
    return str(value["id"]), str(value.get("name") or value["id"])


def set_group(db: Session, group: tuple[str, str] | None, *, actor: str | None) -> None:
    """Store (or clear, with None) the target group and audit the change."""
    row = db.get(AppSetting, SETTING_KEY)
    if group is None:
        if row is not None:
            db.delete(row)
    else:
        encoded = json.dumps({"id": group[0], "name": group[1]}, ensure_ascii=False)
        if row is None:
            db.add(AppSetting(key=SETTING_KEY, value=encoded))
        else:
            row.value = encoded
    db.add(
        AuditLog(
            actor=actor,
            action="inmate_violation.whatsapp_group_set",
            entity_type="app_setting",
            entity_id=SETTING_KEY,
            payload=json.dumps({"group_id": group[0] if group else None}),
        )
    )
    db.commit()


def queue_send(db: Session, version: BookVersion) -> None:
    """Schedule the group post for *version* once the caller's commit succeeds.

    No-op unless the version is an approved Inmate Conduct Violations record,
    OpenWA is enabled, and a group is configured.
    """
    if version.template_id != TEMPLATE_ID or version.status != "approved":
        return
    if not get_settings().openwa_enabled or get_group(db) is None:
        return
    if version.id is None:
        db.flush()
    db.info.setdefault(_PENDING, set()).add(version.id)


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    for version_id in session.info.pop(_PENDING, ()):
        _executor.submit(deliver, version_id)


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop(_PENDING, None)


def deliver(version_id: int) -> None:
    """Send the version's signed PDF to the configured group, at most once."""
    from app.db import session as session_mod

    try:
        with session_mod.SessionLocal() as db:
            _deliver(db, version_id)
    except Exception:
        log.exception("inmate violation WhatsApp send failed for version %s", version_id)


def _deliver(db: Session, version_id: int) -> None:
    from app.services import announce_service

    group = get_group(db)
    version = db.get(BookVersion, version_id)
    if group is None or not get_settings().openwa_enabled or version is None:
        return
    if version.status != "approved" or version.template_id != TEMPLATE_ID:
        return
    claimed = db.scalar(
        select(AuditLog.id).where(
            AuditLog.action == SENT_ACTION,
            AuditLog.entity_type == "book_version",
            AuditLog.entity_id == str(version_id),
        )
    )
    if claimed is not None:
        return
    book = db.get(Book, version.book_id)
    assert book is not None  # FK
    filename, data = announce_service.resolve_version_pdf(db, book, version)
    # ponytail: claim before sending = at-most-once; a failed send is logged
    # (GroupAnnouncementSend row) but never retried automatically.
    db.add(
        AuditLog(
            actor=None,
            action=SENT_ACTION,
            entity_type="book_version",
            entity_id=str(version_id),
            payload=json.dumps({"book_id": book.id, "group_id": group[0]}),
        )
    )
    db.commit()
    result = announce_service.send_announcement(
        db,
        groups=[group],
        text=caption(book, version),
        attachment=announce_service.Attachment(filename=filename, data=data),
        book_id=book.id,
        sent_by=None,
    )
    if result.failed:
        log.warning(
            "inmate violation WhatsApp send to %s failed for version %s: %s",
            group[0],
            version_id,
            result.results[0].error,
        )


def _isolate(value: str) -> str:
    """Keep a Latin/mixed fragment from reordering the Arabic line around it."""
    return f"\u2068{value}\u2069"


_MAX_NAMES = 5


def caption(book: Book, version: BookVersion) -> str:
    """Short Arabic caption: reference, inmate names, report date (dd/mm/yyyy)."""
    fields = version.fields if isinstance(version.fields, dict) else {}
    inmates = fields.get("inmates")
    names = [
        str(item.get("name") or "").strip()
        for item in (inmates if isinstance(inmates, list) else [])
        if isinstance(item, dict)
    ]
    names = [name for name in names if name]
    lines = ["مخالفة مسلكية معتمدة", f"المرجع: {_isolate(book.ref_number)}"]
    if names:
        # The PDF carries the full roster; keep the caption well under WhatsApp's limit.
        listed = "، ".join(_isolate(name) for name in names[:_MAX_NAMES])
        if len(names) > _MAX_NAMES:
            listed += f" وآخرون ({_isolate(str(len(names) - _MAX_NAMES))})"
        lines.append(f"النزلاء: {listed}")
    try:
        report_date = date.fromisoformat(str(fields.get("report_date") or ""))
    except ValueError:
        report_date = None
    if report_date is not None:
        lines.append(f"التاريخ: {_isolate(nf.fmt_date(report_date))}")
    return "\n".join(lines)
