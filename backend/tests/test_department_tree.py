"""Departments follow the org tree: derivation, exceptions and the cycle guard."""

from __future__ import annotations

import pytest
from sqlalchemy import select, update

from app.api.errors import ValidationFailedError
from app.db.models import Department, Employee, User
from app.schemas.department import DepartmentCreate
from app.services import department_service, department_tree_service, org_tree_service
from tests.department_fixtures import department, employee, exception, recompute


@pytest.fixture()
def tree(api_db):
    """BOSS > A(Admin head) > A1 > A11; A > S(Section head) > S1; BOSS > X > X1."""
    db = api_db
    employee(db, "BOSS")
    employee(db, "A", "BOSS")
    employee(db, "A1", "A", department="Legacy")
    employee(db, "A11", "A1")
    employee(db, "S", "A")
    employee(db, "S1", "S")
    employee(db, "X", "BOSS")
    employee(db, "X1", "X")
    admin = department(db, "Admin", "A", name_ar="الدوام الرسمي")
    section = department(db, "Section", "S", name_ar="القسم")
    return db, admin, section


def departments(db) -> dict[str, int | None]:
    return dict(db.execute(select(Employee.id, Employee.department_id)).tuples().all())


def test_head_anchors_branch_and_labels_follow(tree):
    db, admin, _section = tree
    got = departments(db)
    assert {e: got[e] for e in ("A", "A1", "A11")} == dict.fromkeys(("A", "A1", "A11"), admin.id)
    assert got["BOSS"] is got["X"] is got["X1"] is None
    assert db.get(Employee, "A1").department == "الدوام الرسمي"


def test_nested_head_is_sub_department(tree):
    db, admin, section = tree
    got = departments(db)
    assert got["S"] == got["S1"] == section.id
    assert db.get(Department, section.id).parent_id == admin.id
    assert db.get(Department, admin.id).parent_id is None


def test_exception_moves_branch_and_none_clears_owned_label(tree):
    db, _admin, section = tree
    exception(db, "A1", section.id)
    got = departments(db)
    assert got["A1"] == got["A11"] == section.id
    assert db.get(Employee, "A11").department == "القسم"
    exception(db, "A1", None)
    got = departments(db)
    assert got["A1"] is None and got["A11"] is None
    assert db.get(Employee, "A11").department is None


def test_inactive_department_falls_through_to_department_above(tree):
    db, admin, section = tree
    section.active = False
    recompute(db)
    got = departments(db)
    assert got["S"] == got["S1"] == admin.id


def test_head_exception_is_rejected_both_ways(tree):
    db, admin, _section = tree
    with pytest.raises(ValidationFailedError) as raised:
        department_service.put_exception(db, "S", admin.id, actor="t")
    assert raised.value.code == "DEPARTMENT_HEAD_EXCEPTION"
    exception(db, "X", None)
    with pytest.raises(ValidationFailedError) as raised:
        department_service.create_department(
            db, DepartmentCreate(name_en="Xd", name_ar="س", head_employee_id="X"), actor="t"
        )
    assert raised.value.code == "DEPARTMENT_HEAD_EXCEPTION"


def test_cycle_guard_resolves_cycle_to_none(tree):
    db, admin, _section = tree
    employee(db, "C1")
    employee(db, "C2", "C1")
    employee(db, "C3", "C2")
    db.execute(update(Employee).where(Employee.id == "C1").values(supervisor_id="C2"))
    # A cycle through a head must not loop either.
    db.execute(update(Employee).where(Employee.id == "BOSS").values(supervisor_id="A11"))
    department_tree_service.recompute(db)
    got = departments(db)
    assert got["C1"] is got["C2"] is got["C3"] is None
    assert got["BOSS"] == admin.id
    assert db.get(Department, admin.id).parent_id is None


def test_moving_a_person_moves_their_department(tree):
    db, admin, _section = tree
    actor = User(email="tree@test.ae", password_hash="x", role="admin", status="active")
    db.add(actor)
    db.commit()
    org_tree_service.set_supervisor(db, employee_id="X", supervisor_id="A1", actor=actor)
    got = departments(db)
    assert got["X"] == got["X1"] == admin.id


def test_records_keep_the_department_they_were_created_in(tree):
    from app.db.models import Book, BookCategory

    db, _admin, section = tree
    user = User(email="maker@test.ae", password_hash="x", status="active", employee_id="S1")
    db.add_all([user, BookCategory(id="HR", prefix="HR")])
    db.flush()
    book = Book(category_id="HR", ref_number="HR-1", created_by_user_id=user.id)
    db.add(book)
    db.commit()
    assert book.department_id == section.id
    section.active = False
    recompute(db)
    db.refresh(book)
    assert book.department_id == section.id


def test_rename_and_deactivate_clears_the_old_synchronized_label(tree):
    from app.schemas.department import DepartmentUpdate

    db, _admin, section = tree
    assert db.get(Employee, "S1").department == "القسم"
    department_service.update_department(
        db, section.id, DepartmentUpdate(name_ar="قسم جديد", active=False), actor="t"
    )
    # S1 falls through to Admin and takes its label; a detached head clears.
    assert db.get(Employee, "S1").department == "الدوام الرسمي"
    exception(db, "X", section.id)
    department_service.update_department(db, section.id, DepartmentUpdate(active=True), actor="t")
    assert db.get(Employee, "X1").department == "قسم جديد"
    department_service.update_department(
        db, section.id, DepartmentUpdate(name_ar="اسم آخر", active=False), actor="t"
    )
    assert db.get(Employee, "X1").department_id is None
    assert db.get(Employee, "X1").department is None


def test_delete_clears_the_deleted_department_label(tree):
    db, _admin, section = tree
    exception(db, "X", section.id)
    assert db.get(Employee, "X1").department == "القسم"
    department_service.delete_exception(db, "X", actor="t")
    exception(db, "X", section.id)
    department_service.delete_department(db, section.id, actor="t")
    assert db.get(Employee, "X1").department_id is None
    assert db.get(Employee, "X1").department is None


def test_employee_count_includes_working_statuses_only(api_db):
    db = api_db
    employee(db, "ACT", status="Active")
    for employee_id, status in (("LOAN", "Loaned"), ("RES", "Resigned"), ("TER", "Terminated")):
        employee(db, employee_id, "ACT", status=status)
    row = department(db, "Working", "ACT")
    assert department_service.read_department(db, row.id).employee_count == 2
