"""P01 — blocking work in ``async`` route handlers must not stall the event loop.

Real application, real ASGI seam: ``create_app()`` served through
``httpx.ASGITransport`` on a live asyncio loop, a file-backed SQLite database with
real ``get_db`` sessions, real cookie authentication and real permission checks.
Only the slow external/native boundary is replaced by a *controlled* blocking
adapter (a bounded ``threading.Event`` wait standing in for OCR, IMAP, the WhatsApp
gateway or a contended SQLite writer). While the adapter blocks, a back-to-back
``/api/v1/system/health`` prober runs on the same loop.

The verdicts are structural, not timing thresholds:

* the adapter ran on a worker thread, never on the event-loop thread;
* health requests *completed while the adapter was blocked*;
* no SQL statement executed on the event-loop thread;
* contract (status/body) is unchanged and no ``Session`` is left checked out.

Every block is capped (``BLOCK_CAP_S``) so an implementation that blocks the loop
fails instead of hanging the suite. Set ``SENTINEL_LOOP_BENCH_OUT=<file.jsonl>``
(and optionally ``SENTINEL_LOOP_BENCH_LABEL``) to append one JSON object per
scenario — the frozen benchmark procedure in
``mockups/plan/backend-optimization-p01.md``. Metrics are written *before* the
assertions so a failing (baseline) run still records its measurements.
"""

from __future__ import annotations

import ast
import asyncio
import gc
import imaplib
import io
import json
import os
import resource
import statistics
import sys
import threading
import time
import warnings
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pymupdf
import pytest
import zxingcpp
from PIL import Image
from sqlalchemy import Engine, event, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core import crypto
from app.core import signature as signature_core
from app.core.extraction import ocr
from app.db import session as session_mod
from app.db.models import (
    AuthSession,
    Book,
    BookCategory,
    BookEditSession,
    BookVersion,
    Document,
    EmailAccount,
    Employee,
    User,
    UserPermission,
)
from app.main import create_app
from app.services import (
    announce_service,
    auth_service,
    email_service,
    leave_service,
    ledger_service,
    manager_service,
    openwa_client,
    permit_service,
    photo_service,
    staging_service,
    user_signature_service,
    vault_service,
    vehicle_service,
    word_session_repo,
)
from app.services import book_service as book_service_mod
from tests.fakes.imap import FakeImapServer

BLOCK_CAP_S = 2.0  # hard ceiling on a controlled block: a loop-blocking build fails, never hangs
MIN_HEALTH_DURING_BLOCK = 3
HEARTBEAT_TICK_S = 0.01
HEARTBEAT_GAP_LIMIT_S = 1.0  # deliberately generous; the structural assertions carry the verdict
SCENARIO_WALL_LIMIT_S = BLOCK_CAP_S + 10.0
HEALTH_URL = "/api/v1/system/health"

#: Synthetic, obviously-fake document text (no real person or ID).
FAKE_EID_TEXT = (
    "United Arab Emirates\nResident Identity Card\n"
    "ID Number 784-1985-1234567-1\nName: Omar Test Person\nNationality: Egypt\n"
)


# ---------------------------------------------------------------------------
# Controlled blocking adapter
# ---------------------------------------------------------------------------


class Blocker:
    """Deterministic stand-in for one slow external/native call.

    ``mark()`` records which thread did the work; ``block()`` holds the calling
    thread until ``release`` is set (or ``cap`` expires). ``active`` is true only once
    the request under test has reached the slow section (``mark()`` was called) and a
    call is inside ``block()`` and not yet released, so a health response is never
    credited to a block the request has not entered.
    """

    def __init__(self, cap: float = BLOCK_CAP_S, *, only_first: bool = True) -> None:
        self.cap = cap
        self.only_first = only_first
        self.entered = threading.Event()
        self.release = threading.Event()
        self._lock = threading.Lock()
        self._peer_barrier: threading.Barrier | None = None
        self.calls = 0
        self.concurrent = 0
        self.max_concurrent = 0
        self.work_thread_ids: list[int] = []

    @property
    def active(self) -> bool:
        return bool(self.work_thread_ids) and self.concurrent > 0 and not self.release.is_set()

    def mark(self) -> None:
        with self._lock:
            self.work_thread_ids.append(threading.get_ident())

    def block(self, *, hold: float | None = None) -> None:
        """Hold the calling thread; ``hold`` overrides the wait with a fixed pause."""
        with self._lock:
            self.calls += 1
            first = self.calls == 1
            self.concurrent += 1
            self.max_concurrent = max(self.max_concurrent, self.concurrent)
        self.entered.set()
        try:
            if hold is not None:
                time.sleep(hold)
            elif first or not self.only_first:
                self.release.wait(self.cap)
        finally:
            with self._lock:
                self.concurrent -= 1

    def rendezvous(self, parties: int, cap: float) -> None:
        """Wait until ``parties`` callers are inside, or give up after ``cap``.

        An exclusive implementation can never satisfy the rendezvous (the peer is
        queued behind it) and times out; an overlapping one passes straight through.
        """
        with self._lock:
            if self._peer_barrier is None:
                self._peer_barrier = threading.Barrier(parties, timeout=cap)
            barrier = self._peer_barrier
        with self._lock:
            self.concurrent += 1
            self.max_concurrent = max(self.max_concurrent, self.concurrent)
        try:
            barrier.wait()
        except threading.BrokenBarrierError:
            pass
        finally:
            with self._lock:
                self.concurrent -= 1


class SqliteWriterLock:
    """Hold SQLite's write lock from another connection, released by ``blocker``."""

    def __init__(self, engine: Engine, blocker: Blocker) -> None:
        self._engine = engine
        self._blocker = blocker
        self._thread = threading.Thread(target=self._run, name="p01-writer-lock", daemon=True)
        self._locked = threading.Event()

    def _run(self) -> None:
        raw = self._engine.raw_connection()
        try:
            cursor = raw.cursor()
            cursor.execute("BEGIN IMMEDIATE")
            self._locked.set()
            self._blocker.block()
            raw.rollback()
            cursor.close()
        finally:
            raw.close()

    def start(self) -> None:
        self._thread.start()
        assert self._locked.wait(5), "writer-lock holder did not acquire the lock"
        # The holder is *inside* block(); make the lock visible as the active block.

    def join(self) -> None:
        self._thread.join(timeout=BLOCK_CAP_S + 5)


# ---------------------------------------------------------------------------
# Environment: real app + real DB/session lifecycle + real auth
# ---------------------------------------------------------------------------


@dataclass
class Env:
    db: Session
    engine: Engine
    data_dir: Path
    mp: pytest.MonkeyPatch

    def make_user(
        self,
        role: str,
        *,
        email: str | None = None,
        denied: tuple[str, ...] = (),
    ) -> tuple[User, str]:
        """A real, active account plus a real session cookie token (warm: no last-seen write)."""
        user = User(
            email=email or f"{role}-p01@test.ae",
            password_hash="x",
            display_name=f"{role} p01",
            role=role,
            status="active",
        )
        self.db.add(user)
        self.db.commit()
        for capability in denied:
            self.db.add(UserPermission(user_id=user.id, capability=capability, effect="deny"))
        token = auth_service.start_session(self.db, user)
        self.db.execute(update(AuthSession).values(last_seen_at=auth_service._utcnow()))
        self.db.commit()
        return user, token


def _collect_asgi_streams_quietly() -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ResourceWarning)
        gc.collect()


