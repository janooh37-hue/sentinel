"""Activity statement and statement print serials (employee file)."""

import json
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db.models import (
    Absence,
    Book,
    BookCategory,
    BookVersion,
    Document,
    DutyAssignmentEvent,
    Employee,
    EmployeeStatementPrint,
    EmployeeStatusEvent,
    Leave,
    LedgerEntry,
    UserPermission,
    Violation,
)
from app.db.session import get_db
from app.main import create_app
from tests.conftest import make_user

EMP = "G3190"


@pytest.fixture()
def env(api_db):
    db = api_db
    admin = make_user(db, role="admin", email="admin@test.ae")
    admin.display_name = "Admin Person"
    clerk = make_user(db, email="clerk@test.ae")
    clerk.display_name = "Clerk Person"
    db.add_all(
        [
            Employee(id=EMP, name_en="Statement Employee", status="Active"),
            Employee(id="G4000", name_en="Second Employee", status="Active"),
            BookCategory(id="GS", prefix="GS", name_en="General Records"),
        ]
    )
    db.commit()
    actor = {"user": admin}
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: actor["user"]
    return SimpleNamespace(db=db, admin=admin, clerk=clerk, actor=actor, client=TestClient(app))


def _statement(env, **params):
    response = env.client.get(f"/api/v1/employees/{EMP}/statement/activity", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _document(env, *, ref, created_at, template="Employment Certificate", named_by=None):
    """A committed document owned by a Record (``named_by`` makes it private)."""
    db = env.db
    creator = named_by or env.clerk
    book = Book(
        category_id="GS",
        ref_number=ref,
        subject="record",
        grade="unclassified",
        distribution="named" if named_by else "organization",
        created_by_user_id=creator.id,
        employee_id=EMP,
        direction="outgoing",
        approval_state="approved",
        created_at=created_at,
    )
    db.add(book)
    db.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        template_id=template,
        fields={},
        status="approved",
        created_by_user_id=creator.id,
    )
    document = Document(
        employee_id=EMP,
        template_id=template,
        ref_number=ref,
        submission_id=f"sub-{ref}",
        created_at=created_at,
    )
    db.add_all([version, document])
    db.flush()
    version.document_id = document.id
    db.commit()
    return document


def test_period_bounds_are_inclusive_site_days_and_open_sides_unbounded(env):
    db = env.db
    db.add_all(
        [
            Absence(employee_id=EMP, date=date(2026, 8, 1), note="first day"),
            Absence(employee_id=EMP, date=date(2026, 8, 31), note="last day"),
            Absence(employee_id=EMP, date=date(2026, 7, 31), note="before"),
            Absence(employee_id=EMP, date=date(2026, 9, 1), note="after"),
            # 21:30 UTC on 31 Jul is 01:30 on 1 Aug at the site.
            LedgerEntry(
                entry_date=date(2026, 8, 1),
                direction="incoming",
                channel="letter",
                counterparty="Ministry",
                subject="early site morning",
                related_employee_id=EMP,
                created_at=datetime(2026, 7, 31, 21, 30),
            ),
            # 20:30 UTC on 31 Aug is 00:30 on 1 Sep at the site: outside.
            LedgerEntry(
                entry_date=date(2026, 9, 1),
                direction="incoming",
                channel="letter",
                counterparty="Ministry",
                subject="next site day",
                related_employee_id=EMP,
                created_at=datetime(2026, 8, 31, 20, 30),
            ),
        ]
    )
    db.commit()

    august = _statement(env, from_date="2026-08-01", to_date="2026-08-31")
    assert august["from_date"] == "2026-08-01" and august["to_date"] == "2026-08-31"
    assert [(i["kind"], i["note"] or i["subject"]) for i in august["items"]] == [
        ("absence", "last day"),
        ("ledger", "early site morning"),
        ("absence", "first day"),
    ]
    ledger = august["items"][1]
    assert ledger["occurred_at"] == "2026-08-01T01:30:00+04:00"
    assert ledger["date_only"] is False
    assert august["items"][0]["occurred_at"] == "2026-08-31T00:00:00+04:00"
    assert august["items"][0]["date_only"] is True

    since = _statement(env, from_date="2026-09-01")
    assert {i["note"] or i["subject"] for i in since["items"]} == {"after", "next site day"}
    until = _statement(env, to_date="2026-07-31")
    assert [i["note"] for i in until["items"]] == ["before"]
    everything = _statement(env)
    assert len(everything["items"]) == 6
    assert everything["from_date"] is None and everything["truncated"] is False


