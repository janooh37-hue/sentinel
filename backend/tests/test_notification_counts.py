"""Bell badge counts from ``notification_service.relevant_counts``.

Pins the numbers, not the queries, so the counting strategy can change.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from itertools import count

from sqlalchemy.orm import Session

from app.db.models import (
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Employee,
    Leave,
    User,
    UserPermission,
)
from app.services import notification_service
from tests.conftest import make_user

_ids = count(1)


def _signer(db: Session, email: str, *, can_sign: bool) -> User:
    user = make_user(db, role="operator", email=email)
    effect = "grant" if can_sign else "deny"
    db.add(UserPermission(user_id=user.id, capability="books.approve", effect=effect))
    db.commit()
    return user


def _book(
    db: Session,
    versions: list[list[tuple[User, str, str]]],
    *,
    deleted: bool = False,
) -> None:
    """A book whose versions carry (assignee, kind, state) steps; last is current."""
    n = next(_ids)
    book = Book(
        category_id="HR",
        ref_number=f"HR-{n}",
        approval_state="pending",
        deleted_at=datetime(2026, 1, 1) if deleted else None,
    )
    for version_no, steps in enumerate(versions, start=1):
        version = BookVersion(version_no=version_no, status="pending")
        for order, (assignee, kind, state) in enumerate(steps):
            step = BookApprovalStep(
                step_order=order,
                stage_label=kind,
                assignee_user_id=assignee.id,
                kind=kind,
                state=state,
            )
            book.approval_steps.append(step)
            version.approval_steps.append(step)
        book.versions.append(version)
    db.add(book)
    db.commit()


def test_approvals_count_current_pending_steps_by_signing_capability(api_db: Session) -> None:
    api_db.add(BookCategory(id="HR", name_en="HR", name_ar="HR", prefix="HR"))
    signer = _signer(api_db, "signer@x.ae", can_sign=True)
    reviewer = _signer(api_db, "reviewer@x.ae", can_sign=False)
    other = make_user(api_db, email="other@x.ae")

    _book(api_db, [[(signer, "approver", "pending")]])  # signer
    _book(api_db, [[(signer, "reviewer", "pending"), (reviewer, "reviewer", "pending")]])  # both
    # Reviewer is also the pending approver: approver wins, and they cannot sign.
    _book(api_db, [[(reviewer, "approver", "pending"), (reviewer, "reviewer", "pending")]])
    # Only the superseded version still has the signer's pending step.
    _book(api_db, [[(signer, "approver", "pending")], [(other, "approver", "pending")]])
    _book(api_db, [[(signer, "approver", "pending")]], deleted=True)
    _book(api_db, [[(signer, "approver", "approved")]])
    _book(api_db, [[(other, "approver", "pending")]])

    assert notification_service.relevant_counts(api_db, signer).approvals == 2
    assert notification_service.relevant_counts(api_db, reviewer).approvals == 1


def test_leaves_count_rows_needing_action(api_db: Session) -> None:
    today = datetime.now(UTC).date()
    past, future = today - timedelta(days=2), today + timedelta(days=2)
    api_db.add(Employee(id="E1", name_en="Test Person"))

    def leave(leave_type: str, status: str, end, *, deleted: bool = False) -> None:
        api_db.add(
            Leave(
                employee_id="E1",
                leave_type=leave_type,
                start_date=end - timedelta(days=next(_ids)),  # distinct natural keys
                end_date=end,
                status=status,
                deleted_at=datetime(2026, 1, 1) if deleted else None,
            )
        )

    # Needs action:
    leave("Annual Leave", "Pending", future)  # request awaiting a decision
    leave("Annual Leave", "Approved", past)  # awaiting return
    leave("Annual Leave - الإجازة السنوية", "Generated - تم الإنشاء", past)  # legacy alias
    leave("National Service", "Pending", past)  # overdue
    # Does not:
    leave("Annual Leave", "Approved", future)
    leave("National Service", "Pending", future)
    leave("Sick Leave", "Approved", past)
    leave("Compassionate Leave", "Approved", past)
    leave("Annual Leave", "Pending", future, deleted=True)
    api_db.commit()

    user = make_user(api_db, email="leaves@x.ae")
    assert notification_service.relevant_counts(api_db, user).leaves == 4
