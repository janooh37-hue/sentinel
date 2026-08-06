"""Task 9 Critical — the operator's report_date/report_time must reach the
rendered paper, not generation-time datetime.now().

Scenario from the review: a night supervisor logs an incident from 23:40 on
05/08 and files the report the next morning at 07:15 on 06/08. He fills both
report_date (2026-08-05, ISO from <input type=date>) and report_time (23:40,
24h from <input type=time>). Before this fix, `_build_template_data` never
mapped these onto `today`/`weekday_ar`/`now_time` — `docx_render`'s
`_apply_context_defaults` silently filled all three from `datetime.now()`
instead, so the printed paper (06/08/2026 / الخميس / 7:15 ص) would contradict
`version.fields` (2026-08-05 / 23:40).

Goes through the real `document_service.generate_document` pipeline (not
`docx_render.render()` directly, which is what let this ship green through
seven reviews — test_inmate_violations_template.py hand-feeds `today`/
`now_time`, bypassing `_build_template_data` entirely).

`datetime.now()` is frozen (mirrors test_docx_render.py's `_Fixed` pattern)
to a value that DIFFERS from the operator's report_date/report_time, so a
pass is only possible if the rendered output genuinely comes from the
operator's fields, not the wall clock.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest
from docx import Document as DocxDocument

from app.db.models import BookCategory, Employee, Manager
from app.services import document_service

TEMPLATE_ID = "Inmate Conduct Violations"


class _FixedNow(datetime):
    """Freezes `datetime.now()` to the morning-after filing time — clearly
    different from the operator's 23:40-the-night-before report_time, so a
    pass can only happen if the paper reads from `fields`, not the clock."""

    @classmethod
    def now(cls, tz=None):
        return cls(2026, 8, 6, 7, 15)


@pytest.fixture()
def gen_env(db_session, tmp_path, monkeypatch):
    from app.config import Settings
    from app.core import docx_render

    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    # Freeze both modules' `datetime` name — document_service.py and
    # docx_render.py each import their own binding, and the bug this test
    # guards lives exactly in the gap between them (docx_render's own
    # datetime.now() is what silently fills today/weekday_ar/now_time when
    # document_service never sets them). Without freezing both, this test
    # would only be correct by real-clock coincidence, not by construction.
    monkeypatch.setattr(document_service, "datetime", _FixedNow)
    monkeypatch.setattr(docx_render, "datetime", _FixedNow)
    if db_session.get(BookCategory, "NAT") is None:
        db_session.add(BookCategory(id="NAT", prefix="NAT"))
    db_session.commit()
    return db_session


def _manager(db, tmp_path: Path) -> Manager:
    mgr = Manager(name_en="Nasser", name_ar="ناصر فاضل الساعدي", title="مدير", active=True)
    db.add(mgr)
    db.commit()
    return mgr


def _header_text(docx_path: Path) -> str:
    doc = DocxDocument(str(docx_path))
    return " ".join(c.text for c in doc.tables[1].rows[0].cells)


def _generate(db, tmp_path, **field_overrides):
    fields = {
        "reporter_id": "G-2001",
        "inmates": [{"name": "a", "nationality": "b", "wing": "c", "uid": "1", "holding_no": "2"}],
        "report_date": "2026-08-05",
        "report_time": "23:40",
        **field_overrides,
    }
    return document_service.generate_document(
        db,
        employee_id=None,
        template_id=TEMPLATE_ID,
        fields=fields,
        manager_id=_manager(db, tmp_path).id,
        submitter_id=None,
        embed_signature={"manager": False},
        commit=True,
        current_user=None,
    )


def test_operator_date_and_time_reach_the_rendered_paper(gen_env, tmp_path) -> None:
    db = gen_env
    db.add(Employee(id="G-2001", name_en="Abdullah Saif", name_ar="عبدالله سيف المنصوري"))
    db.commit()

    result = _generate(db, tmp_path)

    header = _header_text(result.docx_path)
    # The operator's own values must print...
    assert "05/08/2026" in header, header
    assert "الأربعاء" in header, header  # 2026-08-05 is a Wednesday
    assert "11:40 م" in header, header  # 23:40 -> Arabic 12h clock
    # ...not generation time (frozen at 06/08/2026 07:15 above).
    assert "06/08/2026" not in header, header
    assert "الخميس" not in header, header  # 2026-08-06's weekday
    assert "7:15 ص" not in header, header


def test_rendered_date_is_stable_across_repeat_renders_of_the_same_fields(
    gen_env, tmp_path
) -> None:
    """Preview-then-save / a revise re-render must stamp the SAME date as the
    filed original when the underlying fields are unchanged — not a fresh
    datetime.now() each time. Simulates two independent generate_document
    calls (as preview then commit, or original then revise, both do) with
    identical fields."""
    db = gen_env
    db.add(Employee(id="G-2001", name_en="Abdullah Saif", name_ar="عبدالله سيف المنصوري"))
    db.commit()

    first = _generate(db, tmp_path)
    second = _generate(db, tmp_path)

    header1 = _header_text(first.docx_path)
    header2 = _header_text(second.docx_path)
    assert "05/08/2026" in header1
    assert "05/08/2026" in header2
    assert "11:40 م" in header1
    assert "11:40 م" in header2
