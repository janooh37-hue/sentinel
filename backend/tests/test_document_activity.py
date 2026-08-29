from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Book, BookCategory, BookVersion, User
from app.db.session import get_db
from app.main import create_app
from app.services import book_service

DUBAI = ZoneInfo("Asia/Dubai")
NOW_LOCAL = datetime(2026, 8, 26, 12, tzinfo=DUBAI)
NOW_UTC_NAIVE = NOW_LOCAL.astimezone(UTC).replace(tzinfo=None)


class FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):  # type: ignore[no-untyped-def]
        if tz is None:
            return NOW_LOCAL.replace(tzinfo=None)
        return NOW_LOCAL.astimezone(tz)


def _seed_versions(db: Session) -> tuple[User, User]:
    current_user = User(
        email="activity-user@example.test",
        password_hash="x",
        role="operator",
        status="active",
    )
    other_user = User(
        email="other-activity-user@example.test",
        password_hash="x",
        role="operator",
        status="active",
    )
    db.add_all([current_user, other_user, BookCategory(id="HR", prefix="HR")])
    db.flush()
    book = Book(category_id="HR", ref_number="HR-1")
    db.add(book)
    db.flush()
    db.add_all(
        [
            BookVersion(
                book_id=book.id,
                version_no=1,
                created_by_user_id=current_user.id,
                created_at=NOW_UTC_NAIVE - timedelta(hours=1),
            ),
            BookVersion(
                book_id=book.id,
                version_no=2,
                created_by_user_id=current_user.id,
                created_at=NOW_UTC_NAIVE - timedelta(days=2),
            ),
            BookVersion(
                book_id=book.id,
                version_no=3,
                created_by_user_id=current_user.id,
                created_at=NOW_UTC_NAIVE - timedelta(days=30),
            ),
            BookVersion(
                book_id=book.id,
                version_no=4,
                created_by_user_id=other_user.id,
                created_at=NOW_UTC_NAIVE - timedelta(minutes=30),
            ),
        ]
    )
    db.commit()
    return current_user, other_user


def test_my_document_activity_counts_only_callers_dubai_day_and_week(
    api_db: Session,
    monkeypatch,
) -> None:
    current_user, _ = _seed_versions(api_db)
    monkeypatch.setattr(book_service, "datetime", FrozenDateTime)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: current_user

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/v1/documents/activity/me")

    assert response.status_code == 200
    assert response.json() == {"documents_today": 1, "documents_week": 2}


def test_my_document_activity_requires_authentication(api_db: Session) -> None:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/v1/documents/activity/me")

    assert response.status_code == 401
