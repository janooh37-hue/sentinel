"""A1 — the leave dedup guard must match on the natural key regardless of age.

The old WF-03 guard only looked back 2 minutes, so a re-generated leave more
than 2 minutes later (the audit found real cases ~5.7 min apart) slipped through
and created a duplicate. The extracted `_find_duplicate_leave` helper does an
exact (employee, type, start, end) match with no time window.
"""

from datetime import date, datetime

from app.db.models import Employee, Leave
from app.services.document_service import _find_duplicate_leave


def _emp(db, eid="G3082"):
    e = Employee(id=eid, name_en="Test", name_ar="اختبار")
    db.add(e)
    db.flush()
    return e


def test_find_duplicate_matches_regardless_of_age(db_session):
    _emp(db_session)
    old = Leave(
        employee_id="G3082",
        leave_type="Sick Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Approved",
    )
    db_session.add(old)
    db_session.flush()
    old.created_at = datetime(2026, 7, 1, 0, 0, 0)  # far older than the retired 2-min window
    db_session.flush()
    probe = Leave(
        employee_id="G3082",
        leave_type="Sick Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Approved",
    )
    found = _find_duplicate_leave(db_session, probe)
    assert found is not None and found.id == old.id


def test_find_duplicate_none_for_distinct_dates(db_session):
    _emp(db_session)
    a = Leave(
        employee_id="G3082",
        leave_type="Annual Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Pending",
    )
    db_session.add(a)
    db_session.flush()
    probe = Leave(
        employee_id="G3082",
        leave_type="Annual Leave",
        start_date=date(2026, 7, 10),
        end_date=date(2026, 7, 12),
        days=3,
        status="Pending",
    )
    assert _find_duplicate_leave(db_session, probe) is None


def test_find_duplicate_skips_soft_deleted(db_session):
    _emp(db_session)
    gone = Leave(
        employee_id="G3082",
        leave_type="Sick Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Approved",
        deleted_at=datetime(2026, 7, 2),
    )
    db_session.add(gone)
    db_session.flush()
    probe = Leave(
        employee_id="G3082",
        leave_type="Sick Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Approved",
    )
    assert _find_duplicate_leave(db_session, probe) is None


def test_general_book_persists_paper_date_and_reuses_it_when_signing(
    db_session, tmp_path, monkeypatch
):
    from docx import Document as WordDocument
    from docx.oxml.ns import qn
    from PIL import Image

    from app.config import Settings
    from app.core.qr import barcode_payload
    from app.db.models import BookCategory, BookVersion
    from app.services import artifact_service, document_service

    db_session.add(BookCategory(id="GS", prefix="GS"))
    db_session.commit()
    settings = Settings(data_dir=tmp_path / "data", templates_dir=document_service._TEMPLATES_DIR)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(artifact_service, "get_settings", lambda: settings)
    original = artifact_service.produce_from_template
    plans = []

    def capture_plan(**kwargs):
        plans.append(kwargs["stamps"])
        return original(**kwargs)

    monkeypatch.setattr(artifact_service, "produce_from_template", capture_plan)
    result = document_service.generate_document(
        db_session,
        employee_id=None,
        template_id="General Book",
        fields={"subject": "paper date", "body": "<p>body</p>"},
        classification_code="5/1",
        converter=lambda _path: None,
    )
    version = db_session.query(BookVersion).filter_by(book_id=result.book_id).one()
    paper_date = datetime.strptime(version.fields["date"], "%d-%m-%Y").date()
    expected = barcode_payload(result.ref_number, paper_date)

    signature = tmp_path / "signature.png"
    Image.new("RGBA", (100, 40), (0, 0, 0, 0)).save(signature)
    signed = document_service.render_signed_artifact(
        db_session,
        version=version,
        signer_signature_path=str(signature),
        output_dir=tmp_path / "signed",
        converter=lambda _path: None,
    )

    def header_text(path):
        header = WordDocument(path).sections[0].first_page_header
        return "\n".join(node.text or "" for node in header.part.element.iter(qn("w:t")))

    assert header_text(result.documents[0].docx_path).count(expected) == 2
    assert header_text(signed.docx_path).count(expected) == 2
    assert version.fields["date"] == paper_date.strftime("%d-%m-%Y")
    assert all(plan.aztec_corner is None for plan in plans)
    assert all(plan.sync_general_book_footer is False for plan in plans)