@contextmanager
def stream_leaks_tolerated() -> Iterator[None]:
    """Ignore the ASGI-stream ResourceWarning for requests a test cancels or fails on purpose."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ResourceWarning)
        yield
        gc.collect()


@pytest.fixture(autouse=True)
def _collect_asgi_streams() -> Iterator[None]:
    """Contain a known httpx-ASGITransport/Starlette artifact to this module.

    When the app answers before reading the request body (an early 401/403/404), the
    ``BaseHTTPMiddleware`` debug recorder leaves an anyio ``MemoryObjectReceiveStream``
    unclosed until GC. With ``filterwarnings=error`` that surfaces as an unraisable error in
    whichever test next triggers a collection. Collect here, with ResourceWarning silenced,
    so a leak cannot be blamed on an unrelated test. Pre-existing, test-harness only.
    """
    yield
    _collect_asgi_streams_quietly()


@pytest.fixture(autouse=True)
def _forbid_external_imap(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("tests must inject FakeImapServer.connector")

    monkeypatch.setattr(imaplib, "IMAP4", blocked)
    monkeypatch.setattr(imaplib, "IMAP4_SSL", blocked)


@pytest.fixture()
def env(api_db: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Env]:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("GSSG_DISABLE_SCHEDULER", "1")
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()
    engine = api_db.get_bind()
    assert isinstance(engine, Engine)
    assert session_mod.engine is engine  # get_db hands out sessions bound to this engine
    yield Env(db=api_db, engine=engine, data_dir=tmp_path, mp=monkeypatch)
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()


# ---------------------------------------------------------------------------
# Synthetic fixtures
# ---------------------------------------------------------------------------


def barcode_pdf(ref: str, paper_date: str = "20260921") -> bytes:
    """A one-page PDF carrying a real Code 39 reference barcode (zxing + PyMuPDF)."""
    date_text = datetime.strptime(paper_date, "%Y%m%d").strftime("%d/%m/%Y")
    barcode = Image.fromarray(
        zxingcpp.create_barcode(f"GSSG+{date_text}+{ref}", zxingcpp.BarcodeFormat.Code39).to_image(
            scale=4
        )
    )
    image = io.BytesIO()
    barcode.save(image, format="PNG")
    with pymupdf.open() as pdf:
        page = pdf.new_page(width=595, height=842)
        page.insert_image(pymupdf.Rect(40, 40, 500, 140), stream=image.getvalue())
        return pdf.tobytes()


def blank_pdf() -> bytes:
    with pymupdf.open() as pdf:
        pdf.new_page()
        return pdf.tobytes()


def png_bytes() -> bytes:
    image = io.BytesIO()
    Image.new("RGB", (64, 40), "white").save(image, format="PNG")
    return image.getvalue()


def general_book(db: Session, *, ref: str = "1/5/141", state: str = "awaiting_scan") -> Book:
    category = db.get(BookCategory, "GS") or BookCategory(id="GS", name_en="Records", prefix="GS")
    book = Book(
        category=category,
        ref_number=ref,
        approval_state=state,
        created_at=datetime(2026, 9, 21),
    )
    book.versions.append(
        BookVersion(
            version_no=1,
            template_id="General Book",
            fields={"date": "21-09-2026"},
            status=state,
        )
    )
    db.add(book)
    db.commit()
    return book


def employee(db: Session, employee_id: str = "G9001") -> Employee:
    row = Employee(id=employee_id, name_en="Synthetic Employee")
    db.add(row)
    db.commit()
    return row


def dav_session(env: Env, *, token: str = "tok-p01", name: str = "letter.docx") -> Path:
    suffix = "p01" if token == "tok-p01" else token
    owner = User(
        email=f"dav-owner-{suffix}@test.ae", password_hash="x", status="active", role="operator"
    )
    env.db.add(owner)
    env.db.flush()
    if env.db.get(BookCategory, "GEN") is None:
        env.db.add(BookCategory(id="GEN", name_en="General", name_ar="عام", prefix="GEN"))
        env.db.flush()
    book = Book(category_id="GEN", ref_number=f"B-{suffix.upper()}")
    env.db.add(book)
    env.db.flush()
    working = env.data_dir / "word_sessions" / name
    working.parent.mkdir(parents=True, exist_ok=True)
    working.write_bytes(b"original-docx-bytes")
    env.db.add(
        BookEditSession(
            book_id=book.id,
            user_id=owner.id,
            token=token,
            working_path=str(working),
            state="active",
        )
    )
    env.db.commit()
    return working


# ---------------------------------------------------------------------------
# Scenario driver
# ---------------------------------------------------------------------------


@dataclass
class Scenario:
    name: str
    blocker: Blocker
    send: Callable[[httpx.AsyncClient], Awaitable[httpx.Response]]
    check: Callable[[httpx.Response], None]
    token: str | None = None
    before: Callable[[], None] | None = None
    after: Callable[[], None] | None = None


@dataclass
class Metrics:
    route: str
    loop_thread: int = 0
    adapter_on_loop_thread: bool = False
    adapter_reached: bool = False
    health_during_block: int = 0
    health_latencies_ms: list[float] = field(default_factory=list)
    heartbeat_max_gap_ms: float = 0.0
    sql_on_loop_thread: int = 0
    request_wall_ms: float = 0.0
    cpu_s: float = 0.0
    max_rss_mb: float = 0.0
    status: int = 0

    def as_record(self) -> dict[str, Any]:
        lat = sorted(self.health_latencies_ms) or [0.0]
        return {
            "label": os.environ.get("SENTINEL_LOOP_BENCH_LABEL", ""),
            "route": self.route,
            "status": self.status,
            "block_cap_s": BLOCK_CAP_S,
            "adapter_reached": self.adapter_reached,
            "adapter_on_loop_thread": self.adapter_on_loop_thread,
            "health_during_block": self.health_during_block,
            "health_samples": len(lat),
            "health_p50_ms": round(statistics.median(lat), 2),
            "health_p95_ms": round(lat[min(len(lat) - 1, int(len(lat) * 0.95))], 2),
            "health_max_ms": round(lat[-1], 2),
            "heartbeat_max_gap_ms": round(self.heartbeat_max_gap_ms, 2),
            "sql_on_loop_thread": self.sql_on_loop_thread,
            "request_wall_ms": round(self.request_wall_ms, 2),
            "cpu_s": round(self.cpu_s, 3),
            "max_rss_mb": round(self.max_rss_mb, 1),
            "python": sys.version.split()[0],
        }


@contextmanager
def sql_thread_recorder(engine: Engine) -> Iterator[list[int]]:
    seen: list[int] = []

    def _on_execute(*_args: object) -> None:
        seen.append(threading.get_ident())

    event.listen(engine, "before_cursor_execute", _on_execute)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", _on_execute)


def _record(metrics: Metrics) -> None:
    out = os.environ.get("SENTINEL_LOOP_BENCH_OUT")
    if out:
        with open(out, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(metrics.as_record()) + "\n")


async def drive(env: Env, scenario: Scenario) -> tuple[Metrics, httpx.Response]:
    """Run one request through the ASGI app while probing health on the same loop."""
    loop = asyncio.get_running_loop()
    blocker = scenario.blocker
    metrics = Metrics(route=scenario.name, loop_thread=threading.get_ident())
    app = create_app()
    cookies = {"gssg_session": scenario.token} if scenario.token else None
    gaps: list[float] = []
    health_during: list[float] = []
    stop = asyncio.Event()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        # Warm the app (route table, validators) so the probe measures blocking, not import cost.
        warm = await client.get(HEALTH_URL)
        assert warm.status_code == 200

        async def heartbeat() -> None:
            last = loop.time()
            while not stop.is_set():
                await asyncio.sleep(HEARTBEAT_TICK_S)
                now = loop.time()
                gaps.append(now - last - HEARTBEAT_TICK_S)
                last = now

        async def prober() -> None:
            while not stop.is_set():
                started = loop.time()
                response = await client.get(HEALTH_URL)
                finished = loop.time()
                metrics.health_latencies_ms.append((finished - started) * 1000)
                if response.status_code == 200 and blocker.active:
                    health_during.append(finished - started)

        if scenario.before:
            scenario.before()
        cpu0 = time.process_time()
        background: list[asyncio.Task[None]] = []
        request: asyncio.Task[httpx.Response] | None = None
        try:
            with sql_thread_recorder(env.engine) as sql_seen:
                background = [asyncio.create_task(heartbeat()), asyncio.create_task(prober())]
                began = loop.time()
                request = asyncio.create_task(scenario.send(client))
                deadline = began + SCENARIO_WALL_LIMIT_S
                while not request.done() and loop.time() < deadline:
                    if len(health_during) >= MIN_HEALTH_DURING_BLOCK:
                        blocker.release.set()
                    await asyncio.sleep(0.005)
                blocker.release.set()
                response = await asyncio.wait_for(request, timeout=BLOCK_CAP_S + 10)
                metrics.request_wall_ms = (loop.time() - began) * 1000
        finally:
            blocker.release.set()
            stop.set()
            # Let the probe finish its in-flight request (cancelling mid-request leaks the
            # ASGI stream objects); only an abandoned scenario request is cancelled.
            if request is not None and not request.done():
                request.cancel()
            await asyncio.gather(
                *background, *([request] if request is not None else []), return_exceptions=True
            )
            if scenario.after:
                scenario.after()
        metrics.cpu_s = time.process_time() - cpu0

    metrics.status = response.status_code
    metrics.adapter_reached = bool(blocker.work_thread_ids) or blocker.calls > 0
    metrics.adapter_on_loop_thread = metrics.loop_thread in blocker.work_thread_ids
    metrics.health_during_block = len(health_during)
    metrics.heartbeat_max_gap_ms = max(gaps, default=0.0) * 1000
    metrics.sql_on_loop_thread = sum(1 for tid in sql_seen if tid == metrics.loop_thread)
    metrics.max_rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    return metrics, response


def run_scenario(env: Env, scenario: Scenario) -> Metrics:
    metrics, response = asyncio.run(drive(env, scenario))
    _record(metrics)
    # Verdicts: structural first, contract second.
    assert metrics.adapter_reached, f"{scenario.name}: the slow adapter was never reached"
    assert not metrics.adapter_on_loop_thread, (
        f"{scenario.name}: the slow adapter executed ON the event-loop thread "
        "(blocking work in an async handler)"
    )
    assert metrics.health_during_block >= MIN_HEALTH_DURING_BLOCK, (
        f"{scenario.name}: only {metrics.health_during_block} health responses completed while "
        f"the adapter was blocked (need >= {MIN_HEALTH_DURING_BLOCK}); the loop was stalled "
        f"(max health latency {max(metrics.health_latencies_ms, default=0):.0f} ms, "
        f"heartbeat gap {metrics.heartbeat_max_gap_ms:.0f} ms)"
    )
    assert metrics.sql_on_loop_thread == 0, (
        f"{scenario.name}: {metrics.sql_on_loop_thread} SQL statement(s) ran on the event-loop thread"
    )
    assert metrics.heartbeat_max_gap_ms / 1000 < HEARTBEAT_GAP_LIMIT_S, (
        f"{scenario.name}: loop heartbeat gap {metrics.heartbeat_max_gap_ms:.0f} ms"
    )
    scenario.check(response)
    # Session lifecycle: the request's own Session must be closed, not left checked out.
    env.db.rollback()
    pool = env.engine.pool
    checked_out = getattr(pool, "checkedout", lambda: 0)()
    assert checked_out == 0, f"{scenario.name}: {checked_out} connection(s) left checked out"
    return metrics


# ---------------------------------------------------------------------------
# Headline scenarios: one per distinct blocking source
# ---------------------------------------------------------------------------


def scenario_scan_back(env: Env) -> Scenario:
    _manager, token = env.make_user("manager")
    book = general_book(env.db)
    blocker = Blocker()
    real = ocr.decode_codes_from_bytes

    def slow_decode(raw: bytes) -> Any:
        blocker.mark()
        blocker.block()
        return real(raw)

    env.mp.setattr(ocr, "decode_codes_from_bytes", slow_decode)
    pdf = barcode_pdf(book.ref_number)

    def check(response: httpx.Response) -> None:
        assert response.status_code == 200, response.text
        assert response.json() == {
            "book_id": book.id,
            "ref_number": book.ref_number,
            "outcome": "filed",
        }
        env.db.expire_all()
        assert env.db.get(Book, book.id).approval_state == "approved"

    return Scenario(
        "scan_back",
        blocker,
        lambda c: c.post(
            "/api/v1/books/scan-back",
            files={"file": ("signed.pdf", pdf, "application/pdf")},
        ),
        check,
        token,
    )


def scenario_book_attachment(env: Env) -> Scenario:
    _manager, token = env.make_user("manager")
    book = general_book(env.db, state="none")
    blocker = Blocker()
    real = ocr.decode_codes_from_bytes

    def slow_decode(raw: bytes) -> Any:
        blocker.mark()
        blocker.block()
        return real(raw)

    env.mp.setattr(ocr, "decode_codes_from_bytes", slow_decode)
    pdf = blank_pdf()

    def check(response: httpx.Response) -> None:
        assert response.status_code == 200, response.text
        assert response.json()["id"] == book.id
        env.db.expire_all()
        assert len(env.db.get(Book, book.id).attachment_paths or []) == 1

    return Scenario(
        "book_attachment",
        blocker,
        lambda c: c.post(
            f"/api/v1/books/{book.id}/attachments",
            files={"file": ("plain.pdf", pdf, "application/pdf")},
        ),
        check,
        token,
    )


def _ocr_scenario(env: Env, *, name: str, url: str, keys: set[str]) -> Scenario:
    _manager, token = env.make_user("manager")
    blocker = Blocker()

    def slow_ocr(_image: object) -> ocr.OcrResult:
        blocker.mark()
        blocker.block()
        return ocr.OcrResult(text=FAKE_EID_TEXT, confidence=0.9)

    env.mp.setattr(ocr, "extract_text", slow_ocr)
    image = png_bytes()

    def check(response: httpx.Response) -> None:
        assert response.status_code == 200, response.text
        assert set(response.json()) == keys

    return Scenario(
        name,
        blocker,
        lambda c: c.post(url, files={"file": ("scan.png", image, "image/png")}),
        check,
        token,
    )


def scenario_permit_emirates_id(env: Env) -> Scenario:
    return _ocr_scenario(
        env,
        name="permit_scan_emirates_id",
        url="/api/v1/permits/scan-emirates-id",
        keys={"name", "uae_id", "nationality"},
    )


def scenario_permit_vehicle_licence(env: Env) -> Scenario:
    return _ocr_scenario(
        env,
        name="permit_scan_vehicle_licence",
        url="/api/v1/permits/scan-vehicle-licence",
        keys={
            "plate_no",
            "plate_emirate",
            "plate_category",
            "traffic_no",
            "make_model",
            "vehicle_type",
            "colour",
            "reg_expiry",
            "driver_name",
        },
    )


def scenario_email_handoff(env: Env) -> Scenario:
    user, token = env.make_user("operator")
    env.db.add(
        EmailAccount(
            email="sender@gssg.ae",
            imap_host="imap.ionos.com",
            imap_port=993,
            use_ssl=True,
            username="sender@gssg.ae",
            password_encrypted="unused-by-fake-imap",
            smtp_host="smtp.ionos.com",
            smtp_port=587,
            smtp_use_tls=True,
            sent_folder="Sent",
            drafts_folder="Outlook Drafts",
            inbox_folder="INBOX",
            enabled=True,
            sync_interval_minutes=5,
            owner_user_id=user.id,
        )
    )
    env.db.commit()
    server = FakeImapServer()
    drafts = server.add_folder("Outlook Drafts")
    blocker = Blocker()

    def connector(account: EmailAccount) -> Any:
        connection = server.connector(account)
        real_append = connection.append

        def slow_append(*args: Any) -> Any:
            blocker.mark()
            blocker.block()
            return real_append(*args)

        connection.append = slow_append
        return connection

    env.mp.setattr(email_service, "connect_imap", connector)

    def check(response: httpx.Response) -> None:
        assert response.status_code == 201, response.text
        assert response.json()["mode"] == "draft"
        assert len(drafts.messages) == 1

    return Scenario(
        "email_handoff",
        blocker,
        lambda c: c.post(
            "/api/v1/email/handoff",
            data={
                "to": "recipient@example.com",
                "subject": "P01 synthetic draft",
                "html": "<p>Hello</p>",
                "mode": "draft",
            },
        ),
        check,
        token,
    )


def scenario_announcement(env: Env) -> Scenario:
    _admin, token = env.make_user("admin")
    blocker = Blocker()
    env.mp.setattr(announce_service, "get_settings", lambda: SimpleNamespace(openwa_enabled=True))
    env.mp.setattr(
        announce_service,
        "groups_available",
        lambda _db: [SimpleNamespace(id="1@g.us", name="Alpha")],
    )

    def slow_send(group_id: str, text: str, **_kw: object) -> openwa_client.SendResult:
        blocker.mark()
        blocker.block()
        return openwa_client.SendResult(ok=True, message_id="msg-p01")

    env.mp.setattr(openwa_client, "send_to_chat", slow_send)

    def check(response: httpx.Response) -> None:
        assert response.status_code == 200, response.text
        body = response.json()
        assert (body["sent"], body["failed"]) == (1, 0)
        assert body["results"] == [
            {"group_id": "1@g.us", "group_name": "Alpha", "ok": True, "error": None}
        ]

    return Scenario(
        "announcement_group_send",
        blocker,
        lambda c: c.post(
            "/api/v1/announcements/send", data={"group_ids": ["1@g.us"], "text": "P01 notice"}
        ),
        check,
        token,
    )


def scenario_dav_put(env: Env) -> Scenario:
    working = dav_session(env)
    blocker = Blocker()
    real = word_session_repo.record_put

    def observed_record_put(db: Session, session_id: int) -> None:
        blocker.mark()
        real(db, session_id)

    env.mp.setattr(word_session_repo, "record_put", observed_record_put)
    writer = SqliteWriterLock(env.engine, blocker)

    def check(response: httpx.Response) -> None:
        assert response.status_code == 204, response.text
        assert working.read_bytes() == b"saved by word"

    return Scenario(
        "dav_put_contended_writer",
        blocker,
        lambda c: c.put("/dav/tok-p01/letter.docx", content=b"saved by word"),
        check,
        token=None,
        before=writer.start,
        after=writer.join,
    )


HEADLINE: dict[str, Callable[[Env], Scenario]] = {
    "scan_back": scenario_scan_back,
    "book_attachment": scenario_book_attachment,
    "permit_scan_emirates_id": scenario_permit_emirates_id,
    "permit_scan_vehicle_licence": scenario_permit_vehicle_licence,
    "email_handoff": scenario_email_handoff,
    "announcement_group_send": scenario_announcement,
    "dav_put_contended_writer": scenario_dav_put,
}


@pytest.mark.parametrize("route", HEADLINE)
def test_event_loop_stays_responsive_during_slow_route(env: Env, route: str) -> None:
    run_scenario(env, HEADLINE[route](env))


# ---------------------------------------------------------------------------
# Sibling handlers (same root cause): the controlled adapter wraps the service call
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Sibling:
    method: str
    url: Callable[[Env], str]
    module: Any
    attr: str
    prepare: Callable[[Env], None] = lambda _env: None
    data: dict[str, str] | None = None
    file_field: str | None = "file"
    filename: str = "scan.png"
    media: str = "image/png"
    content: Callable[[], bytes] = png_bytes


def _vault_kind() -> str:
    return vault_service.VAULT_KINDS[0]


SIBLINGS: dict[str, Sibling] = {
    "stage_attachment": Sibling(
        "POST", lambda e: "/api/v1/documents/attachments/stage", staging_service, "stage"
    ),
    "ledger_attachment": Sibling(
        "POST", lambda e: "/api/v1/ledger/1/attachments", ledger_service, "add_attachment"
    ),
    "leave_certificate": Sibling(
        "POST", lambda e: "/api/v1/leaves/1/certificate", leave_service, "add_certificate"
    ),
    "my_signature": Sibling(
        "POST",
        lambda e: "/api/v1/auth/me/signature",
        user_signature_service,
        "save_signature",
        file_field="file",
    ),
    "manager_signature": Sibling(
        "POST",
        lambda e: "/api/v1/managers/1/signature",
        manager_service,
        "save_manager_signature",
    ),
    "employee_signature": Sibling(
        "POST",
        lambda e: "/api/v1/employees/G9001/signature",
        signature_core,
        "save",
        prepare=lambda e: employee(e.db),
    ),
    "employee_photo": Sibling(
        "POST",
        lambda e: "/api/v1/employees/G9001/photo",
        photo_service,
        "save_photo",
        prepare=lambda e: employee(e.db),
    ),
    "vault_upload": Sibling(
        "POST",
        lambda e: "/api/v1/employees/G9001/vault/upload",
        vault_service,
        "save_upload",
        prepare=lambda e: employee(e.db),
        data={"kind": _vault_kind()},
    ),
    "permit_person_document": Sibling(
        "POST",
        lambda e: "/api/v1/permits/1/people/1/document",
        permit_service,
        "attach_person_document",
    ),
    "permit_vehicle_document": Sibling(
        "POST",
        lambda e: "/api/v1/permits/1/vehicles/1/document",
        permit_service,
        "attach_vehicle_document",
    ),
    "permit_document": Sibling(
        "POST", lambda e: "/api/v1/permits/1/document", permit_service, "attach_document"
    ),
    "book_replace_attachment": Sibling(
        "PUT",
        lambda e: f"/api/v1/books/{general_book(e.db, state='none').id}/attachments/0",
        book_service_mod,
        "replace_attachment",
    ),
    "book_replace_signed_copy": Sibling(
        "PUT",
        lambda e: f"/api/v1/books/{general_book(e.db, state='none').id}/signed-copy",
        book_service_mod,
        "replace_signed_copy",
    ),
    "vehicle_fine_payment": Sibling(
        "POST",
        lambda e: "/api/v1/vehicles/1/fines/1/payment",
        vehicle_service,
        "record_payment",
    ),
    "vehicle_fine_receipt": Sibling(
        "PUT",
        lambda e: "/api/v1/vehicles/1/fines/1/receipt",
        vehicle_service,
        "attach_receipt",
    ),
}


@pytest.mark.parametrize("name", SIBLINGS)
def test_sibling_handlers_run_blocking_work_off_the_loop(env: Env, name: str) -> None:
    spec = SIBLINGS[name]
    _admin, token = env.make_user("admin")
    spec.prepare(env)
    url = spec.url(env)
    blocker = Blocker()
    real = getattr(spec.module, spec.attr)

    def slow(*args: Any, **kwargs: Any) -> Any:
        blocker.mark()
        blocker.block()
        return real(*args, **kwargs)

    env.mp.setattr(spec.module, spec.attr, slow)
    payload = spec.content()
    files = {spec.file_field: (spec.filename, payload, spec.media)} if spec.file_field else None

    def check(response: httpx.Response) -> None:
        # The service call is reached (adapter ran); the real service then answers with the
        # route's own contract (200 or its documented 4xx envelope) — never a server error.
        assert response.status_code < 500, response.text

    scenario = Scenario(
        name,
        blocker,
        lambda c: c.request(spec.method, url, data=spec.data, files=files),
        check,
        token,
    )
    run_scenario(env, scenario)


# ---------------------------------------------------------------------------
# Permissions: the gate still runs before any offloaded work (PII boundary)
# ---------------------------------------------------------------------------


def test_unprivileged_user_is_refused_before_any_offloaded_work(env: Env) -> None:
    """An operator holds no ``books.edit``: the capability gate answers before any work."""
    scenario = scenario_scan_back(env)
    _operator, token = env.make_user("operator", email="operator-denied@test.ae")
    scenario.token = token
    metrics, response = asyncio.run(drive(env, scenario))
    assert response.status_code == 403
    assert response.json()["error"]["details"] == {"capability": "books.edit"}
    assert scenario.blocker.calls == 0, "slow adapter must not run for a refused request"
    assert metrics.sql_on_loop_thread == 0


def test_denied_capability_override_refuses_handoff_without_mailbox_work(env: Env) -> None:
    scenario = scenario_email_handoff(env)
    # Same account, but the caller's ledger.send grant is explicitly denied.
    _user, token = env.make_user("operator", email="op-denied@test.ae", denied=("ledger.send",))
    scenario.token = token
    metrics, response = asyncio.run(drive(env, scenario))
    assert response.status_code == 403
    assert response.json()["error"]["details"] == {"capability": "ledger.send"}
    assert scenario.blocker.calls == 0
    assert metrics.sql_on_loop_thread == 0


def test_unknown_dav_token_is_refused_without_touching_the_working_file(env: Env) -> None:
    working = dav_session(env)
    blocker = Blocker()
    scenario = Scenario(
        "dav_bad_token",
        blocker,
        lambda c: c.put("/dav/not-the-token/letter.docx", content=b"intruder"),
        lambda r: None,
    )
    _metrics, response = asyncio.run(drive(env, scenario))
    assert response.status_code == 404
    assert working.read_bytes() == b"original-docx-bytes"


# ---------------------------------------------------------------------------
# Safety of the boundary itself: exclusivity, no pool exhaustion, no state races
# ---------------------------------------------------------------------------


async def _gather_posts(
    token: str | None,
    requests: list[Callable[[httpx.AsyncClient], Awaitable[httpx.Response]]],
    *,
    blocker: Blocker,
    probe_health: bool = False,
) -> tuple[list[httpx.Response], int]:
    """Send ``requests`` concurrently through the real app; optionally probe health meanwhile.

    Unhandled application exceptions come back as 500 responses (not raised) so each test
    asserts on the observable status codes.
    """
    app = create_app()
    health_during = 0
    cookies = {"gssg_session": token} if token else None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
        cookies=cookies,
    ) as client:
        assert (await client.get(HEALTH_URL)).status_code == 200
        tasks = [asyncio.create_task(send(client)) for send in requests]
        if probe_health:
            loop = asyncio.get_running_loop()
            deadline = loop.time() + SCENARIO_WALL_LIMIT_S
            while loop.time() < deadline and health_during < MIN_HEALTH_DURING_BLOCK:
                response = await client.get(HEALTH_URL)
                if response.status_code == 200 and blocker.active:
                    health_during += 1
            blocker.release.set()
        responses = await asyncio.gather(*tasks)
    return list(responses), health_during


def _emirates_scan_requests(
    count: int,
) -> list[Callable[[httpx.AsyncClient], Awaitable[httpx.Response]]]:
    image = png_bytes()
    return [
        (
            lambda c: c.post(
                "/api/v1/permits/scan-emirates-id",
                files={"file": ("scan.png", image, "image/png")},
            )
        )
        for _ in range(count)
    ]


def test_exclusive_lane_does_not_exhaust_the_worker_pool(env: Env) -> None:
    """One stuck OCR call plus 47 queued uploads must not starve pool-served routes.

    ``/system/health`` is a plain ``def`` route served from the shared AnyIO worker
    pool. A lock-based design that parks one pool thread per queued request would
    consume all 40 pool threads and freeze it; the lane waits on the loop instead.
    """
    scenario = scenario_permit_emirates_id(env)
    assert scenario.token is not None
    responses, health_during = asyncio.run(
        _gather_posts(
            scenario.token,
            _emirates_scan_requests(48),
            blocker=scenario.blocker,
            probe_health=True,
        )
    )
    assert health_during >= MIN_HEALTH_DURING_BLOCK, (
        f"only {health_during} health responses while 1 call was stuck and 47 were queued"
    )
    assert [r.status_code for r in responses] == [200] * 48
    assert scenario.blocker.calls == 48


def test_exclusive_lane_never_overlaps_native_section(env: Env) -> None:
    """Handlers that ran one-at-a-time on the loop must still never overlap in OCR/PDF code."""
    _manager, token = env.make_user("manager")
    blocker = Blocker(only_first=False)

    def paused_ocr(_image: object) -> ocr.OcrResult:
        blocker.mark()
        blocker.block(hold=0.05)
        return ocr.OcrResult(text=FAKE_EID_TEXT, confidence=0.9)

    env.mp.setattr(ocr, "extract_text", paused_ocr)
    responses, _ = asyncio.run(_gather_posts(token, _emirates_scan_requests(6), blocker=blocker))
    assert [r.status_code for r in responses] == [200] * 6
    assert blocker.calls == 6
    assert blocker.max_concurrent == 1, (
        f"{blocker.max_concurrent} requests were inside the native section at once"
    )


def test_overlapping_scan_backs_file_the_record_exactly_once(env: Env) -> None:
    """The loop used to serialise scan-backs; a plain thread offload would sign twice."""
    _manager, token = env.make_user("manager")
    book = general_book(env.db)
    blocker = Blocker(only_first=False)
    real = ocr.decode_codes_from_bytes

    def decode_with_peer_rendezvous(raw: bytes) -> Any:
        blocker.mark()
        blocker.rendezvous(parties=2, cap=0.3)
        return real(raw)

    env.mp.setattr(ocr, "decode_codes_from_bytes", decode_with_peer_rendezvous)
    pdf = barcode_pdf(book.ref_number)
    requests = [
        (
            lambda c: c.post(
                "/api/v1/books/scan-back",
                files={"file": ("signed.pdf", pdf, "application/pdf")},
            )
        )
        for _ in range(2)
    ]
    responses, _ = asyncio.run(_gather_posts(token, requests, blocker=blocker))
    statuses = sorted(r.status_code for r in responses)
    assert statuses == [200, 422], (
        f"statuses {statuses}: the same awaiting-scan record was filed by both requests"
    )
    refused = next(r for r in responses if r.status_code == 422)
    assert refused.json()["error"]["code"] == "BOOK_NOT_AWAITING_SCAN"
    env.db.expire_all()
    version = env.db.get(Book, book.id).versions[-1]
    signed = list((env.data_dir / "book_attachments" / str(book.id)).glob("signed-v*"))
    assert version.signed_pdf_path is not None
    assert len(signed) == 1, f"signed copies on disk: {[p.name for p in signed]}"


def test_concurrent_dav_puts_do_not_corrupt_the_working_file(env: Env) -> None:
    """Two overlapping Word saves (e.g. a client retry) must both land atomically."""
    from app.api import dav as dav_api

    working = dav_session(env)
    blocker = Blocker(only_first=False)
    real_replace = os.replace

    def replace_after_peer(src: str, dst: str) -> None:
        blocker.mark()
        blocker.rendezvous(parties=2, cap=0.3)
        real_replace(src, dst)

    env.mp.setattr(dav_api.os, "replace", replace_after_peer)
    bodies = [b"A" * 4096 + b"first save", b"B" * 4096 + b"second save"]
    requests = [(lambda c, b=body: c.put("/dav/tok-p01/letter.docx", content=b)) for body in bodies]
    responses, _ = asyncio.run(_gather_posts(None, requests, blocker=blocker))
    assert [r.status_code for r in responses] == [204, 204]
    assert working.read_bytes() in bodies, "working file is not one complete saved body"
    leftovers = [p.name for p in working.parent.iterdir() if p.name != working.name]
    assert leftovers == [], f"temporary files left behind: {leftovers}"


DAV_FIRST_SAVE_HOLD_S = 1.0  # how long the older save sits inside its file replace


async def _staggered_dav_puts(
    first_in_replace: threading.Event, bodies: list[bytes]
) -> list[httpx.Response]:
    """Send ``bodies[0]``; once it is inside its file replace, send the rest, one after another."""
    app = create_app()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        assert (await client.get(HEALTH_URL)).status_code == 200
        loop = asyncio.get_running_loop()
        saves = [asyncio.create_task(client.put("/dav/tok-p01/letter.docx", content=bodies[0]))]
        deadline = loop.time() + SCENARIO_WALL_LIMIT_S
        while not first_in_replace.is_set() and loop.time() < deadline:
            await asyncio.sleep(0.005)
        assert first_in_replace.is_set(), "the first save never reached the working-file replace"
        for body in bodies[1:]:
            saves.append(asyncio.create_task(client.put("/dav/tok-p01/letter.docx", content=body)))
            await asyncio.sleep(0.05)  # each later save arrives strictly after the previous one
        return list(await asyncio.gather(*saves))


def hold_first_dav_replace(env: Env) -> tuple[threading.Event, list[bytes]]:
    """Hold the first PUT inside its file replace; return (that moment's event, bodies as landed)."""
    from app.api import dav as dav_api

    first_in_replace = threading.Event()
    landed: list[bytes] = []
    guard = threading.Lock()
    real_replace = os.replace
    calls = 0

    def replace_first_save_slowly(src: str, dst: str) -> None:
        nonlocal calls
        with guard:
            calls += 1
            is_first = calls == 1
        body = Path(src).read_bytes()
        if is_first:
            first_in_replace.set()
            time.sleep(DAV_FIRST_SAVE_HOLD_S)
        real_replace(src, dst)
        with guard:
            landed.append(body)

    env.mp.setattr(dav_api.os, "replace", replace_first_save_slowly)
    return first_in_replace, landed


def test_overlapping_dav_puts_land_in_arrival_order(env: Env) -> None:
    """Word's newest save must win. The loop used to land overlapping PUTs in arrival order.

    The first save is held inside its file replace for ``DAV_FIRST_SAVE_HOLD_S`` while two newer,
    different bodies arrive behind it. If a newer save is allowed to overtake an older one, the
    older body is written last and silently replaces the user's latest edit. This also passes on
    the pre-P01 source, where the loop itself served the saves one at a time in arrival order.
    """
    working = dav_session(env)
    first_in_replace, landed = hold_first_dav_replace(env)
    bodies = [label * 64 + b" save" for label in (b"A", b"B", b"C")]
    responses = asyncio.run(_staggered_dav_puts(first_in_replace, bodies))
    assert [r.status_code for r in responses] == [204, 204, 204]
    assert landed == bodies, f"saves landed out of arrival order: {[b[:1] for b in landed]}"
    assert working.read_bytes() == bodies[-1], "an older Word save overwrote the newest one"
    leftovers = [p.name for p in working.parent.iterdir() if p.name != working.name]
    assert leftovers == [], f"temporary files left behind: {leftovers}"


def test_dav_put_abandoned_while_waiting_its_turn_writes_nothing_and_frees_the_lane(
    env: Env,
) -> None:
    """A save cancelled before it gets its turn must not write, leak a Session or wedge the saves behind it."""
    working = dav_session(env)
    first_in_replace, landed = hold_first_dav_replace(env)
    bodies = [label * 64 + b" save" for label in (b"A", b"B", b"C")]

    async def scenario() -> list[httpx.Response]:
        app = create_app()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        ) as client:
            assert (await client.get(HEALTH_URL)).status_code == 200
            loop = asyncio.get_running_loop()
            held = asyncio.create_task(client.put("/dav/tok-p01/letter.docx", content=bodies[0]))
            deadline = loop.time() + SCENARIO_WALL_LIMIT_S
            while not first_in_replace.is_set() and loop.time() < deadline:
                await asyncio.sleep(0.005)
            assert first_in_replace.is_set(), "the first save never reached the replace"
            abandoned = asyncio.create_task(
                client.put("/dav/tok-p01/letter.docx", content=bodies[1])
            )
            await asyncio.sleep(0.2)  # it is now queued behind the held save
            abandoned.cancel()
            outcome = (await asyncio.gather(abandoned, return_exceptions=True))[0]
            assert isinstance(outcome, asyncio.CancelledError), outcome
            later = await client.put("/dav/tok-p01/letter.docx", content=bodies[2])
            return [await held, later]

    with stream_leaks_tolerated():  # cancelling mid-request strands ASGI stream objects
        responses = asyncio.run(scenario())
    assert [r.status_code for r in responses] == [204, 204]
    assert landed == [bodies[0], bodies[2]], "the abandoned save was written, or a save was lost"
    assert working.read_bytes() == bodies[2]
    assert [p.name for p in working.parent.iterdir()] == [working.name]
    env.db.rollback()
    assert env.engine.pool.checkedout() == 0  # type: ignore[attr-defined]


