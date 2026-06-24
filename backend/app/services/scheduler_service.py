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

# Per-user last-pushed digest — keyed by user.id, value is the digest string
# of the most-recently pushed NotificationCounts (or a marker that "zero push
# was correct"). In-memory: survives the process lifetime; a restart causes at
# most one extra push per user per boot (acceptable).  If durability is needed,
# persist to a notification_state table (Phase 6+).
_last_push_digest: dict[int, str] = {}

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


def _push_digest(counts: object) -> str:
    """Stable string digest from a NotificationCounts (or any dict-coercible obj).

    Only the values matter — the keys are always the same four fields.
    """
    return (
        f"approvals={getattr(counts, 'approvals', 0)}"
        f",leaves={getattr(counts, 'leaves', 0)}"
        f",scans={getattr(counts, 'scans', 0)}"
        f",emails={getattr(counts, 'emails', 0)}"
    )


def _push_grew(prev_digest: str | None, current_digest: str) -> bool:
    """Return True when at least one actionable count is higher than before.

    Closing items (count going 3→2) does NOT trigger a push — only growth.
    """
    if prev_digest is None:
        # Never pushed before: fire if any count is non-zero.
        return any(
            int(part.split("=")[1]) > 0
            for part in current_digest.split(",")
        )

    def _parse(d: str) -> dict[str, int]:
        return {k: int(v) for k, v in (p.split("=") for p in d.split(","))}

    prev = _parse(prev_digest)
    curr = _parse(current_digest)
    return any(curr.get(k, 0) > prev.get(k, 0) for k in curr)


def _run_push_notifier() -> None:
    """Check each active user's notification counts; push on actionable growth.

    Dedupe: identical digest on consecutive ticks → no push.
    Growth: any count is higher than the last-pushed digest → push once.
    Decrease: counts drop → no push.
    All-zero: never push (avoids 'you have 0 items' notifications).

    Performance: the leaves count is org-wide (identical for every user) so it
    is computed ONCE per tick and reused across users via
    ``notification_service.relevant_counts(..., precomputed_leaves=...)``.  This
    avoids re-paging up to 500 leave rows per user per minute.
    """
    with SessionLocal() as session:
        users = list(
            session.scalars(select(User).where(User.status == "active"))
        )
        # Compute the org-wide leaves count once for this tick.
        shared_leaves: int | None = None
        try:
            shared_leaves = notification_service.leaves_needing_action(session)
        except Exception:
            log.exception("scheduler: failed to compute shared leaves count")
        for user in users:
            try:
                counts = notification_service.relevant_counts(
                    session, user, precomputed_leaves=shared_leaves
                )
                digest = _push_digest(counts)
                prev = _last_push_digest.get(user.id)
                if not _push_grew(prev, digest):
                    _last_push_digest[user.id] = digest
                    continue
                # Build a human-readable summary for the notification body.
                parts: list[str] = []
                if counts.approvals > 0:
                    parts.append(
                        f"{counts.approvals} document(s) awaiting your signature"
                    )
                if counts.leaves > 0:
                    parts.append(f"{counts.leaves} leave action(s) pending")
                if counts.scans > 0:
                    parts.append(f"{counts.scans} scan(s) awaiting review")
                if counts.emails > 0:
                    parts.append(f"{counts.emails} unread email(s)")
                body = "; ".join(parts) if parts else "You have new items to action"
                push_service.send_to_user(session, user.id, "GSSG Manager", body)
                _last_push_digest[user.id] = digest
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
    "_last_push_digest",
    "_run_push_notifier",
    "reschedule_email_sync",
    "run_drain_once",
    "shutdown",
    "start",
]
