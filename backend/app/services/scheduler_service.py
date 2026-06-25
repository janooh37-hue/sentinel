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
from app.services import email_service, notification_service, push_service, scan_inbox_service

log = logging.getLogger(__name__)

_EMAIL_SYNC_JOB_ID = "email-sync"
_SCAN_DRAIN_JOB_ID = "scan-inbox-drain"
_SCAN_DRAIN_INTERVAL_MINUTES = 1
_PUSH_NOTIFIER_JOB_ID = "push-notifier"
_PUSH_NOTIFIER_INTERVAL_MINUTES = 1

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


# Localized notification copy per kind.
#   section_url            — deep link when several new items of this kind
#   (en_sing, en_plur)     — English noun, singular / plural
#   (ar_sing, ar_plur)     — Arabic noun, singular / plural
_KIND_META: dict[str, tuple[str, str, str, str, str]] = {
    "approval": (
        "/books?status=pending",
        "document awaiting your signature",
        "documents awaiting your signature",
        "مستند بانتظار توقيعك",
        "مستندات بانتظار توقيعك",
    ),
    "scan": (
        "/scan-inbox",
        "scan awaiting review",
        "scans awaiting review",
        "ملف ممسوح بانتظار المراجعة",
        "ملفات ممسوحة بانتظار المراجعة",
    ),
    "email": (
        "/ledger",
        "unread email",
        "unread emails",
        "رسالة بريد غير مقروءة",
        "رسائل بريد غير مقروءة",
    ),
}
_TITLE = {"en": "GSSG Manager", "ar": "مدير GSSG"}


def _build_push(
    kind: str, new_items: list, meta: tuple[str, str, str, str, str]
) -> tuple[dict[str, tuple[str, str]], str]:
    """Localized (en/ar) (title, body) pairs + the click deep-link URL."""
    section_url, en_sing, en_plur, ar_sing, ar_plur = meta
    n = len(new_items)
    if kind == "approval" and n == 1:
        # Single new approval → name it and deep-link straight to the record.
        item = new_items[0]
        return (
            {
                "en": (_TITLE["en"], f"Document {item.label} awaiting your signature"),
                "ar": (_TITLE["ar"], f"المستند {item.label} بانتظار توقيعك"),
            },
            item.url,
        )
    body_en = f"{n} {en_sing if n == 1 else en_plur}"
    body_ar = f"{n} {ar_sing if n == 1 else ar_plur}"
    return (
        {"en": (_TITLE["en"], body_en), "ar": (_TITLE["ar"], body_ar)},
        section_url,
    )


def _notify_user(session, user: User) -> None:
    """Push each NEW owned actionable item once, deep-linked, in the device's
    language. State lives in the durable ``push_sent`` ledger, so restarts no
    longer replay still-open items."""
    items = notification_service.actionable_items(session, user)
    by_kind: dict[str, list] = {}
    for it in items:
        by_kind.setdefault(it.kind, []).append(it)
    for kind, meta in _KIND_META.items():
        current = by_kind.get(kind, [])
        current_refs = {it.ref for it in current}
        already = push_service.sent_refs(session, user.id, kind)
        new_items = [it for it in current if it.ref not in already]
        # Forget items that are no longer actionable (lets a recurring one re-fire).
        push_service.prune_sent(session, user.id, kind, current_refs)
        if not new_items:
            continue
        messages, url = _build_push(kind, new_items, meta)
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
        users = list(
            session.scalars(select(User).where(User.status == "active"))
        )
        for user in users:
            try:
                _notify_user(session, user)
            except Exception:
                log.exception(
                    "scheduler: push notifier failed for user %s", user.id
                )


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
            log.info(
                "scheduler: push notifier every %d min", _PUSH_NOTIFIER_INTERVAL_MINUTES
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
    "reschedule_email_sync",
    "run_drain_once",
    "shutdown",
    "start",
]
