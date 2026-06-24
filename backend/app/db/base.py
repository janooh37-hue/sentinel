"""Declarative base shared by every model.

Kept separate from ``session.py`` so Alembic's ``env.py`` can import the
metadata without instantiating an engine.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Root declarative class — every model in ``app.db.models`` extends this."""