def test_failed_dav_put_cleans_up_and_does_not_wedge_later_saves(env: Env) -> None:
    """A save that dies mid-write leaves no temp file, keeps the old content and frees the lane."""
    from app.api import dav as dav_api

    working = dav_session(env)
    real_replace = os.replace
    calls = 0

    def fail_the_first_replace(src: str, dst: str) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OSError("simulated disk failure")
        real_replace(src, dst)

    env.mp.setattr(dav_api.os, "replace", fail_the_first_replace)
    first = [lambda c: c.put("/dav/tok-p01/letter.docx", content=b"doomed save")]
    with stream_leaks_tolerated():  # the app answers 500 mid-request: see the autouse fixture
        responses, _ = asyncio.run(_gather_posts(None, first, blocker=Blocker()))
    assert [r.status_code for r in responses] == [500]
    assert working.read_bytes() == b"original-docx-bytes"
    assert [p.name for p in working.parent.iterdir()] == [working.name]

    second = [lambda c: c.put("/dav/tok-p01/letter.docx", content=b"saved after failure")]
    responses, _ = asyncio.run(_gather_posts(None, second, blocker=Blocker()))
    assert [r.status_code for r in responses] == [204]
    assert working.read_bytes() == b"saved after failure"
    env.db.rollback()
    assert env.engine.pool.checkedout() == 0  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Word save vs Finish / discard ordering (P01 launches 5 and 10)