def test_statement_is_uncapped_newest_first_with_deterministic_ties(env):
    db = env.db
    start = date(2026, 1, 1)
    db.add_all(
        Absence(employee_id=EMP, date=start + timedelta(days=n), note=f"a{n}") for n in range(25)
    )
    same_day = date(2026, 3, 1)
    leave = Leave(
        employee_id=EMP,
        leave_type="Annual Leave",
        start_date=same_day,
        end_date=same_day,
        days=1,
        status="Approved",
    )
    violations = [
        Violation(employee_id=EMP, violation_type="Late", date=same_day, status="Open")
        for _ in range(2)
    ]
    db.add_all([leave, *violations])
    db.commit()

    items = _statement(env)["items"]
    assert len(items) == 28
    assert [(i["kind"], i["source_id"]) for i in items[:3]] == [
        ("leave", leave.id),
        ("violation", max(v.id for v in violations)),
        ("violation", min(v.id for v in violations)),
    ]
    assert [i["note"] for i in items[3:]] == [f"a{n}" for n in reversed(range(25))]


def test_leave_rights_hide_leaves_and_absences_and_violation_rights_hide_violations(env):
    db = env.db
    day = date(2026, 5, 5)
    db.add_all(
        [
            Leave(
                employee_id=EMP,
                leave_type="Sick Leave",
                start_date=day,
                end_date=day,
                days=1,
                status="Approved",
            ),
            Absence(employee_id=EMP, date=day),
            Violation(employee_id=EMP, violation_type="Late", date=day, status="Open"),
        ]
    )
    db.commit()
    no_leaves = make_user(db, email="no-leaves@test.ae")
    neither = make_user(db, email="neither@test.ae")
    db.add_all(
        [
            UserPermission(user_id=no_leaves.id, capability="leaves.view", effect="deny"),
            UserPermission(user_id=neither.id, capability="leaves.view", effect="deny"),
            UserPermission(user_id=neither.id, capability="violations.view", effect="deny"),
        ]
    )
    db.commit()

    env.actor["user"] = env.clerk
    assert {i["kind"] for i in _statement(env)["items"]} == {"leave", "absence", "violation"}
    env.actor["user"] = no_leaves
    assert {i["kind"] for i in _statement(env)["items"]} == {"violation"}
    env.actor["user"] = neither
    assert _statement(env)["items"] == []


def test_documents_respect_record_access_and_skip_drafts(env):
    owner = make_user(env.db, email="owner@test.ae")
    readable = _document(env, ref="GS-0001", created_at=datetime(2026, 4, 1, 8))
    _document(env, ref="GS-0002", created_at=datetime(2026, 4, 2, 8), named_by=owner)
    env.db.add(
        Document(
            employee_id=EMP,
            template_id="Employment Certificate",
            ref_number="DRAFT",
            submission_id="sub-draft",
            created_at=datetime(2026, 4, 3, 8),
        )
    )
    env.db.commit()
    env.actor["user"] = env.clerk

    docs = [i for i in _statement(env)["items"] if i["kind"] == "document"]
    assert [(d["source_id"], d["reference"]) for d in docs] == [(readable.id, "GS-0001")]


def test_another_users_private_email_is_hidden(env):
    db = env.db
    for owner, subject in ((env.admin, "admin mail"), (env.clerk, "clerk mail"), (None, "shared")):
        db.add(
            LedgerEntry(
                entry_date=date(2026, 6, 1),
                direction="incoming",
                channel="email" if owner else "letter",
                counterparty="someone",
                subject=subject,
                related_employee_id=EMP,
                owner_user_id=owner.id if owner else None,
                created_at=datetime(2026, 6, 1, 8),
            )
        )
    db.commit()
    env.actor["user"] = env.clerk
    assert {i["subject"] for i in _statement(env)["items"]} == {"clerk mail", "shared"}


def test_template_names_resolve_and_unknown_templates_stay_null(env):
    _document(env, ref="GS-0010", created_at=datetime(2026, 4, 1, 8), template="Report")
    _document(env, ref="GS-0011", created_at=datetime(2026, 4, 2, 8), template="No Such Form")

    docs = {i["template_id"]: i for i in _statement(env)["items"]}
    assert (docs["Report"]["template_name_en"], docs["Report"]["template_name_ar"]) == (
        "Report",
        "تقرير",
    )
    assert docs["No Such Form"]["template_name_en"] is None
    assert docs["No Such Form"]["template_name_ar"] is None


