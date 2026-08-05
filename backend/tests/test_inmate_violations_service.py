"""Inmate Conduct Violations — reporter/manager/footer token assembly."""

from __future__ import annotations

from app.db.models import Employee, Manager
from app.services.document_service import _build_template_data
from tests.conftest import make_user

TEMPLATE_ID = "Inmate Conduct Violations"


def _employee(db, **kw) -> Employee:
    emp = Employee(
        id=kw.pop("id", "G-2001"),
        name_en=kw.pop("name_en", "Abdullah Saif"),
        name_ar=kw.pop("name_ar", "عبدالله سيف المنصوري"),
        **kw,
    )
    db.add(emp)
    db.commit()
    return emp


def test_reporter_resolves_to_arabic_name_and_g_number(db_session) -> None:
    _employee(db_session)
    data = _build_template_data(
        db_session,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields={"reporter_id": "G-2001"},
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    assert data["reporter_name"] == "عبدالله سيف المنصوري"
    assert data["reporter_g"] == "G-2001"


def test_reporter_falls_back_to_english_when_no_arabic_name(db_session) -> None:
    _employee(db_session, id="G-1190", name_ar=None, name_en="Ahmed Al Hammadi")
    data = _build_template_data(
        db_session,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields={"reporter_id": "G-1190"},
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    assert data["reporter_name"] == "Ahmed Al Hammadi"


def test_unknown_reporter_renders_blank_not_crash(db_session) -> None:
    data = _build_template_data(
        db_session,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields={"reporter_id": "G-9999"},
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    assert data["reporter_name"] == ""
    assert data["reporter_g"] == ""


def test_footer_carries_the_signed_in_account_not_the_reporter(db_session) -> None:
    _employee(db_session)
    # User.employee_id is a real FK to employees.id — the account needs its
    # own Employee row (distinct from the reporter's) before it can be linked.
    _employee(db_session, id="G-0312", name_en="Ops Account", name_ar="حساب العمليات")
    account = make_user(db_session, email="ops@test.ae")
    account.employee_id = "G-0312"
    db_session.commit()
    data = _build_template_data(
        db_session,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields={"reporter_id": "G-2001"},
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=account,
    )
    # Footer = the account that generated the document; the reporter is separate.
    assert data["submitter_g"] == "G-0312"
    assert data["reporter_g"] == "G-2001"


def test_manager_name_renders_in_arabic(db_session) -> None:
    mgr = Manager(
        name_en="Nasser Fadhel Al Saedi",
        name_ar="ناصر فاضل الساعدي",
        title="مدير فرع شؤون النزلاء",
        active=True,
    )
    db_session.add(mgr)
    db_session.commit()
    data = _build_template_data(
        db_session,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields={},
        manager_id=mgr.id,
        submitter_id=None,
        embed_signature={"manager": True},
        current_user=None,
    )
    # An English name on an Arabic paper is the #1 recurring defect here.
    assert data["manager_name"] == "ناصر فاضل الساعدي"


def _actions(db, **fields) -> list[str]:
    data = _build_template_data(
        db,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields=fields,
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    return data["actions"]


def test_only_ticked_actions_render(db_session) -> None:
    assert _actions(db_session, action_notified=True, action_transferred=True) == [
        "تم ابلاغ مدير فرع شؤون النزلاء",
        "تم نقل النزيل الى قسم B وتقييده",
    ]


def test_actions_keep_paper_order_regardless_of_input_order(db_session) -> None:
    assert _actions(db_session, action_transferred=True, action_written=True) == [
        "تم كتابة مخالفة مسلكية في حق النزلاء",
        "تم نقل النزيل الى قسم B وتقييده",
    ]


def test_all_actions_render_in_declared_order_regardless_of_input_order(
    db_session,
) -> None:
    # Ticks all three out of paper order plus a custom entry — the only
    # assertion that pins every pairwise position in _INMATE_ACTION_LABELS
    # (the two-key tests above don't constrain notified vs. written relative
    # to each other).
    assert _actions(
        db_session,
        action_transferred=True,
        action_written=True,
        action_notified=True,
        action_other="تم إبلاغ الطبيب المناوب",
    ) == [
        "تم ابلاغ مدير فرع شؤون النزلاء",
        "تم كتابة مخالفة مسلكية في حق النزلاء",
        "تم نقل النزيل الى قسم B وتقييده",
        "تم إبلاغ الطبيب المناوب",
    ]


def test_custom_action_appends_last(db_session) -> None:
    assert _actions(db_session, action_notified=True, action_other="تم إبلاغ الطبيب المناوب") == [
        "تم ابلاغ مدير فرع شؤون النزلاء",
        "تم إبلاغ الطبيب المناوب",
    ]


def test_blank_custom_action_is_dropped(db_session) -> None:
    assert _actions(db_session, action_notified=True, action_other="   ") == [
        "تم ابلاغ مدير فرع شؤون النزلاء"
    ]


def test_no_actions_ticked_yields_empty_list(db_session) -> None:
    assert _actions(db_session) == []
