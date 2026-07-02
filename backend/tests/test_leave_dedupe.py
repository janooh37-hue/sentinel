"""A2 — duplicate-leave cleanup: plan (read-only) + apply (soft-delete + repoint)."""

from datetime import date

from app.services.leave_dedupe import apply_dedupe, plan_dedupe

from app.db.models import Document, Employee, Leave


def _emp(db, eid="G3082"):
    e = Employee(id=eid, name_en="Test", name_ar="اختبار")
    db.add(e)
    db.flush()
    return e


def _leave(db, eid="G3082", **kw):
    row = Leave(
        employee_id=eid,
        leave_type=kw.get("leave_type", "Sick Leave"),
        start_date=kw.get("start", date(2026, 3, 25)),
        end_date=kw.get("end", date(2026, 3, 26)),
        days=2,
        status=kw.get("status", "Approved"),
    )
    db.add(row)
    db.flush()
    return row


def test_plan_groups_dupes_and_keeps_lowest_id(db_session):
    _emp(db_session)
    ids = [_leave(db_session).id for _ in range(3)]
    groups = plan_dedupe(db_session)
    assert len(groups) == 1
    assert groups[0].keep_id == min(ids)
    assert set(groups[0].drop_ids) == set(ids) - {min(ids)}


def test_plan_ignores_distinct_and_single_rows(db_session):
    _emp(db_session)
    _leave(db_session, leave_type="Annual Leave", start=date(2026, 7, 1), end=date(2026, 7, 3))
    _leave(db_session, leave_type="Annual Leave", start=date(2026, 7, 10), end=date(2026, 7, 12))
    assert plan_dedupe(db_session) == []


def test_apply_soft_deletes_dupes_and_repoints_documents(db_session):
    _emp(db_session)
    a = _leave(db_session)
    b = _leave(db_session)  # exact duplicate of a
    doc = Document(
        employee_id="G3082",
        template_id="Leave Application Form",
        ref_number="HR-0042",
        docx_path="x.docx",
        pdf_path="x.pdf",
        submission_id="s-1",
        leave_id=b.id,
    )
    db_session.add(doc)
    db_session.flush()

    dropped = apply_dedupe(db_session, plan_dedupe(db_session))

    db_session.refresh(a)
    db_session.refresh(b)
    db_session.refresh(doc)
    assert dropped == 1
    assert a.deleted_at is None  # lowest id kept
    assert b.deleted_at is not None  # higher id soft-deleted
    assert doc.leave_id == a.id  # document re-pointed to the survivor


def test_apply_is_idempotent(db_session):
    _emp(db_session)
    _leave(db_session)
    _leave(db_session)
    apply_dedupe(db_session, plan_dedupe(db_session))
    # second run finds nothing left to do
    assert plan_dedupe(db_session) == []
    assert apply_dedupe(db_session, plan_dedupe(db_session)) == 0