# ---------------------------------------------------------------------------


def word_book_session(env: Env, *, token: str = "tok-p01") -> tuple[Path, int]:
    """An active Word book session that has already had one save (so Finish is allowed)."""
    working = dav_session(env, token=token)
    row = env.db.query(BookEditSession).filter_by(token=token).one()
    row.last_put_at = datetime(2026, 9, 21, 12, 0, 0)
    env.db.commit()
    assert row.book_id is not None
    return working, row.book_id


def test_finish_waits_for_an_earlier_dav_put_still_in_flight(env: Env) -> None:
    """A save the user made before pressing Finish must be in the finished version.

    The earlier PUT is held inside its file replace while Finish arrives. Finish used to be a
    plain pool route that never looked at in-flight saves, so it built the version from the
    previous working file and then marked the session finished, losing the latest bytes.
    """
    from app.services import word_book_service

    _manager, token = env.make_user("manager")
    _working, book_id = word_book_session(env)
    env.mp.setattr(word_book_service, "convert_docx_to_pdf", lambda _source: None)
    first_in_replace, landed = hold_first_dav_replace(env)
    latest = b"latest-word-save " * 8

    async def scenario() -> tuple[httpx.Response, httpx.Response]:
        app = create_app()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
            cookies={"gssg_session": token},
        ) as client:
            assert (await client.get(HEALTH_URL)).status_code == 200
            loop = asyncio.get_running_loop()
            save = asyncio.create_task(client.put("/dav/tok-p01/letter.docx", content=latest))
            deadline = loop.time() + SCENARIO_WALL_LIMIT_S
            while not first_in_replace.is_set() and loop.time() < deadline:
                await asyncio.sleep(0.005)
            assert first_in_replace.is_set(), "the save never reached the working-file replace"
            finish = asyncio.create_task(
                client.post(f"/api/v1/books/{book_id}/word-sessions/finish")
            )
            await asyncio.sleep(0.2)  # Finish has arrived strictly after the save
            return await save, await finish

    save_response, finish_response = asyncio.run(scenario())
    assert save_response.status_code == 204, save_response.text
    assert finish_response.status_code == 200, finish_response.text
    assert landed == [latest]
    env.db.rollback()
    document = env.db.query(Document).filter_by(ref_number="B-P01").one()
    assert Path(document.docx_path).read_bytes() == latest, "Finish lost the latest Word save"
    env.db.rollback()
    assert env.engine.pool.checkedout() == 0  # type: ignore[attr-defined]


