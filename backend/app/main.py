"""FastAPI application factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import dav
from app.api.deps import get_current_user
from app.api.errors import install_handlers
from app.api.v1 import announcements as announcements_v1
from app.api.v1 import auth as auth_v1
from app.api.v1 import books as books_v1
from app.api.v1 import correspondence as correspondence_v1
from app.api.v1 import dashboard as dashboard_v1
from app.api.v1 import digests as digests_v1
from app.api.v1 import documents as documents_v1
from app.api.v1 import duty as duty_v1
from app.api.v1 import duty_supervisors as duty_supervisors_v1
from app.api.v1 import editor_templates as editor_templates_v1
from app.api.v1 import email as email_v1
from app.api.v1 import employees as employees_v1
from app.api.v1 import expiry as expiry_v1
from app.api.v1 import extractions as extractions_v1
from app.api.v1 import identity as identity_v1
from app.api.v1 import intake as intake_v1
from app.api.v1 import leaves as leaves_v1
from app.api.v1 import ledger as ledger_v1
from app.api.v1 import managers as managers_v1
from app.api.v1 import notifications as notifications_v1
from app.api.v1 import notify as notify_v1
from app.api.v1 import permissions as permissions_v1
from app.api.v1 import push as push_v1
from app.api.v1 import recipients as recipients_v1
from app.api.v1 import scan_inbox as scan_inbox_v1
from app.api.v1 import settings as settings_v1
from app.api.v1 import signatures as signatures_v1
from app.api.v1 import smart_folders as smart_folders_v1
from app.api.v1 import submitters as submitters_v1
from app.api.v1 import system as system_v1
from app.api.v1 import templates as templates_v1
from app.config import get_settings
from app.logging import configure_logging
from app.services import scheduler_service

STATIC_DIR = Path(__file__).resolve().parent / "static"

# Reject request bodies larger than this before buffering them into RAM. Sits
# slightly above the 25 MiB per-attachment cap so legitimate uploads pass while
# a multi-GB body (memory-exhaustion DoS, API-01) is refused at the door.
MAX_BODY_BYTES = 30 * 1024 * 1024

log = logging.getLogger(__name__)


class BodySizeLimitMiddleware:
    """ASGI middleware rejecting over-large request bodies with a 413.

    Two layers: a fast ``Content-Length`` check (the common case — clients send
    it) and an incremental byte counter over the streamed body so a chunked /
    Content-Length-less upload is still capped before it is fully buffered.
    """

    def __init__(self, app: object, *, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):  # type: ignore[no-untyped-def]
        if scope["type"] != "http":
            await self.app(scope, receive, send)  # type: ignore[operator]
            return

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    if int(value) > self.max_bytes:
                        await self._reject(send)
                        return
                except ValueError:
                    pass
                break

        seen = 0

        async def _capped_receive():  # type: ignore[no-untyped-def]
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    # Signal end-of-stream so the app doesn't hang awaiting more.
                    return {"type": "http.disconnect"}
            return message

        await self.app(scope, _capped_receive, send)  # type: ignore[operator]

    @staticmethod
    async def _reject(send) -> None:  # type: ignore[no-untyped-def]
        body = b'{"error":{"code":"PAYLOAD_TOO_LARGE","message":"Request body too large.","details":{}}}'
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Boot the background scheduler on startup; shut it down on exit."""
    # Reconcile role_permissions with the in-code presets so capabilities added
    # to a role preset after the initial seed (e.g. books.approve added to manager)
    # reach already-deployed DBs without a manual migration.
    try:
        from app.db.session import SessionLocal
        from app.services import correspondence_service, perm_service

        with SessionLocal() as _db:
            perm_service.seed_role_defaults(_db)
            correspondence_service.seed_defaults(_db)
    except Exception:
        log.warning("role-default seeding at startup failed", exc_info=True)
    scheduler_service.start()
    try:
        yield
    finally:
        scheduler_service.shutdown()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings)
    log = logging.getLogger(__name__)

    app = FastAPI(
        title="GSSG Manager",
        version=__version__,
        docs_url="/api/docs" if settings.dev_mode else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.dev_mode else None,
        lifespan=_lifespan,
    )

    install_handlers(app)

    # Cap request bodies before they are buffered into RAM (API-01).
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_BODY_BYTES)

    # Baseline authentication: every data router requires a valid session.
    # Public surfaces (login/register/me/logout + the system probes the launcher
    # and migration wizard hit pre-login) are mounted without this gate; their
    # individually-sensitive endpoints (admin-key, migrate-v3) carry their own
    # capability dependency. Per-endpoint capability gates layer on top.
    auth_gate = [Depends(get_current_user)]

    # WebDAV for Word editing sessions — no prefix, no auth_gate:
    # token-in-URL auth; Word's HTTP stack sends no cookies.
    app.include_router(dav.router)

    app.include_router(system_v1.router, prefix="/api/v1")
    app.include_router(auth_v1.router, prefix="/api/v1")
    app.include_router(announcements_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(settings_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(employees_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(employees_v1.violations_router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(leaves_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(templates_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(documents_v1.documents_router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(documents_v1.jobs_router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(managers_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(duty_supervisors_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(digests_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(submitters_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(recipients_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(books_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(books_v1.categories_router, prefix="/api/v1", dependencies=auth_gate)
    # Smart folders mount BEFORE the ledger router so the static
    # /ledger/smart-folders paths win over the /ledger/{entry_id} catch-all.
    app.include_router(smart_folders_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(ledger_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(correspondence_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(editor_templates_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(dashboard_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(email_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(identity_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(signatures_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(extractions_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(intake_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(expiry_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(duty_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(scan_inbox_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(notifications_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(notify_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(push_v1.router, prefix="/api/v1", dependencies=auth_gate)
    app.include_router(permissions_v1.router, prefix="/api/v1", dependencies=auth_gate)

    if STATIC_DIR.is_dir():
        # Serve the built React app. `html=True` lets `/` resolve index.html.
        app.mount(
            "/assets",
            StaticFiles(directory=STATIC_DIR / "assets", check_dir=False),
            name="assets",
        )

        # The SPA entry (index.html) and the unhashed service worker are the
        # only files whose CONTENTS change without their URL changing, so they
        # must never be heuristically cached — otherwise a returning browser /
        # installed PWA keeps loading an old bundle and never sees new features
        # (e.g. the Send-SMS button) after a deploy. `no-cache` still allows a
        # cheap 304 revalidation via ETag. The hashed /assets/* chunks have
        # content-addressed names, so they stay immutable and freely cacheable.
        _NO_CACHE = {"Cache-Control": "no-cache"}
        _ALWAYS_REVALIDATE = {"sw.js", "manifest.webmanifest"}

        def _index() -> FileResponse:
            return FileResponse(STATIC_DIR / "index.html", headers=_NO_CACHE)

        @app.get("/", include_in_schema=False)
        def root() -> FileResponse:
            return _index()

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str) -> FileResponse:
            # Any non-API GET falls back to index.html so React Router works.
            candidate = STATIC_DIR / full_path
            if candidate.is_file():
                headers = _NO_CACHE if candidate.name in _ALWAYS_REVALIDATE else None
                return FileResponse(candidate, headers=headers)
            return _index()

    log.info("FastAPI app ready (dev_mode=%s, data_dir=%s)", settings.dev_mode, settings.data_dir)
    return app


app = create_app()
