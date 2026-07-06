"""B1/P4 — the scan-inbox list must not issue one query per row."""

from datetime import date

from app.api.v1.scan_inbox import list_scan_inbox
from app.db.models import Employee, LedgerEntry, ScanInbox, User


def _user(db) -> User:
    u = User(email="op@x.ae", password_hash="x", role="operator", status="active")
    db.add(u)
    db.flush()
    return u


def _seed(db, owner_id: int, n: int) -> None:
    for i in range(n):
        eid = f"G{9000 + i}"
        db.add(Employee(id=eid, name_en=f"Emp {i}", name_ar=f"موظف {i}"))
        entry = LedgerEntry(
            entry_date=date(2026, 7, 1),
            direction="incoming",
            channel="email",
            counterparty=f"sender{i}@x.ae",
            subject=f"subject {i}",
        )
        db.add(entry)
        db.flush()
        db.add(
            ScanInbox(
                source="email",
                file_path=f"/scans/f{i}.pdf",
                filename=f"f{i}.pdf",
                owner_user_id=owner_id,
                state="unrouted",
                proposed_employee_id=eid,
                ledger_entry_id=entry.id,
            )
        )
    db.flush()


def test_list_scan_inbox_is_not_n_plus_1(db_session, count_queries):
    user = _user(db_session)
    _seed(db_session, user.id, 10)

    with count_queries() as q:
        res = list_scan_inbox(db=db_session, user=user, state="unrouted")

    assert len(res.items) == 10
    # every item resolves its employee + ledger entry, but via batched IN-queries:
    # 1 list + 1 employees + 1 ledger-entries (allow a small constant, not 1 + 2*N)
    assert q.count <= 4, f"expected batched queries, got {q.count} (N+1)"
    # data still resolved correctly
    assert res.items[0].proposed_employee_name_en is not None
    assert res.items[0].email_subject is not None
