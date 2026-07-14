from sqlalchemy import select

from app.db.models import GroupAnnouncement, GroupAnnouncementSend


def test_announcement_and_sends_roundtrip(db_session):
    ann = GroupAnnouncement(body="hello", attachment_kind="none", sent_by=1)
    db_session.add(ann)
    db_session.commit()
    db_session.add(
        GroupAnnouncementSend(
            announcement_id=ann.id,
            group_id="1@g.us",
            group_name="Alpha",
            status="sent",
            provider_msg_id="m1",
        )
    )
    db_session.commit()
    got = db_session.scalar(
        select(GroupAnnouncementSend).where(GroupAnnouncementSend.announcement_id == ann.id)
    )
    assert got.group_name == "Alpha" and got.status == "sent"
    assert ann.attachment_kind == "none" and ann.created_at is not None
