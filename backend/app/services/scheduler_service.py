"""Background scheduler — runs periodic email sync without blocking requests.

Uses APScheduler's ``BackgroundScheduler`` so the job lives on its own thread
inside the uvicorn process. One global scheduler instance is created in the
FastAPI lifespan and torn down on shutdown.

The interval is read from ``EmailAccount.sync_interval_minutes``:
  - 0      → scheduler disabled (job removed if present)
  - n > 0  → run every n minutes

The scheduler is rescheduled whenever the account is upserted via
``reschedule_email_sync()`` so an operator changing the interval from
Settings takes effect on the next tick without a process restart.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import UTC, datetime
from threading import Lock

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select

from app.db.models import User
from app.db.session import SessionLocal
from app.services import (
    email_service,
    notification_service,
    perm_service,
    push_service,
    scan_inbox_service,
    sms_service,
)

log = logging.getLogger(__name__)

_EMAIL_SYNC_JOB_ID = "email-sync"
_SCAN_DRAIN_JOB_ID = "scan-inbox-drain"
_SCAN_DRAIN_INTERVAL_MINUTES = 1
_PUSH_NOTIFIER_JOB_ID = "push-notifier"
_PUSH_NOTIFIER_INTERVAL_MINUTES = 1
_GRANT_SWEEP_JOB_ID = "grant-sweep"
_GRANT_SWEEP_INTERVAL_MINUTES = 1
_SMS_DELIVERY_POLL_JOB_ID = "sms-delivery-poll"
_SMS_DELIVERY_POLL_INTERVAL_MINUTES = 5

_scheduler: BackgroundScheduler | None = None
_lock = Lock()


def _run_email_sync() -> None:
    """Job body — open a short-lived session, invoke sync_now."""
    started = datetime.now(UTC).replace(tzinfo=None)
    session = SessionLocal()
    try:
        accounts = email_service.list_enabled_accounts(session)
        if not accounts:
            log.debug("scheduler: email sync skipped (no enabled accounts)")
            return
        results = email_service.sync_all_accounts(session)
        log.info(
            "scheduler: synced %d account(s) in %ss — imported=%d",
            len(results),
            (datetime.now(UTC).replace(tzinfo=None) - started).total_seconds(),
            sum(r.imported for r in results),
        )
    except email_service.SyncInProgressError:
        # A manual sync holds the lock — skip this tick rather than queue.
        log.info("scheduler: email sync skipped (a sync is already running)")
    except Exception:
        # Scheduler swallows job exceptions by default; we log them explicitly
        # so they surface in dev.ps1 output without crashing the process.
        log.exception("scheduler: email sync failed")
    finally:
        session.close()


def run_drain_once() -> int:
    """Drain one batch of pending scan-inbox rows. Callable from the scheduler
    job and from tests. Opens a short-lived session like _run_email_sync."""
    session = SessionLocal()
    try:
        return scan_inbox_service.drain_pending(session)
    except Exception:
        log.exception("scheduler: scan-inbox drain failed")
        return 0
    finally:
        session.close()


def _run_scan_drain() -> None:
    n = run_drain_once()
    if n:
        log.info("scheduler: scan-inbox drained %d item(s)", n)


def _run_grant_sweep() -> None:
    with SessionLocal() as session:
        try:
            n = perm_service.sweep_expired_grants(session)
            if n:
                log.info("scheduler: revoked %d expired permission grant(s)", n)
        except Exception:
            log.exception("scheduler: grant sweep failed")


def _run_sms_delivery_poll() -> None:
    with SessionLocal() as session:
        try:
            n = sms_service.poll_pending_deliveries(session)
            if n:
                log.info("scheduler: %d SMS reached a terminal delivery state", n)
        except Exception:
            log.exception("scheduler: SMS delivery poll failed")


# The notification title is always the app name, in both languages, because the
# installed PWA already shows it as the grey header — keeping it as the bold line
# is what the operator asked for. All the useful, specific detail lives in the
# body. ``_KIND_META`` only holds each kind's section deep-link now.
_APP_NAME = "GSSG Manager"
_KIND_META: dict[str, str] = {
    "approval": "/books?status=pending",
    "review": "/books?status=pending",
    "scan": "/scan-inbox",
    "email": "/ledger",
}


def _localized(en: str, ar: str) -> dict[str, tuple[str, str]]:
    """Title is the app name in both languages; body is the localized copy."""
    return {"en": (_APP_NAME, en), "ar": (_APP_NAME, ar)}


def _attachments_line(n: int) -> tuple[str, str]:
    """The email body's attachment ("size") line, EN/AR. Empty when none."""
    if not n:
        return "", ""
    en = "1 attachment" if n == 1 else f"{n} attachments"
    ar = "مرفق واحد" if n == 1 else f"{n} مرفقات"
    return en, ar


