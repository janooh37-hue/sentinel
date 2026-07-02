from app.db.models import Employee
from app.schemas.employee import EmployeeUpdate
from app.services import employee_service


def test_employee_has_passport_no_source_column(db_session):
    emp = Employee(id="G9001", name_en="Test", status="Active")
    emp.passport_no_source = "mrz"
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    assert emp.passport_no_source == "mrz"


def test_passport_no_source_defaults_none(db_session):
    emp = Employee(id="G9002", name_en="Test2", status="Active")
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    assert emp.passport_no_source is None


def test_patch_passport_no_sets_manual_source(db_session):
    emp = Employee(id="G9003", name_en="Patch", status="Active")
    db_session.add(emp)
    db_session.commit()
    employee_service.update_employee(db_session, "G9003", EmployeeUpdate(passport_no="M0001234"))
    db_session.refresh(emp)
    assert emp.passport_no == "M0001234"
    assert emp.passport_no_source == "manual"


def test_patch_without_passport_leaves_source(db_session):
    emp = Employee(id="G9004", name_en="Patch2", status="Active", passport_no_source="mrz")
    db_session.add(emp)
    db_session.commit()
    employee_service.update_employee(db_session, "G9004", EmployeeUpdate(department="Ops"))
    db_session.refresh(emp)
    assert emp.passport_no_source == "mrz"