async def _save_then(
    token: str,
    filename: str,
    latest: bytes,
    first_in_replace: threading.Event,
    follow: Callable[[httpx.AsyncClient], Awaitable[httpx.Response]],
    *,
    cookie: str | None = None,
    cancel_follow_after: float | None = None,
) -> tuple[httpx.Response, httpx.Response | None]:
    """Hold a save inside its replace, send ``follow`` strictly after it, return both outcomes.

    With ``cancel_follow_after`` the follow-up request is cancelled that long after it arrived
    and ``None`` stands in for its response.
    """
    app = create_app()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
        cookies={"gssg_session": cookie} if cookie else None,
    ) as client:
        assert (await client.get(HEALTH_URL)).status_code == 200
        loop = asyncio.get_running_loop()
        save = asyncio.create_task(client.put(f"/dav/{token}/{filename}", content=latest))
        deadline = loop.time() + SCENARIO_WALL_LIMIT_S
        while not first_in_replace.is_set() and loop.time() < deadline:
            await asyncio.sleep(0.005)
        assert first_in_replace.is_set(), "the save never reached the working-file replace"
        later = asyncio.create_task(follow(client))
        await asyncio.sleep(0.2 if cancel_follow_after is None else cancel_follow_after)
        if cancel_follow_after is not None:
            later.cancel()
            outcome = (await asyncio.gather(later, return_exceptions=True))[0]
            assert isinstance(outcome, asyncio.CancelledError), outcome
            return await save, None
        return await save, await later


