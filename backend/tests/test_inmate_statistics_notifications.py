"""Notifications follow the selected reviewer and approver only."""

from backend.tests import test_inmate_statistics_workflow as fixtures

from app.db.models import UserPermission
from app.services import inmate_statistics_service as workflow
from app.services import notification_service as notifications

api_db = fixtures.api_db
people = fixtures.people
live = fixtures.live
prepare = fixtures.prepare


def monthly(user, db):
    return [
        item
        for item in notifications.actionable_items(db, user)
        if item.kind.startswith("monthly_")
    ]


def test_assignment_moves_from_selected_reviewer_to_selected_manager(api_db, people):
    live(api_db)
    viewed = prepare(api_db, people)
    item = monthly(people[1], api_db)[0]
    assert (item.kind, item.ref, item.url) == (
        "monthly_review",
        "inmate-month:2026-08:review",
        "/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-08",
    )
    assert notifications.relevant_counts(api_db, people[1]).monthly_reviews == 1
    assert monthly(people[3], api_db) == []

    workflow.review_month(
        api_db,
        2026,
        8,
        actor=people[1],
        expected_version=viewed.workflow["version"],
        manager_user_id=people[2].id,
    )
    assert monthly(people[1], api_db) == []
    assert notifications.relevant_counts(api_db, people[1]).monthly_reviews == 0
    item = monthly(people[2], api_db)[0]
    assert (item.kind, item.ref) == ("monthly_approval", "inmate-month:2026-08:approve")
    assert notifications.relevant_counts(api_db, people[2]).monthly_approvals == 1


def test_assignment_disappears_when_the_selected_actor_loses_capability(api_db, people):
    live(api_db)
    prepare(api_db, people)
    api_db.add(
        UserPermission(
            user_id=people[1].id,
            capability="inmate_statistics.review",
            effect="deny",
        )
    )
    api_db.commit()
    assert monthly(people[1], api_db) == []
    assert notifications.relevant_counts(api_db, people[1]).monthly_reviews == 0
