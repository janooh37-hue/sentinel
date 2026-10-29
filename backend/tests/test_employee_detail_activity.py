from datetime import UTC, date, datetime

from app.api.v1.employees import list_employee_leaves, list_employee_violations
from app.db.models import (
    Absence,
    Document,
    DutyAssignmentEvent,
    Employee,
    Leave,
    UserPermission,
    Violation,
)
from app.services import document_service
from app.services.employee_detail_service import get_employee_detail
from tests.conftest import make_user


def test_employee_detail_recent_activity_includes_recorded_duty_locations(db_session, admin_user):
    employee = Employee(id="G100", name_en="ALPHA EMPLOYEE", name_ar="موظف ألف", status="Active")
    db_session.add_all(
        [
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
        ]
    )
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


def test_employee_file_exposes_only_committed_linked_documents(db_session, admin_user):
    employee = Employee(id="G101", name_en="BETA EMPLOYEE", name_ar="موظف باء", status="Active")
    leave = Leave(
        employee_id=employee.id,
        leave_type="Annual Leave",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 5),
        days=5,
        status="Approved",
        created_at=datetime(2026, 7, 25, 8),
    )
    violation = Violation(
        employee_id=employee.id,
        violation_type="Late Arrival",
        date=date(2026, 8, 10),
        description="Arrived after shift start",
        action_taken="Warning",
        deduction_days=0,
        status="Open",
        created_at=datetime(2026, 8, 10, 9),
    )
    db_session.add_all([employee, leave, violation])
    db_session.flush()

    leave_document = Document(
        employee_id=employee.id,
        template_id="Leave Application Form",
        ref_number="HR-0101",
        submission_id="00000000-0000-0000-0000-000000000101",
        created_at=datetime(2026, 7, 25, 9),
        leave_id=leave.id,
    )
    draft_document = Document(
        employee_id=employee.id,
        template_id="Leave Application Form",
        ref_number="DRAFT",
        submission_id="00000000-0000-0000-0000-000000000102",
        created_at=datetime(2026, 7, 25, 10),
        leave_id=leave.id,
    )
    violation_document = Document(
        employee_id=employee.id,
        template_id="Violation Form",
        ref_number="NAT-0101",
        submission_id="00000000-0000-0000-0000-000000000103",
        created_at=datetime(2026, 8, 10, 10),
        violation_id=violation.id,
    )
    db_session.add_all([leave_document, draft_document, violation_document])
    db_session.commit()

    detail = get_employee_detail(db_session, employee.id)

    assert detail is not None
    assert [
        (document.id, document.template_id, document.created_at)
        for document in detail.recent_leaves[0].linked_documents
    ] == [
        (leave_document.id, "Leave Application Form", datetime(2026, 7, 25, 9, tzinfo=UTC)),
    ]
    assert [
        (document.id, document.template_id, document.created_at)
        for document in detail.recent_violations[0].linked_documents
    ] == [
        (violation_document.id, "Violation Form", datetime(2026, 8, 10, 10, tzinfo=UTC)),
    ]

    leave_rows = list_employee_leaves(employee.id, db_session, admin_user)
    violation_rows = list_employee_violations(employee.id, db_session, admin_user)

    assert [document.id for document in leave_rows[0].linked_documents] == [leave_document.id]
    assert [document.id for document in violation_rows[0].linked_documents] == [
        violation_document.id
    ]


def test_linked_document_lookup_avoids_queries_for_empty_ids(db_session, count_queries):
    with count_queries() as query_count:
        assert document_service.documents_for_leaves(db_session, []) == {}
        assert document_service.documents_for_violations(db_session, []) == {}

    assert query_count.count == 0


def test_detail_leave_privacy_preserves_internal_reads_and_unrelated_history(db_session):
    viewer = make_user(db_session, email="leave-private@test.ae")
    employee = Employee(id="G-LEAVE-DETAIL", name_en="Private Leave Employee", status="Active")
    db_session.add(employee)
    db_session.flush()
    today = date.today()
    leave = Leave(
        employee_id=employee.id,
        leave_type="Annual Leave",
        start_date=today,
        end_date=today,
        days=1,
        status="Approved",
    )
    absence = Absence(employee_id=employee.id, date=today, note="Private absence")
    violation = Violation(
        employee_id=employee.id,
        date=today,
        violation_type="Late Arrival",
        status="Open",
    )
    db_session.add_all(
        [
            leave,
            absence,
            violation,
            UserPermission(user_id=viewer.id, capability="leaves.view", effect="deny"),
        ]
    )
    db_session.commit()

    hidden = get_employee_detail(db_session, employee.id, user=viewer)
    assert hidden is not None
    assert hidden.stats.leaves_taken_days is None
    assert hidden.stats.leaves_allowed_days is None
    assert hidden.stats.absence_days is None
    assert hidden.recent_leaves == hidden.recent_absences == []
    assert {item.kind for item in hidden.recent_activity} == {"violation"}
    assert hidden.stats.violations == 1

    internal = get_employee_detail(db_session, employee.id)
    assert internal is not None
    assert internal.stats.leaves_taken_days == 1
    assert internal.stats.leaves_allowed_days == 30
    assert internal.stats.absence_days == 1
    assert [row.id for row in internal.recent_leaves] == [leave.id]
    assert [row.id for row in internal.recent_absences] == [absence.id]
    assert {item.kind for item in internal.recent_activity} == {"leave", "absence", "violation"}
    assert hidden.employee == internal.employee
    assert hidden.recent_violations == internal.recent_violations
    assert hidden.missing_fields == internal.missing_fields
    assert hidden.completeness == internal.completeness
