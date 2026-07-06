"""Scan Inbox: candidates/fields exposure + the document-serve endpoint."""


from app.api.v1.scan_inbox import list_scan_inbox
from app.db.models import ScanInbox, User


def _user(db, email="op@x.ae") -> User:
    u = User(email=email, password_hash="x", role="operator", status="active")
    db.add(u)
    db.flush()
    return u


def test_list_exposes_fields_and_candidates(db_session):
    user = _user(db_session)
    cands = [{"employee_id": "G1", "name_en": "Ahmed Ali", "name_ar": None, "score": 0.62}]
    db_session.add(
        ScanInbox(
            source="email",
            file_path="/s/x.pdf",
            filename="x.pdf",
            state="unrouted",
            owner_user_id=user.id,
            fields={"name_en": "Ahmed Ali"},
            candidates=cands,
        )
    )
    db_session.flush()
    res = list_scan_inbox(db=db_session, user=user, state="unrouted")
    item = res.items[0]
    assert item.fields == {"name_en": "Ahmed Ali"}
    assert item.candidates[0].employee_id == "G1"
    assert item.candidates[0].score == 0.62
