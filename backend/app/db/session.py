"""Engine, session factory, and FastAPI dependency.

The engine defaults to ``sqlite:///<settings.db_path>`` but can be rebound at
runtime via :func:`init_engine` — tests use that to swap in an in-memory DB
without touching the on-disk file.

WAL mode is enabled on every SQLite connection so concurrent reads don't block
writes. The pragma is idempotent — repeated calls are cheap.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings


def _sqlite_url_for(path_str: str) -> str:
    # SQLAlchemy expects ``sqlite:///`` for relative or absolute file paths.
    # Pathlib paths render with backslashes on Windows; SQLAlchemy is happy
    # with either separator, but normalise to forward slashes for portability.
    return f"sqlite:///{path_str.replace(chr(92), '/')}"


def attach_sqlite_pragmas(eng: Engine, *, wal: bool = True) -> None:
    """Register a ``connect`` listener that enables FKs (and optionally WAL).

    Reused by tests so a raw ``create_engine`` call behaves the same as the
    production engine.
    """

    @event.listens_for(eng, "connect")
    def _set_sqlite_pragmas(dbapi_connection: Any, _: Any) -> None:
        cursor = dbapi_connection.cursor()
        if wal:
            cursor.execute("PRAGMA journal_mode=WAL")
            # Without busy_timeout, a concurrent writer (e.g. background email
            # sync) racing the HTTP request thread fails immediately with
            # "database is locked". 5s is plenty for the short writes we do.
            cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def _build_engine(url: str | None = None) -> Engine:
    if url is None:
        settings = get_settings()
        url = _sqlite_url_for(str(settings.db_path))

    is_memory = url.endswith(":memory:") or "mode=memory" in url
    connect_args: dict[str, Any] = {"check_same_thread": False}

    eng = create_engine(
        url,
        connect_args=connect_args,
        future=True,
        # In-memory DBs lose state across connections — pin to a single one
        # so the schema survives between calls.
        poolclass=None,
    )
    attach_sqlite_pragmas(eng, wal=not is_memory)
    return eng


engine: Engine = _build_engine()
SessionLocal: sessionmaker[Session] = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
)


def init_engine(url: str) -> Engine:
    """Rebind the module-level engine and SessionLocal to a new URL.

    Tests call this with ``sqlite+pysqlite:///:memory:`` (or a per-test file)
    before importing app code that depends on ``engine``/``SessionLocal``.
    """
    global engine, SessionLocal
    engine = _build_engine(url)
    SessionLocal = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False, future=True
    )
    return engine


def get_db() -> Iterator[Session]:
    """FastAPI dependency — yields a session and closes it on exit."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