def _email_push(new_items: list, section_url: str) -> tuple[dict, str]:
    """Email push — name the sender, subject, a content preview and attachment
    count (single), or summarize the burst and name the latest (several)."""
    n = len(new_items)
    if n == 1:
        it = new_items[0]
        sender = it.requester or "Unknown sender"
        subject = it.subject or "(no subject)"
        att_en, att_ar = _attachments_line(it.attachments)
        en_lines = [f"New email · {sender}", subject]
        ar_lines = [f"بريد جديد · {sender}", subject]
        if it.preview:
            en_lines.append(it.preview)
            ar_lines.append(it.preview)
        if att_en:
            en_lines.append(att_en)
            ar_lines.append(att_ar)
        return _localized("\n".join(en_lines), "\n".join(ar_lines)), it.url
    latest = new_items[0]
    who = latest.requester or "Unknown sender"
    subj = latest.subject or "(no subject)"
    return (
        _localized(
            f"{n} new emails\nLatest · {who} — {subj}",
            f"{n} رسائل بريد جديدة\nالأحدث · {who} — {subj}",
        ),
        section_url,
    )


def _doc_push(kind: str, new_items: list, section_url: str) -> tuple[dict, str]:
    """Approval / review push — name the record, who it's from, deep-link to it
    (single); count the queue (several)."""
    n = len(new_items)
    is_sign = kind == "approval"
    if n == 1:
        it = new_items[0]
        subj = f" — {it.subject}" if it.subject else ""
        from_en = f"\nFrom {it.requester}" if it.requester else ""
        from_ar = f"\nمن {it.requester}" if it.requester else ""
        head_en = "Signature needed" if is_sign else "Review needed"
        head_ar = "بانتظار توقيعك" if is_sign else "بانتظار مراجعتك"
        return (
            _localized(
                f"{head_en} · {it.label}{subj}{from_en}",
                f"{head_ar} · {it.label}{subj}{from_ar}",
            ),
            it.url,
        )
    noun_en = "documents awaiting your signature" if is_sign else "documents awaiting your review"
    noun_ar = "مستندات بانتظار توقيعك" if is_sign else "مستندات بانتظار مراجعتك"
    return _localized(f"{n} {noun_en}", f"{n} {noun_ar}"), section_url


def _scan_push(new_items: list, section_url: str) -> tuple[dict, str]:
    """Scan-inbox push — a scanned document is waiting to be reviewed/routed."""
    n = len(new_items)
    if n == 1:
        label = new_items[0].label
        return (
            _localized(
                f"New scan to review · {label}\nWaiting in your scan inbox",
                f"ملف ممسوح جديد للمراجعة · {label}\nبانتظار المراجعة في صندوق الوارد",
            ),
            new_items[0].url,
        )
    return (
        _localized(
            f"{n} scanned documents awaiting your review",
            f"{n} مستندات ممسوحة بانتظار مراجعتك",
        ),
        section_url,
    )


def _build_push(
    kind: str, new_items: list, section_url: str
) -> tuple[dict[str, tuple[str, str]], str]:
    """Localized {lang: (title, body)} pairs + the click deep-link URL.

    Title is always the app name; the body is specific, professional copy that
    says exactly what arrived. Dispatches per kind.
    """
    if kind == "email":
        return _email_push(new_items, section_url)
    if kind == "scan":
        return _scan_push(new_items, section_url)
    return _doc_push(kind, new_items, section_url)


def _notify_user(session, user: User) -> None:
    """Push each NEW owned actionable item once, deep-linked, in the device's
    language. State lives in the durable ``push_sent`` ledger, so restarts no
    longer replay still-open items."""
    items = notification_service.actionable_items(session, user)
    by_kind: dict[str, list] = {}
    for it in items:
        by_kind.setdefault(it.kind, []).append(it)
    for kind, section_url in _KIND_META.items():
        current = by_kind.get(kind, [])
        current_refs = {it.ref for it in current}
        already = push_service.sent_refs(session, user.id, kind)
        new_items = [it for it in current if it.ref not in already]
        # Forget items that are no longer actionable (lets a recurring one re-fire).
        push_service.prune_sent(session, user.id, kind, current_refs)
        if not new_items:
            continue
        messages, url = _build_push(kind, new_items, section_url)
        push_service.send_to_user(session, user.id, messages, url)
        push_service.mark_sent(session, user.id, kind, [it.ref for it in new_items])