def template_word_session(env: Env, owner: User, *, token: str = "tok-tpl") -> Path:
    """An active template-authoring session that has already had one save."""
    working = env.data_dir / "word_sessions" / "tpl-p01" / "Letterhead.docx"
    working.parent.mkdir(parents=True, exist_ok=True)
    working.write_bytes(b"original-docx-bytes")
    env.db.add(
        BookEditSession(
            book_id=None,
            user_id=owner.id,
            template_name="Letterhead.docx",
            token=token,
            working_path=str(working),
            state="active",
            last_put_at=datetime(2026, 9, 21, 12, 0, 0),
        )
    )
    env.db.commit()
    return working


def fake_template_install(env: Env) -> list[bytes]:
    """Stand in for template validation/install; records the working bytes it was handed."""
    from app.services import book_template_service

    installed: list[bytes] = []

    def install(src: Path, *, name: str, submitter_g: str | None) -> Any:
        installed.append(Path(src).read_bytes())
        return book_template_service.TemplateInfo(name=name, modified_at=datetime(2026, 9, 21))

    env.mp.setattr(book_template_service, "_install_template", install)
    return installed


def test_template_finish_waits_for_an_earlier_dav_put_still_in_flight(env: Env) -> None:
    manager, token = env.make_user("manager")
    template_word_session(env, manager)
    installed = fake_template_install(env)
    first_in_replace, _landed = hold_first_dav_replace(env)
    latest = b"latest-template-save " * 8
    session_id = env.db.query(BookEditSession).filter_by(token="tok-tpl").one().id
    save, finish = asyncio.run(
        _save_then(
            "tok-tpl",
            "Letterhead.docx",
            latest,
            first_in_replace,
            lambda c: c.post(f"/api/v1/books/word-templates/sessions/{session_id}/finish"),
            cookie=token,
        )
    )
    assert save.status_code == 204, save.text
    assert finish is not None and finish.status_code == 201, finish and finish.text
    assert installed == [latest], "template Finish installed an older Word save"


def test_template_discard_waits_for_an_earlier_dav_put_and_leaves_no_file(env: Env) -> None:
    manager, token = env.make_user("manager")
    working = template_word_session(env, manager)
    first_in_replace, _landed = hold_first_dav_replace(env)
    session_id = env.db.query(BookEditSession).filter_by(token="tok-tpl").one().id
    save, discard = asyncio.run(
        _save_then(
            "tok-tpl",
            "Letterhead.docx",
            b"latest-template-save " * 8,
            first_in_replace,
            lambda c: c.delete(f"/api/v1/books/word-templates/sessions/{session_id}"),
            cookie=token,
        )
    )
    assert save.status_code == 204, save.text
    assert discard is not None and discard.status_code == 204, discard and discard.text
    assert not working.exists(), "a save landed after discard and resurrected the working file"
    assert not working.parent.exists()


def test_book_discard_waits_for_an_earlier_dav_put_and_leaves_no_file(env: Env) -> None:
    _manager, token = env.make_user("manager")
    working, book_id = word_book_session(env)
    first_in_replace, _landed = hold_first_dav_replace(env)
    save, discard = asyncio.run(
        _save_then(
            "tok-p01",
            "letter.docx",
            b"latest-word-save " * 8,
            first_in_replace,
            lambda c: c.delete(f"/api/v1/books/{book_id}/word-sessions"),
            cookie=token,
        )
    )
    assert save.status_code == 204, save.text
    assert discard is not None and discard.status_code == 200, discard and discard.text
    assert not working.exists(), "a save landed after discard and resurrected the working file"
    env.db.rollback()
    assert env.engine.pool.checkedout() == 0  # type: ignore[attr-defined]


def test_finish_abandoned_while_queued_behind_a_save_never_runs(env: Env) -> None:
    """A Finish cancelled before its turn must not finalize; the retry then sees the latest save."""
    from app.services import word_book_service

    _manager, token = env.make_user("manager")
    _working, book_id = word_book_session(env)
    env.mp.setattr(word_book_service, "convert_docx_to_pdf", lambda _source: None)
    first_in_replace, _landed = hold_first_dav_replace(env)
    latest = b"latest-word-save " * 8

    async def scenario() -> tuple[httpx.Response, httpx.Response]:
        save_task: asyncio.Task[tuple[httpx.Response, httpx.Response | None]] = asyncio.create_task(
            _save_then(
                "tok-p01",
                "letter.docx",
                latest,
                first_in_replace,
                lambda c: c.post(f"/api/v1/books/{book_id}/word-sessions/finish"),
                cookie=token,
                cancel_follow_after=0.2,
            )
        )
        save, _ = await save_task
        app = create_app()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
            cookies={"gssg_session": token},
        ) as client:
            return save, await client.post(f"/api/v1/books/{book_id}/word-sessions/finish")

    with stream_leaks_tolerated():
        save, retry = asyncio.run(scenario())
    assert save.status_code == 204, save.text
    assert retry.status_code == 200, retry.text
    # Before any query of the test's own session: the cancelled Finish leaked no connection.
    assert env.engine.pool.checkedout() == 0  # type: ignore[attr-defined]
    env.db.rollback()
    documents = env.db.query(Document).filter_by(ref_number="B-P01").all()
    assert [Path(d.docx_path).read_bytes() for d in documents] == [latest]
    env.db.rollback()  # the test's own session holds a connection after the query above
    assert env.engine.pool.checkedout() == 0  # type: ignore[attr-defined]


def test_dav_put_cancelled_while_running_still_lands_and_frees_its_session(env: Env) -> None:
    """A save cancelled mid-write is not abandoned: its thread finishes before the turn is released."""
    working = dav_session(env)
    first_in_replace, landed = hold_first_dav_replace(env)
    bodies = [b"A" * 64 + b" save", b"B" * 64 + b" save"]

    async def scenario() -> httpx.Response:
        app = create_app()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        ) as client:
            assert (await client.get(HEALTH_URL)).status_code == 200
            loop = asyncio.get_running_loop()
            running = asyncio.create_task(client.put("/dav/tok-p01/letter.docx", content=bodies[0]))
            deadline = loop.time() + SCENARIO_WALL_LIMIT_S
            while not first_in_replace.is_set() and loop.time() < deadline:
                await asyncio.sleep(0.005)
            assert first_in_replace.is_set()
            running.cancel()
            await asyncio.gather(running, return_exceptions=True)
            return await client.put("/dav/tok-p01/letter.docx", content=bodies[1])

    with stream_leaks_tolerated():
        later = asyncio.run(scenario())
    assert later.status_code == 204
    assert landed == bodies, "the cancelled save did not finish before the next one started"
    assert working.read_bytes() == bodies[1]
    assert [p.name for p in working.parent.iterdir()] == [working.name]
    env.db.rollback()
    assert env.engine.pool.checkedout() == 0  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# A save queued in the global lane vs Finish / discard; per-session turns (P01 launch 10)
#
# A DAV PUT keeps its place in the global exclusive lane: with the lane held by a mail /
# announcement job that owns SQLite's write lock, a PUT taken out of the lane would replace the
# Word file and then fail with "database is locked" (500 after the replace). On top of the
# lane a PUT takes a per-session turn, so Finish / discard of that session wait for it, while
# other sessions' Finish / discard never wait for it and never take the lane.
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lane_held(blocker: Blocker) -> AsyncIterator[None]:
    """Occupy the global exclusive lane with ``blocker`` for the body of the ``async with``."""
    from app.api._offload import run_exclusive

    occupant = asyncio.create_task(run_exclusive(blocker.block))
    try:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + SCENARIO_WALL_LIMIT_S
        while not blocker.entered.is_set() and loop.time() < deadline:
            await asyncio.sleep(0.005)
        assert blocker.entered.is_set(), "the lane occupant never started"
        yield
    finally:
        blocker.release.set()
        await occupant


