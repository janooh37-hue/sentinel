from datetime import date

import pytest

from app.db.models import Document, Employee, Leave
from app.services import document_service


@pytest.fixture
def emp(db_session):
    e = Employee(id="G3082", name_en="Test Emp", name_ar="موظف")
    db_session.add(e)
    db_session.flush()
    return e


def _doc(db_session, **kw):
    row = Document(
        employee_id=kw.get("employee_id", "G3082"),
        template_id=kw.get("template_id", "Leave Application Form"),
        ref_number=kw.get("ref_number", "HR-0042"),
        docx_path="x.docx",
        pdf_path="x.pdf",
        submission_id="s-1",
        leave_id=kw.get("leave_id"),
    )
    db_session.add(row)
    db_session.flush()
    return row


def test_sick_leave_document_is_gnumber_only(db_session, emp):
    leave = Leave(
        employee_id="G3082",
        leave_type="Sick Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Pending",
    )
    db_session.add(leave)
    db_session.flush()
    row = _doc(db_session, leave_id=leave.id)
    assert document_service.download_filename_for(row, ".pdf") == "G3082.pdf"


def test_annual_leave_document_uses_gnumber_plus_arabic(db_session, emp):
    leave = Leave(
        employee_id="G3082",
        leave_type="Annual Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Pending",
    )
    db_session.add(leave)
    db_session.flush()
    row = _doc(db_session, leave_id=leave.id)
    name = document_service.download_filename_for(row, ".pdf")
    assert name.startswith("G3082_")
    assert name.endswith(".pdf")


def test_document_without_employee_falls_back_to_ref(db_session):
    row = _doc(db_session, employee_id=None, template_id="General Book", ref_number="GS-0333")
    name = document_service.download_filename_for(row, ".pdf")
    assert name.startswith("GS-0333_")
