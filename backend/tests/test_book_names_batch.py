"""B1/P4 — batched book submitter/reviewer name resolution (no per-user N+1)."""

from app.db.models import Employee, User
from app.services import book_service


def _seed_users(db, n: int) -> list[int]:
    ids = []
    for i in range(n):
        eid = f"G{800 + i}"
        db.add(Employee(id=eid, name_en=f"Emp {i}", name_ar=f"موظف {i}"))
        u = User(
            email=f"u{i}@x.ae",
            password_hash="x",
            role="operator",
            status="active",
            employee_id=eid,
        )
        db.add(u)
        db.flush()
        ids.append(u.id)
    return ids


def test_resolve_names_by_ids_is_batched(db_session, count_queries):
    ids = _seed_users(db_session, 5)

    with count_queries() as q:
        names = book_service.resolve_names_by_ids(db_session, set(ids))

    assert len(names) == 5
    assert names[ids[0]] == "Emp 0"  # linked employee's English name wins
    # one query for the users + one for their linked employees, regardless of N
    assert q.count <= 2, f"expected batched resolution, got {q.count} (N+1)"


def test_resolve_names_falls_back_to_display_name_then_email(db_session):
    u1 = User(
        email="a@x.ae",
        password_hash="x",
        role="operator",
        status="active",
        display_name="Display A",
    )
    u2 = User(email="b@x.ae", password_hash="x", role="operator", status="active")
    db_session.add_all([u1, u2])
    db_session.flush()
    names = book_service.resolve_names_by_ids(db_session, {u1.id, u2.id})
    assert names[u1.id] == "Display A"  # no linked employee -> display_name
    assert names[u2.id] == "b@x.ae"  # no display_name -> email


def test_resolve_names_empty_set_no_queries(db_session, count_queries):
    with count_queries() as q:
        assert book_service.resolve_names_by_ids(db_session, set()) == {}
    assert q.count == 0
