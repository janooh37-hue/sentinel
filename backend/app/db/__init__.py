"""SQLAlchemy 2.x persistence layer.

Public surface:
    Base           — declarative base for all models
    engine         — module-level engine (use ``init_engine`` to override in tests)
    SessionLocal   — sessionmaker bound to ``engine``
    get_db         — FastAPI dependency yielding a request-scoped session
    init_engine    — rebind engine + SessionLocal (used in tests)
"""

from __future__ import annotations

from app.db.base import Base
from app.db.session import (
    SessionLocal,
    attach_sqlite_pragmas,
    engine,
    get_db,
    init_engine,
)

__all__ = [
    "Base",
    "SessionLocal",
    "attach_sqlite_pragmas",
    "engine",
    "get_db",
    "init_engine",
]