async def save_queued_in_lane() -> None:
    """Wait until a request is parked in the global lane's wait queue, not merely sent."""
    from app.api._offload import _exclusive_lane

    loop = asyncio.get_running_loop()
    deadline = loop.time() + SCENARIO_WALL_LIMIT_S
    while _exclusive_lane().statistics().tasks_waiting < 1 and loop.time() < deadline:
        await asyncio.sleep(0.005)
    assert _exclusive_lane().statistics().tasks_waiting >= 1, "the save never queued in the lane"


async def _save_queued_in_lane_then(
    token: str,
    filename: str,
    latest: bytes,
    follow: Callable[[httpx.AsyncClient], Awaitable[httpx.Response]],
    *,
    cookie: str,
) -> tuple[httpx.Response, httpx.Response, bool]:
    """Queue a save in the lane behind a busy occupant, then send ``follow`` strictly after it.

    Returns both responses and whether, 0.3 s after ``follow`` arrived and while the lane was
    still held, neither request had finished: ``follow`` waits for the earlier save instead of
    overtaking it.
    """
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app(), raise_app_exceptions=False),
        base_url="http://test",
        cookies={"gssg_session": cookie},
    ) as client:
        assert (await client.get(HEALTH_URL)).status_code == 200
        async with lane_held(Blocker()):
            save = asyncio.create_task(client.put(f"/dav/{token}/{filename}", content=latest))
            await save_queued_in_lane()  # the save waits in the lane behind the occupant
            later = asyncio.create_task(follow(client))
            await asyncio.sleep(0.3)  # ``follow`` has arrived strictly after the save
            waiting = not save.done() and not later.done()
        return await save, await later, waiting


def test_finish_waits_for_a_save_still_queued_in_the_lane(env: Env) -> None:
    """A save the user made before pressing Finish must be in the finished version, even when
    that save has not yet left the global lane."""
    from app.services import word_book_service

    _manager, token = env.make_user("manager")
    _working, book_id = word_book_session(env)
    env.mp.setattr(word_book_service, "convert_docx_to_pdf", lambda _source: None)
    latest = b"latest-word-save " * 8
    save, finish, waiting = asyncio.run(
        _save_queued_in_lane_then(
            "tok-p01",
            "letter.docx",
            latest,
            lambda c: c.post(f"/api/v1/books/{book_id}/word-sessions/finish"),
            cookie=token,
        )
    )
    assert waiting, "Finish overtook an earlier save that was still queued in the lane"
    assert save.status_code == 204, save.text
    assert finish.status_code == 200, finish.text
    env.db.rollback()
    document = env.db.query(Document).filter_by(ref_number="B-P01").one()
    assert Path(document.docx_path).read_bytes() == latest, "Finish lost the latest Word save"
    env.db.rollback()
    assert env.engine.pool.checkedout() == 0  # type: ignore[attr-defined]


def test_book_discard_waits_for_a_save_still_queued_in_the_lane_and_leaves_no_file(
    env: Env,
) -> None:
    _manager, token = env.make_user("manager")
    working, book_id = word_book_session(env)
    save, discard, waiting = asyncio.run(
        _save_queued_in_lane_then(
            "tok-p01",
            "letter.docx",
            b"latest-word-save " * 8,
            lambda c: c.delete(f"/api/v1/books/{book_id}/word-sessions"),
            cookie=token,
        )
    )
    assert waiting, "discard overtook an earlier save that was still queued in the lane"
    assert save.status_code == 204, save.text
    assert discard.status_code == 200, discard.text
    assert not working.exists(), "a queued save landed after discard and resurrected the file"
    env.db.rollback()
    assert env.engine.pool.checkedout() == 0  # type: ignore[attr-defined]


def test_template_finish_waits_for_a_save_still_queued_in_the_lane(env: Env) -> None:
    manager, token = env.make_user("manager")
    template_word_session(env, manager)
    installed = fake_template_install(env)
    latest = b"latest-template-save " * 8
    session_id = env.db.query(BookEditSession).filter_by(token="tok-tpl").one().id
    env.db.rollback()
    save, finish, waiting = asyncio.run(
        _save_queued_in_lane_then(
            "tok-tpl",
            "Letterhead.docx",
            latest,
            lambda c: c.post(f"/api/v1/books/word-templates/sessions/{session_id}/finish"),
            cookie=token,
        )
    )
    assert waiting, "template Finish overtook an earlier save that was still queued in the lane"
    assert save.status_code == 204, save.text
    assert finish.status_code == 201, finish.text
    assert installed == [latest], "template Finish installed an older Word save"


def test_template_discard_waits_for_a_save_still_queued_in_the_lane_and_leaves_no_file(
    env: Env,
) -> None:
    manager, token = env.make_user("manager")
    working = template_word_session(env, manager)
    session_id = env.db.query(BookEditSession).filter_by(token="tok-tpl").one().id
    env.db.rollback()
    save, discard, waiting = asyncio.run(
        _save_queued_in_lane_then(
            "tok-tpl",
            "Letterhead.docx",
            b"latest-template-save " * 8,
            lambda c: c.delete(f"/api/v1/books/word-templates/sessions/{session_id}"),
            cookie=token,
        )
    )
    assert waiting, "template discard overtook an earlier save that was still queued in the lane"
    assert save.status_code == 204, save.text
    assert discard.status_code == 204, discard.text
    assert not working.exists(), "a queued save landed after discard and resurrected the file"
    assert not working.parent.exists()


def test_finalizing_one_session_does_not_wait_for_another_sessions_queued_save(env: Env) -> None:
    """Turns are per session; only the lane orders saves across sessions.

    Session A's save sits in the lane behind a busy occupant. Discarding the unrelated template
    session B (own token, own working directory) must neither wait for that save nor take the
    lane, and A's save must not have started: it keeps its place behind the occupant.
    """
    manager, token = env.make_user("manager")
    a_file = dav_session(env, token="tok-a", name="a.docx")
    b_file = template_word_session(env, manager)
    b_id = env.db.query(BookEditSession).filter_by(token="tok-tpl").one().id
    env.db.rollback()

    async def scenario() -> tuple[httpx.Response, httpx.Response, bytes, bool]:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=create_app(), raise_app_exceptions=False),
            base_url="http://test",
            cookies={"gssg_session": token},
        ) as client:
            assert (await client.get(HEALTH_URL)).status_code == 200
            async with lane_held(Blocker()):
                save = asyncio.create_task(client.put("/dav/tok-a/a.docx", content=b"save for a"))
                await save_queued_in_lane()  # A's save waits in the lane behind the occupant
                discard = await asyncio.wait_for(
                    client.delete(f"/api/v1/books/word-templates/sessions/{b_id}"),
                    timeout=BLOCK_CAP_S / 2,
                )
                queued = not save.done()
                untouched = a_file.read_bytes()
            return await save, discard, untouched, queued

    with stream_leaks_tolerated():  # a timeout would cancel the discard mid-request
        saved, discard, untouched, queued = asyncio.run(scenario())
    assert discard.status_code == 204, discard.text
    assert not b_file.exists()
    assert queued, "session A's save left the lane before its occupant finished"
    assert untouched == b"original-docx-bytes"
    assert saved.status_code == 204, saved.text
    assert a_file.read_bytes() == b"save for a"


LANE_WRITE_LOCK_HOLD_S = 8.0  # the owner's reproduction: longer than SQLite's 5 s busy timeout


def _hold_write_lock(
    engine: Engine, holding: threading.Event, release: threading.Event, cap: float
) -> None:
    """A lane job that owns SQLite's write lock for as long as it is told to (a network call)."""
    raw = engine.raw_connection()
    try:
        cursor = raw.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        holding.set()
        release.wait(cap)
        raw.rollback()
        cursor.close()
    finally:
        raw.close()


def test_dav_put_queued_behind_a_long_lane_write_lock_is_saved_not_failed(env: Env) -> None:
    """A save that waits for a lane job holding the write lock longer than the busy timeout.

    Out of the lane (the launch-5 candidate) the PUT replaced the Word file at once, waited the
    5 s busy timeout for ``record_put`` and answered 500 *after* the replace. In the lane it must
    not start before the occupant ends, then answer 204 with the file replaced and the save
    recorded.
    """
    from app.api._offload import run_exclusive

    working = dav_session(env)
    holding, release = threading.Event(), threading.Event()
    latest = b"saved by word during lane job"

    async def scenario() -> tuple[httpx.Response, bytes, bool]:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=create_app(), raise_app_exceptions=False),
            base_url="http://test",
        ) as client:
            assert (await client.get(HEALTH_URL)).status_code == 200
            loop = asyncio.get_running_loop()
            occupant = asyncio.create_task(
                run_exclusive(
                    _hold_write_lock, env.engine, holding, release, LANE_WRITE_LOCK_HOLD_S + 10
                )
            )
            try:
                deadline = loop.time() + SCENARIO_WALL_LIMIT_S
                while not holding.is_set() and loop.time() < deadline:
                    await asyncio.sleep(0.005)
                assert holding.is_set(), "the lane job never took the write lock"
                save = asyncio.create_task(client.put("/dav/tok-p01/letter.docx", content=latest))
                await asyncio.sleep(LANE_WRITE_LOCK_HOLD_S)
                queued = not save.done()  # no 500 after the busy timeout: it never started
                untouched = working.read_bytes()
                assert (await client.get(HEALTH_URL)).status_code == 200
            finally:
                release.set()
                await occupant
            return await save, untouched, queued

    response, untouched, queued = asyncio.run(scenario())
    assert queued, "the save answered while the lane job still held the write lock"
    assert untouched == b"original-docx-bytes", "the save replaced the file before its lane turn"
    assert response.status_code == 204, response.text
    assert working.read_bytes() == latest
    assert [p.name for p in working.parent.iterdir()] == [working.name]
    env.db.rollback()
    row = env.db.query(BookEditSession).filter_by(token="tok-p01").one()
    assert row.last_put_at is not None, "the save landed but was never recorded"
    env.db.rollback()
    assert env.engine.pool.checkedout() == 0  # type: ignore[attr-defined]