def _run_push_notifier() -> None:
    """Notify each active user about genuinely-new actionable items only.

    Per-item, durable dedup (``push_sent``): a still-open item is pushed once,
    never re-sent on the next tick or after a restart. Each push carries a
    deep-link URL so the click opens the exact item, and is localized to the
    subscribing device's language (Arabic on Arabic phones).
    """
    with SessionLocal() as session:
        users = list(session.scalars(select(User).where(User.status == "active")))
        for user in users:
            try:
                _notify_user(session, user)
            except Exception:
                log.exception("scheduler: push notifier failed for user %s", user.id)


def _disabled_in_environment() -> bool:
    """Skip startup under pytest or when explicitly disabled via env var.

    Tests reuse ``create_app()`` via ``TestClient(app)``, which triggers the
    FastAPI lifespan. Without this guard each test run would spin up a real
    scheduler thread that hammers IMAP and pollutes test logs.
    """
    if "pytest" in sys.modules:
        return True
    if os.environ.get("GSSG_DISABLE_SCHEDULER") == "1":
        return True
    return False


def start() -> None:
    """Boot the scheduler. Idempotent — calling twice is a no-op."""
    global _scheduler
    if _disabled_in_environment():
        log.info("scheduler: disabled (pytest or GSSG_DISABLE_SCHEDULER)")
        return
    with _lock:
        if _scheduler is not None and _scheduler.running:
            return
        _scheduler = BackgroundScheduler(
            daemon=True,
            timezone="UTC",
            job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 60},
        )
        _scheduler.start()
        log.info("scheduler started")
    reschedule_email_sync()
    with _lock:
        if _scheduler is not None and _scheduler.running:
            _scheduler.add_job(
                _run_scan_drain,
                trigger=IntervalTrigger(minutes=_SCAN_DRAIN_INTERVAL_MINUTES),
                id=_SCAN_DRAIN_JOB_ID,
                replace_existing=True,
            )
            log.info("scheduler: scan-inbox drain every %d min", _SCAN_DRAIN_INTERVAL_MINUTES)
            _scheduler.add_job(
                _run_push_notifier,
                trigger=IntervalTrigger(minutes=_PUSH_NOTIFIER_INTERVAL_MINUTES),
                id=_PUSH_NOTIFIER_JOB_ID,
                replace_existing=True,
            )
            log.info("scheduler: push notifier every %d min", _PUSH_NOTIFIER_INTERVAL_MINUTES)
            _scheduler.add_job(
                _run_grant_sweep,
                trigger=IntervalTrigger(minutes=_GRANT_SWEEP_INTERVAL_MINUTES),
                id=_GRANT_SWEEP_JOB_ID,
                replace_existing=True,
            )
            log.info("scheduler: grant sweep every %d min", _GRANT_SWEEP_INTERVAL_MINUTES)
            _scheduler.add_job(
                _run_sms_delivery_poll,
                trigger=IntervalTrigger(minutes=_SMS_DELIVERY_POLL_INTERVAL_MINUTES),
                id=_SMS_DELIVERY_POLL_JOB_ID,
                replace_existing=True,
            )
            log.info(
                "scheduler: SMS delivery poll every %d min",
                _SMS_DELIVERY_POLL_INTERVAL_MINUTES,
            )


def shutdown() -> None:
    """Tear down — called from the FastAPI lifespan."""
    global _scheduler
    with _lock:
        if _scheduler is None:
            return
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            log.exception("scheduler shutdown failed")
        _scheduler = None
        log.info("scheduler stopped")


def reschedule_email_sync() -> None:
    """Re-read the configured interval and add/replace/remove the job.

    Safe to call from any thread (e.g. from the upsert_account route).
    """
    with _lock:
        if _scheduler is None or not _scheduler.running:
            return

        interval_minutes = 0
        session = SessionLocal()
        try:
            intervals = [
                int(a.sync_interval_minutes)
                for a in email_service.list_enabled_accounts(session)
                if a.sync_interval_minutes and a.sync_interval_minutes > 0
            ]
            interval_minutes = min(intervals) if intervals else 0
        finally:
            session.close()

        # Existing job — remove first so we can re-add with the new interval.
        existing = _scheduler.get_job(_EMAIL_SYNC_JOB_ID)
        if existing is not None:
            _scheduler.remove_job(_EMAIL_SYNC_JOB_ID)

        if interval_minutes <= 0:
            log.info("scheduler: email sync disabled")
            return

        _scheduler.add_job(
            _run_email_sync,
            trigger=IntervalTrigger(minutes=interval_minutes),
            id=_EMAIL_SYNC_JOB_ID,
            replace_existing=True,
            next_run_time=datetime.now(UTC),  # fire once on (re)schedule
        )
        log.info("scheduler: email sync every %d min", interval_minutes)


__all__ = [
    "_run_push_notifier",
    "_run_sms_delivery_poll",
    "reschedule_email_sync",
    "run_drain_once",
    "shutdown",
    "start",
]
