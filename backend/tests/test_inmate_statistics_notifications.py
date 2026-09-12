"""Monthly notification ownership agrees with the real workflow task policy."""

import pytest
from backend.tests import test_inmate_statistics_workflow as fixtures
from backend.tests.test_inmate_statistics_workflow import live, prepare

from app.db.models import UserPermission
from app.services import inmate_statistics_service as service
from app.services import notification_service as notifications

api_db = fixtures.api_db
people = fixtures.people


def monthly_items(db, user):
    return [
        item
        for item in notifications.actionable_items(db, user)
        if item.kind.startswith("monthly_")
    ]


def test_assigned_stage_counts_and_push_follow_handoff(api_db, people):
    live(api_db)
    view = prepare(api_db, people)
    submission_id = view.workflow["active_submission_id"]
    items = monthly_items(api_db, people[1])
    assert len(items) == 1
    assert items[0].kind == "monthly_review"
    assert items[0].ref == f"inmate-submission:{submission_id}"
    assert (
        items[0].url
        == f"/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-08&stats_submission={submission_id}"
    )
    counts = notifications.relevant_counts(api_db, people[1], precomputed_leaves=0)
    assert counts.monthly_reviews == 1 and counts.monthly_approvals == 0
    assert counts.approvals == 0
    service.review_month(
        api_db,
        2026,
        8,
        actor=people[1],
        expected_version=view.workflow["version"],
        submission_id=submission_id,
        manager_user_id=people[2].id,
    )
    assert monthly_items(api_db, people[1]) == []
    assert [item.kind for item in monthly_items(api_db, people[2])] == ["monthly_approval"]
    counts = notifications.relevant_counts(api_db, people[2], precomputed_leaves=0)
    assert counts.monthly_reviews == 0 and counts.monthly_approvals == 1
    assert counts.approvals == 0


@pytest.mark.parametrize("invalid", ["navigation", "capability", "relinked", "stale"])
def test_ineligible_or_stale_assignment_disappears_from_counts_and_push(api_db, people, invalid):
    book = live(api_db)
    prepare(api_db, people)
    assert monthly_items(api_db, people[1])
    if invalid in {"navigation", "capability"}:
        capability = "documents.generate" if invalid == "navigation" else "inmate_statistics.review"
        api_db.add(UserPermission(user_id=people[1].id, capability=capability, effect="deny"))
    elif invalid == "relinked":
        people[1].employee_id = people[3].employee_id
    else:
        version = max(book.versions, key=lambda item: item.version_no)
        version.fields = {**version.fields, "violation_details": "تفاصيل معدّلة بعد الإرسال"}
    api_db.commit()
    assert monthly_items(api_db, people[1]) == []
    counts = notifications.relevant_counts(api_db, people[1], precomputed_leaves=0)
    assert counts.monthly_reviews == counts.monthly_approvals == 0


def test_unowned_preparation_and_admin_recovery_do_not_push(api_db, people):
    live(api_db)
    assert any(
        task["kind"] == "prepare" for task in service.workflow_tasks(api_db, actor=people[0])
    )
    for person in people:
        assert monthly_items(api_db, person) == []
        counts = notifications.relevant_counts(api_db, person, precomputed_leaves=0)
        assert counts.monthly_reviews == counts.monthly_approvals == 0
    prepare(api_db, people)
    people[1].status = "disabled"
    api_db.commit()
    assert service.workflow_tasks(api_db, actor=people[4])[0]["kind"] == "recovery"
    assert monthly_items(api_db, people[4]) == []
