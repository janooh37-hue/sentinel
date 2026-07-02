from app.db.models import Employee


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