def test_actor_names_come_from_real_actors_only(env):
    db = env.db
    no_name = make_user(db, email="plain@test.ae")
    day = date(2026, 2, 2)
    db.add_all(
        [
            Absence(employee_id=EMP, date=day, created_by=env.clerk.id),
            EmployeeStatusEvent(
                employee_id=EMP,
                from_status="Active",
                to_status="On Leave",
                kind="changed",
                source="manual",
                actor_user_id=no_name.id,
                created_at=datetime(2026, 2, 2, 8),
            ),
            DutyAssignmentEvent(
                employee_id=EMP,
                event_type="transfer",
                from_department="Security",
                from_unit="Gate",
                to_department="Security",
                to_unit="Office",
                effective_at=datetime(2026, 2, 2, 9),
                actor_user_id=env.admin.id,
            ),
            DutyAssignmentEvent(
                employee_id=EMP,
                event_type="baseline",
                to_department="Security",
                effective_at=datetime(2026, 2, 2, 10),
                actor_user_id=env.admin.id,
            ),
            Leave(
                employee_id=EMP,
                leave_type="Annual Leave",
                start_date=day,
                end_date=day,
                days=1,
                status="Approved",
            ),
            Violation(employee_id=EMP, violation_type="Late", date=day, status="Open"),
            LedgerEntry(
                entry_date=day,
                direction="incoming",
                channel="letter",
                counterparty="x",
                subject="blank author",
                related_employee_id=EMP,
                created_by="  ",
                created_at=datetime(2026, 2, 2, 7),
            ),
        ]
    )
    db.commit()
    _document(env, ref="GS-0020", created_at=datetime(2026, 2, 2, 6))

    actors = {i["kind"]: i["actor_name"] for i in _statement(env)["items"]}
    assert actors == {
        "absence": "Clerk Person",
        "status": "plain@test.ae",
        "duty_location": "Admin Person",
        "document": "Clerk Person",
        "leave": None,
        "violation": None,
        "ledger": None,
    }


def test_unknown_employee_404_and_inverted_range_422(env):
    missing = env.client.get("/api/v1/employees/G0000/statement/activity")
    assert missing.status_code == 404
    inverted = env.client.get(
        f"/api/v1/employees/{EMP}/statement/activity",
        params={"from_date": "2026-08-02", "to_date": "2026-08-01"},
    )
    assert inverted.status_code == 422


def _print(env, employee_id=EMP, **overrides):
    body = {
        "kind": "activity",
        "from_date": "2026-01-01",
        "to_date": "2026-10-27",
        "language": "ar",
        "options": {"sections": ["leave", "document"], "orientation": "portrait"},
        **overrides,
    }
    return env.client.post(f"/api/v1/employees/{employee_id}/statement/prints", json=body)


def test_print_serials_run_per_employee_across_kinds(env):
    first = _print(env)
    second = _print(env, kind="attendance", from_date="2026-10-01", to_date="2026-10-31")
    third = _print(env, language="en")
    other = _print(env, employee_id="G4000")
    assert [r.status_code for r in (first, second, third, other)] == [201] * 4
    assert [r.json()["serial"] for r in (first, second, third)] == [1, 2, 3]
    assert [r.json()["reference"] for r in (first, second, third)] == [
        "G3190/1/12/1",
        "G3190/1/12/2",
        "G3190/1/12/3",
    ]
    assert other.json()["serial"] == 1
    assert other.json()["reference"] == "G4000/1/12/1"

    body = second.json()
    assert body["kind"] == "attendance"
    assert (body["from_date"], body["to_date"], body["language"]) == (
        "2026-10-01",
        "2026-10-31",
        "ar",
    )
    assert body["printed_by_name"] == "Admin Person"
    row = env.db.get(EmployeeStatementPrint, body["id"])
    env.db.refresh(row)
    assert row.printed_by_user_id == env.admin.id
    assert json.loads(row.options) == {
        "sections": ["leave", "document"],
        "orientation": "portrait",
    }
    assert (row.from_date, row.to_date, row.language) == (
        date(2026, 10, 1),
        date(2026, 10, 31),
        "ar",
    )


def test_attendance_print_follows_attendance_read_access(env):
    env.actor["user"] = env.clerk
    assert _print(env, kind="attendance").status_code == 403
    assert _print(env).status_code == 201

    env.clerk.employee_id = EMP
    env.db.commit()
    allowed = _print(env, kind="attendance")
    assert allowed.status_code == 201, allowed.text
    assert allowed.json()["serial"] == 2
    assert _print(env, employee_id="G4000", kind="attendance").status_code == 403


def test_print_validation_and_unknown_employee(env):
    assert _print(env, employee_id="G0000").status_code == 404
    assert _print(env, from_date="2026-11-01", to_date="2026-10-01").status_code == 422
    assert _print(env, language="fr").status_code == 422
    assert _print(env, options={"blob": "x" * 5000}).status_code == 422
    assert _print(env, from_date=None).status_code == 201