def test_session_turn_is_first_come_first_served_per_token_and_leaves_no_entry() -> None:
    from app.api import _word_session_order as order

    async def scenario() -> tuple[list[str], list[str], list[object], dict[str, object]]:
        events: list[str] = []
        gate = asyncio.Event()

        async def member(name: str, token: str | None, *, hold: bool = False) -> None:
            async with order.session_turn(token):
                events.append(f"{name}:in")
                if hold:
                    await gate.wait()
                events.append(f"{name}:out")

        first = asyncio.create_task(member("a1", "A", hold=True))
        await asyncio.sleep(0.01)
        queued = asyncio.create_task(member("a2", "A"))
        abandoned = asyncio.create_task(member("a3", "A"))
        other = asyncio.create_task(member("b", "B"))
        untokened = asyncio.create_task(member("n", None))
        await asyncio.sleep(0.05)
        abandoned.cancel()
        await asyncio.sleep(0.01)
        while_held = list(events)
        gate.set()
        results = await asyncio.gather(
            first, queued, abandoned, other, untokened, return_exceptions=True
        )
        return while_held, events, results, dict(order._registry())

    while_held, events, results, registry = asyncio.run(scenario())
    # B and the token-less member never wait for A; A's followers wait for A's first member.
    assert while_held[0] == "a1:in"
    assert sorted(while_held[1:]) == ["b:in", "b:out", "n:in", "n:out"]
    # The abandoned waiter never ran; the queued one ran after the first, in arrival order.
    assert events[5:] == ["a1:out", "a2:in", "a2:out"]
    assert isinstance(results[2], asyncio.CancelledError)
    assert [r for i, r in enumerate(results) if i != 2] == [None, None, None, None]
    assert registry == {}, "a finished turn left its token in the registry"


def test_run_in_session_order_works_off_the_loop_one_session_at_a_time() -> None:
    from app.api import _word_session_order as order

    guard = threading.Lock()
    running = {"a": 0, "b": 0}
    most = {"a": 0, "b": 0}
    threads: list[int] = []

    def work(name: str) -> str:
        key = name[0]
        with guard:
            running[key] += 1
            most[key] = max(most[key], running[key])
            threads.append(threading.get_ident())
        time.sleep(0.05)
        with guard:
            running[key] -= 1
        return name

    async def scenario() -> tuple[int, list[str]]:
        names = await asyncio.gather(
            order.run_in_session_order("A", work, "a1"),
            order.run_in_session_order("A", work, "a2"),
            order.run_in_session_order("A", work, "a3"),
            order.run_in_session_order("B", work, "b1"),
            order.run_in_session_order("B", work, "b2"),
            order.run_in_session_order(None, work, "b3"),
        )
        return threading.get_ident(), list(names)

    loop_thread, names = asyncio.run(scenario())
    assert names == ["a1", "a2", "a3", "b1", "b2", "b3"]
    assert loop_thread not in threads, "session work ran on the event-loop thread"
    assert most["a"] == 1, "two saves / finals of one session ran at the same time"


# ---------------------------------------------------------------------------
# Static guard: no async route handler runs blocking calls inline (Q06 gate G3)
# ---------------------------------------------------------------------------

API_ROOT = Path(__file__).resolve().parents[1] / "app" / "api"
OFFLOADERS = {"run_exclusive", "run_in_threadpool", "run_sync", "to_thread"}
ROUTE_VERBS = {"get", "post", "put", "patch", "delete", "api_route"}
BLOCKING_ROOT_NAMES = {"db", "session", "notify_dispatch", "openwa_client"}

#: Benign lightweight calls: the SSE route only reads its bind and releases the
#: request-scoped connection before the endless stream starts; its per-tick counts query
#: is already offloaded (``anyio.to_thread.run_sync``).
ALLOWED_INLINE: frozenset[tuple[str, str, str]] = frozenset(
    {
        ("v1/notifications.py", "stream", "db.get_bind"),
        ("v1/notifications.py", "stream", "db.close"),
    }
)


def _dotted(node: ast.AST) -> list[str]:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return list(reversed(parts))


def _is_route_handler(node: ast.AsyncFunctionDef) -> bool:
    for decorator in node.decorator_list:
        target = decorator.func if isinstance(decorator, ast.Call) else decorator
        dotted = _dotted(target)
        if len(dotted) >= 2 and dotted[-1] in ROUTE_VERBS:
            return True
    return False


def _db_helper_names(tree: ast.Module) -> set[str]:
    """Module-level sync helpers that take a ``db``/``session`` argument (they query it)."""
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            args = [a.arg for a in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs)]
            if "db" in args or "session" in args:
                names.add(node.name)
    return names


class _InlineBlockingFinder(ast.NodeVisitor):
    """Collect calls an ``async`` handler makes on the loop thread without offloading them.

    Skipped on purpose: awaited calls (``await upload.read()``, ``await run_exclusive(...)``),
    and the bodies of nested ``def``/``lambda`` (they run only when handed to an offloader).
    A nested function that is *called* directly is flagged by name.
    """

    def __init__(self, db_helpers: set[str], nested: set[str]) -> None:
        self.db_helpers = db_helpers
        self.nested = nested
        self.found: list[tuple[int, str]] = []
        self._awaited: set[int] = set()

    def visit_Await(self, node: ast.Await) -> None:
        if isinstance(node.value, ast.Call):
            self._awaited.add(id(node.value))
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        return

    def visit_Lambda(self, node: ast.Lambda) -> None:
        return

    def visit_Call(self, node: ast.Call) -> None:
        dotted = _dotted(node.func)
        if dotted and id(node) not in self._awaited:
            root = dotted[0]
            if (
                root.endswith(("_service", "_repo"))
                or root in BLOCKING_ROOT_NAMES
                or (len(dotted) == 1 and (root in self.db_helpers or root in self.nested))
            ):
                self.found.append((node.lineno, ".".join(dotted)))
        self.generic_visit(node)


def find_inline_blocking(tree: ast.Module) -> dict[str, list[tuple[int, str]]]:
    """``{handler: [(line, call), ...]}`` for every async route handler with inline blocking calls."""
    helpers = _db_helper_names(tree)
    result: dict[str, list[tuple[int, str]]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and _is_route_handler(node):
            nested = {n.name for n in ast.walk(node) if isinstance(n, ast.FunctionDef)}
            finder = _InlineBlockingFinder(helpers, nested)
            for statement in node.body:
                finder.visit(statement)
            result[node.name] = finder.found
    return result


def inline_blocking_calls() -> list[str]:
    violations: list[str] = []
    for path in sorted(API_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        relative = path.relative_to(API_ROOT).as_posix()
        for handler, calls in find_inline_blocking(tree).items():
            for line, name in calls:
                if (relative, handler, name) not in ALLOWED_INLINE:
                    violations.append(f"{relative}:{line} {handler}() calls {name}() inline")
    return violations


def test_no_async_route_handler_runs_blocking_calls_inline() -> None:
    violations = inline_blocking_calls()
    assert violations == [], (
        "async route handlers call synchronous service/DB code on the event loop; "
        "offload via run_exclusive / run_in_threadpool or make the handler a plain def:\n  "
        + "\n  ".join(violations)
    )


def test_ast_guard_sees_the_known_blocking_shapes() -> None:
    """The guard itself must flag the real bug pattern (it is not vacuously empty)."""
    source = (
        "from fastapi import APIRouter\n"
        "router = APIRouter()\n"
        "def _load(db, ident):\n    return db.get(object, ident)\n"
        "@router.post('/inline')\n"
        "async def handler(db, upload):\n"
        "    data = await upload.read()\n"
        "    row = _load(db, 1)\n"
        "    return thing_service.save(db, data)\n"
        "@router.post('/offloaded')\n"
        "async def offloaded(db, upload):\n"
        "    data = await upload.read()\n"
        "    def work():\n"
        "        return thing_service.save(db, data)\n"
        "    return await run_exclusive(work)\n"
        "@router.post('/nested-called-inline')\n"
        "async def sneaky(db):\n"
        "    def work():\n"
        "        return thing_service.save(db, b'')\n"
        "    return work()\n"
    )
    found = {
        handler: [name for _line, name in calls]
        for handler, calls in find_inline_blocking(ast.parse(source)).items()
    }
    assert found == {
        "handler": ["_load", "thing_service.save"],
        "offloaded": [],
        "sneaky": ["work"],
    }
