"""The daily scheduled-departure flip worker.

Mirrors test_scheduler_leave_ending.py: the job is a thin wrapper, so these
tests assert delegation and error containment, not the flip logic itself
(covered in test_employee_pending_departure.py).
"""

import contextlib
from types import SimpleNamespace

from app.services import scheduler_service as sched


def _fake_session(monkeypatch):
    dummy = SimpleNamespace()

    @contextlib.contextmanager
    def _fake_session_local():
        yield dummy

    monkeypatch.setattr(sched, "SessionLocal", _fake_session_local)
    return dummy


def test_flip_job_calls_the_service(monkeypatch):
    _fake_session(monkeypatch)
    calls = {"n": 0}

    def fake_apply(db, **kw):
        calls["n"] += 1
        return []

    monkeypatch.setattr(sched.employee_service, "apply_due_departures", fake_apply)
    sched._run_pending_departure_flip()
    assert calls["n"] == 1


def test_flip_job_notifies_admins_for_each_flip(monkeypatch):
    _fake_session(monkeypatch)
    moved = [
        SimpleNamespace(id="G9400", name_en="A", name_ar=None, status="Resigned"),
        SimpleNamespace(id="G9401", name_en="B", name_ar=None, status="Terminated"),
    ]
    monkeypatch.setattr(sched.employee_service, "apply_due_departures", lambda db, **kw: moved)
    monkeypatch.setattr(sched.admin_notify, "active_admins", lambda db: [SimpleNamespace(id=1)])
    sent: list[tuple[int, dict, str]] = []
    monkeypatch.setattr(
        sched.push_service,
        "send_to_user",
        lambda db, uid, messages, url: sent.append((uid, messages, url)),
    )

    sched._run_pending_departure_flip()

    assert len(sent) == 2
    for _uid, messages, url in sent:
        assert set(messages) == {"en", "ar"}, "bilingual parity"
        assert url.startswith("/employees/")
    # Arabic body must be Arabic, not an English leak.
    ar_bodies = [m["ar"][1] for _u, m, _url in sent]
    assert any("مستقيل" in b for b in ar_bodies)
    assert any("مفصول" in b for b in ar_bodies)


def test_flip_job_skips_an_unexpected_status_instead_of_guessing(monkeypatch):
    """An unmapped status must produce no notice — never a "Terminated" fallback.

    The old wording was `"مستقيل" if status == "Resigned" else "مفصول"`, so any
    third status silently announced a real employee as dismissed.
    """
    _fake_session(monkeypatch)
    monkeypatch.setattr(
        sched.employee_service,
        "apply_due_departures",
        lambda db, **kw: [
            SimpleNamespace(id="G9403", name_en="D", name_ar=None, status="Suspended"),
            SimpleNamespace(id="G9404", name_en="E", name_ar=None, status="Resigned"),
        ],
    )
    monkeypatch.setattr(sched.admin_notify, "active_admins", lambda db: [SimpleNamespace(id=1)])
    sent: list[dict] = []
    monkeypatch.setattr(
        sched.push_service,
        "send_to_user",
        lambda db, uid, messages, url: sent.append(messages),
    )

    sched._run_pending_departure_flip()

    assert len(sent) == 1, "only the mapped status is announced"
    assert "G9404" in sent[0]["en"][1]
    bodies = sent[0]["en"][1] + sent[0]["ar"][1]
    assert "G9403" not in bodies
    assert "مفصول" not in bodies and "Terminated" not in bodies


def test_arabic_body_isolates_the_latin_id(monkeypatch):
    """A G-number parenthesised inside Arabic flips without a bidi isolate."""
    _fake_session(monkeypatch)
    monkeypatch.setattr(
        sched.employee_service,
        "apply_due_departures",
        lambda db, **kw: [
            SimpleNamespace(id="G9405", name_en="Latin Name", name_ar=None, status="Resigned")
        ],
    )
    monkeypatch.setattr(sched.admin_notify, "active_admins", lambda db: [SimpleNamespace(id=1)])
    sent: list[dict] = []
    monkeypatch.setattr(
        sched.push_service,
        "send_to_user",
        lambda db, uid, messages, url: sent.append(messages),
    )

    sched._run_pending_departure_flip()

    ar = sent[0]["ar"][1]
    assert "⁦(G9405)⁩" in ar, "id + its parens isolated as one LTR run"
    assert "⁦Latin Name⁩" in ar, "name_ar fell back to Latin, must be isolated"
    # The English body is pure LTR and needs no isolates.
    assert "⁦" not in sent[0]["en"][1]


def test_flip_job_swallows_service_errors(monkeypatch):
    _fake_session(monkeypatch)

    def boom(db, **kw):
        raise RuntimeError("db locked")

    monkeypatch.setattr(sched.employee_service, "apply_due_departures", boom)
    sched._run_pending_departure_flip()  # must not raise


def test_flip_job_swallows_notification_errors(monkeypatch):
    """A push failure must not roll back or hide a completed flip."""
    _fake_session(monkeypatch)
    monkeypatch.setattr(
        sched.employee_service,
        "apply_due_departures",
        lambda db, **kw: [
            SimpleNamespace(id="G9402", name_en="C", name_ar=None, status="Resigned")
        ],
    )
    monkeypatch.setattr(sched.admin_notify, "active_admins", lambda db: [SimpleNamespace(id=1)])

    def boom(db, uid, messages, url):
        raise RuntimeError("push gateway down")

    monkeypatch.setattr(sched.push_service, "send_to_user", boom)
    sched._run_pending_departure_flip()  # must not raise
