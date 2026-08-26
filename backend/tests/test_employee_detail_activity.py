from datetime import datetime

from app.db.models import Document, DutyAssignmentEvent, Employee
from app.services.employee_detail_service import get_employee_detail


def test_employee_detail_recent_activity_includes_recorded_duty_locations(db_session, admin_user):
    employee = Employee(id="G100", name_en="ALPHA EMPLOYEE", name_ar="موظف ألف", status="Active")
    db_session.add_all([
        employee,
        Document(
            employee_id=employee.id,
            template_id="Employment Certificate",
            ref_number="HR-0100",
            docx_path="output/fake.docx",
            submission_id="00000000-0000-0000-0000-000000000100",
            created_at=datetime(2026, 8, 23, 8),
        ),
        DutyAssignmentEvent(
            employee_id=employee.id,
            event_type="initial_placement",
            from_department=None,
            from_unit=None,
            from_post=None,
            to_department="Security",
            to_unit="Main Gate",
            to_post="Gate 1",
            effective_at=datetime(2026, 8, 22, 8),
            actor_user_id=admin_user.id,
            reason="Initial placement",
        ),
        DutyAssignmentEvent(
            employee_id=employee.id,
            event_type="transfer",
            from_department="Security",
            from_unit="Main Gate",
            from_post="Gate 1",
            to_department="Security",
            to_unit="Administration",
            to_post="Reception",
            effective_at=datetime(2026, 8, 24, 8),
            actor_user_id=admin_user.id,
            reason="Duty transfer",
        ),
        DutyAssignmentEvent(
            employee_id=employee.id,
            event_type="baseline",
            from_department=None,
            from_unit=None,
            from_post=None,
            to_department="Security",
            to_unit="Legacy",
            to_post=None,
            effective_at=datetime(2026, 8, 25, 8),
            actor_user_id=admin_user.id,
            reason="Seed baseline",
        ),
    ])
    db_session.commit()

    detail = get_employee_detail(db_session, employee.id)

    assert detail is not None
    assert [(row.kind, row.summary) for row in detail.recent_activity] == [
        ("duty_location", "transfer"),
        ("document", "Generated Employment Certificate"),
        ("duty_location", "initial_placement"),
    ]
    movement = detail.recent_activity[0]
    assert movement.event_type == "transfer"
    assert movement.from_department == "Security"
    assert movement.from_unit == "Main Gate"
    assert movement.from_post == "Gate 1"
    assert movement.to_department == "Security"
    assert movement.to_unit == "Administration"
    assert movement.to_post == "Reception"
    assert movement.reason == "Duty transfer"
