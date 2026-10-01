"""GET /api/v1/leaves/awaiting-return/count — the bell's leave badge.

It must equal the number of register rows the Leaves page shows as
AwaitingReturn (lifecycle.ts ``displayState``), without shipping the register.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Employee, Leave
from app.db.session import get_db
from app.main import create_app
from tests.conftest import make_user


def _leave(
    db: Session,
    n: int,
    leave_type: str,
    status: str,
    end: date,
    *,
    certificate_path: str | None = None,
    deleted: bool = False,
) -> None:
    db.add(
        Leave(
            employee_id="E1",
            leave_type=leave_type,
            start_date=end - timedelta(days=n),  # distinct natural keys
            end_date=end,
            status=status,
            certificate_path=certificate_path,
            deleted_at=datetime(2026, 1, 1) if deleted else None,
        )
    )


def test_counts_exactly_the_rows_awaiting_a_return(api_db: Session) -> None:
    today = datetime.now(ZoneInfo("Asia/Dubai")).date()  # the register's calendar
    past = today - timedelta(days=1)
    api_db.add(Employee(id="E1", name_en="Test Person"))
    # Awaiting a return:
    _leave(api_db, 1, "Annual Leave", "Approved", past)
    _leave(api_db, 2, "Annual Leave", "Generated - تم الإنشاء", past)  # legacy alias
    _leave(api_db, 3, "National Service", "Pending", past, certificate_path="c.pdf")
    # Not awaiting a return:
    _leave(api_db, 4, "Annual Leave", "Approved", today)  # last day not over yet
    _leave(api_db, 5, "Annual Leave", "Pending", past)  # still a request
    _leave(api_db, 6, "Compassionate Leave", "Approved", past)  # not returnable
    _leave(api_db, 7, "Sick Leave", "Approved", past)
    _leave(api_db, 8, "National Service", "Pending", past)  # awaiting certificate
    _leave(api_db, 9, "National Service", "Pending", past, certificate_path="")
    _leave(api_db, 10, "National Service", "Completed", past, certificate_path="c.pdf")
    _leave(api_db, 11, "Annual Leave", "Approved", past, deleted=True)
    api_db.commit()

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: make_user(api_db, role="admin")
    r = TestClient(app).get("/api/v1/leaves/awaiting-return/count")

    assert r.status_code == 200
    assert r.json() == {"count": 3}
