from datetime import date
from types import SimpleNamespace

import pytest

from app.db.models import Employee
from app.services import settings_service
from app.services import sms_templates as st


def _employee():
    return Employee(id="G1", name_en="John Smith", name_ar="جون سميث")


def _leave():
    return SimpleNamespace(
        leave_type="Annual Leave",
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
    )


def _override(db, event, value):
    settings_service._set(db, st.OVERRIDE_PREFIX + event, value)
    db.commit()


def test_override_applies_on_next_render_and_reset_restores_default(db_session):
    event = "leave_requested"
    employee, leave = _employee(), _leave()
    default = st.render_text(event, "en", leave, employee, db=db_session)
    assert st.get_override(db_session, event) is None
    _override(db_session, event, {"en": "Updated for {name}", "ar": "تم التحديث لـ {name}"})
    assert st.render_text(event, "en", leave, employee, db=db_session) == "Updated for John Smith"
    assert st.render_text(event, "ar", leave, employee, db=db_session) == "تم التحديث لـ جون سميث"
    assert st.render_text(event, "en", leave, employee) == default
    settings_service.set_audited_setting(
        db_session,
        st.OVERRIDE_PREFIX + event,
        None,
        actor="tester",
        action="reset",
        entity_type="message_template",
        entity_id=event,
    )
    assert st.render_text(event, "en", leave, employee, db=db_session) == default


@pytest.mark.parametrize("arabic", [None, "", " \n\t "])
def test_missing_or_blank_override_falls_back_in_same_language(db_session, arabic):
    event = "leave_requested"
    override = {"en": "English override"}
    if arabic is not None:
        override["ar"] = arabic
    _override(db_session, event, override)
    assert st.template_for(db_session, event, "ar") == st.DEFAULTS[event]["ar"]
    assert st.template_for(db_session, event, "en") == "English override"
    assert st.render_text(event, "ar", _leave(), _employee(), db=db_session) == st.render_text(
        event, "ar", _leave(), _employee()
    )


def test_substitution_is_single_pass_and_does_not_evaluate_fields():
    text = "{name.__class__} {0} {name!r} {name[0]} {name} {unknown}"
    assert st.substitute(text, {"name": "literal {name}"}) == (
        "{name.__class__} {0} {name!r} {name[0]} literal {name} {unknown}"
    )
    assert st.unknown_placeholders("passport_release", text) == [
        "0",
        "name!r",
        "name.__class__",
        "name[0]",
        "unknown",
    ]
    assert st.unknown_placeholders("passport_release", "{z} {z} {a}") == ["a", "z"]
    assert st.unknown_placeholders("passport_release", "{name:{name}} {name[{name}]}") == [
        "name:",
        "name[]",
    ]


@pytest.mark.parametrize("event", st.EVENTS)
def test_defaults_are_bilingual_and_use_only_registered_placeholders(event):
    assert set(st.DEFAULTS[event]) == {"en", "ar"}
    names = [variable.name for variable in st.VARIABLES[event]]
    assert len(names) == len(set(names))
    for lang in ("ar", "en"):
        text = st.DEFAULTS[event][lang]
        assert text.strip()
        assert st.unknown_placeholders(event, text) == []
        values = st.sample_values(event, lang)
        assert set(values) == set(names)
        assert "{" not in st.substitute(text, values)
        assert all(variable.label_en and variable.label_ar for variable in st.VARIABLES[event])


@pytest.mark.parametrize("lang", ["ar", "en"])
def test_leave_amended_honours_override_and_keeps_previous_duration(db_session, lang):
    event = "leave_amended"
    employee, leave = _employee(), _leave()
    _override(
        db_session,
        event,
        {
            "en": "{name}: {old_days} -> {days}\n{duration_line}{reason_line}{reason}",
            "ar": "{name}: {old_days} -> {days}\n{duration_line}{reason_line}{reason}",
        },
    )
    reason = "Insufficient balance" if lang == "en" else "نقص الرصيد"
    expected = (
        "John Smith: 10 -> 5\nNew duration: 5 day(s) (was 10).\nReason: Insufficient balance\nInsufficient balance"
        if lang == "en"
        else "جون سميث: 10 -> 5\nالمدة الجديدة: 5 يوم (بدلاً من 10).\nسبب التعديل: نقص الرصيد\nنقص الرصيد"
    )
    assert (
        st.render_leave_amended(leave, employee, lang, old_days=10, reason=reason, db=db_session)
        == expected
    )
