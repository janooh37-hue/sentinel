"""Pragmas applied to file-backed (production) SQLite engines.

The WAL branch of ``attach_sqlite_pragmas`` carries the durability/latency
tuning for the live database. In-memory test engines (``wal=False``) stay
minimal so the suite remains hermetic; these tests pin the production branch.
"""

from __future__ import annotations

from sqlalchemy import create_engine

from app.db.session import attach_sqlite_pragmas


def _pragma(conn, name: str):
    return conn.exec_driver_sql(f"PRAGMA {name}").scalar()


def test_file_backed_engine_gets_wal_and_latency_pragmas(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path}/gssg.db", future=True)
    attach_sqlite_pragmas(eng, wal=True)

    with eng.connect() as conn:
        assert _pragma(conn, "journal_mode") == "wal"
        # NORMAL (1): with WAL, durability survives a process crash; only an
        # OS/power loss can drop the last transaction. FULL would fsync twice
        # per commit — the dominant write-latency cost on this host.
        assert _pragma(conn, "synchronous") == 1
        assert _pragma(conn, "foreign_keys") == 1
        assert _pragma(conn, "busy_timeout") == 5000
        # temp_store MEMORY (2): sorts/temp tables for dashboard and search
        # queries never touch disk.
        assert _pragma(conn, "temp_store") == 2
        # Negative cache_size = KiB: 64 MB page cache.
        assert _pragma(conn, "cache_size") == -64000
        # mmap I/O for reads on the (SSD-backed) live DB file.
        assert _pragma(conn, "mmap_size") == 268435456


def test_in_memory_engine_stays_minimal():
    eng = create_engine("sqlite://", future=True)
    attach_sqlite_pragmas(eng, wal=False)

    with eng.connect() as conn:
        assert _pragma(conn, "foreign_keys") == 1
        # No WAL on a transient in-memory DB.
        assert _pragma(conn, "journal_mode") == "memory"
