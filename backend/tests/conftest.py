# backend/tests/conftest.py
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import session as session_mod
from app.db.models import Base, User
from app.db.session import attach_sqlite_pragmas
from app.services import perm_service


@pytest.fixture()
def db_session(monkeypatch) -> Session:
    # A single shared in-memory connection so the schema survives across calls.
    eng = create_engine("sqlite://", future=True)
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    # Point app code (services) at this engine/session factory.
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()


def make_user(db: Session, *, role="operator", status="active", email="u@x.ae") -> User:
    u = User(email=email, password_hash="x", role=role, status=status)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u
