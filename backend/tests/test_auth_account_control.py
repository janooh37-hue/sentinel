"""Account-control security regression: admin-created accounts, permanent
disable/restore, and the mandatory password-setup step for an admin-issued
temporary password.

Exercises the real cookie-based login/session lifecycle end-to-end (no
``get_current_user``/``require_admin`` override) so the actual auth gate —
not a test double — is what's under test.
"""

from __future__ import annotations

import itertools
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core import ratelimit, security
from app.db.models import AuthSession, Employee, User
from app.db.session import get_db
from app.main import create_app
from app.services import auth_service

API = "/api/v1/auth"

_email_seq = itertools.count(1)


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    ratelimit.login_limiter.reset()
    ratelimit.register_limiter.reset()
    yield
    ratelimit.login_limiter.reset()
    ratelimit.register_limiter.reset()


def _client(db: Session) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app, raise_server_exceptions=True)


def _seed_user(
    db: Session,
    *,
    password: str,
    email: str | None = None,
    role: str = "operator",
    status: str = "active",
    password_change_required: bool = False,
    employee_id: str | None = None,
) -> User:
    u = User(
        email=email or f"user{next(_email_seq)}@test.ae",
        password_hash=security.hash_password(password),
        role=role,
        status=status,
        password_change_required=password_change_required,
        employee_id=employee_id,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _seed_employee(db: Session, id_: str, name_en: str = "Test Employee") -> Employee:
    emp = Employee(id=id_, name_en=name_en, name_ar=name_en)
    db.add(emp)
    db.commit()
    return emp


def _login(client: TestClient, email: str, password: str):
    return client.post(f"{API}/login", json={"email": email, "password": password})


# ---------------------------------------------------------------------------
# 1. Admin account creation
# ---------------------------------------------------------------------------


def test_admin_creates_account_with_one_time_temporary_password(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    emp = _seed_employee(api_db, "GCREATE1")
    client = _client(api_db)
    _login(client, admin.email, "AdminPW-1!")

    resp = client.post(
        f"{API}/users",
        json={"email": "newop@test.ae", "employee_id": emp.id, "role": "operator"},
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["temporary_password"]
    assert body["user"]["email"] == "newop@test.ae"
    assert body["user"]["employee_id"] == emp.id
    assert body["user"]["password_change_required"] is True
    assert body["user"]["status"] == "active"

    # The admin's own identity/session is untouched by creating another account.
    me = client.get(f"{API}/me")
    assert me.status_code == 200
    assert me.json()["email"] == admin.email


def test_admin_reset_completes_password_setup_for_never_logged_in_user(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    admin_client = _client(api_db)
    _login(admin_client, admin.email, "AdminPW-1!")

    created = admin_client.post(
        f"{API}/users",
        json={"email": "ready@test.ae", "employee_id": None, "role": "operator"},
    )
    assert created.status_code == 201
    user = created.json()["user"]
    assert user["password_change_required"] is True
    assert user["last_login_at"] is None

    new_password = "ReadyPW-1!"
    reset = admin_client.post(
        f"{API}/users/{user['id']}/reset-password", json={"password": new_password}
    )
    login = _login(_client(api_db), user["email"], new_password)

    assert login.status_code == 200
    assert login.json()["email"] == user["email"]
    assert reset.status_code == 200
    assert reset.json()["password_change_required"] is False


def test_operator_cannot_create_or_disable_accounts(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    operator = _seed_user(api_db, password="OperatorPW-1!", role="operator")
    client = _client(api_db)
    _login(client, operator.email, "OperatorPW-1!")

    create_resp = client.post(
        f"{API}/users", json={"email": "x@test.ae", "employee_id": None, "role": "operator"}
    )
    disable_resp = client.post(f"{API}/users/{admin.id}/disable")

    assert create_resp.status_code == 403
    assert disable_resp.status_code == 403


def test_duplicate_normalized_email_rejected_without_creating_second_account(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    _seed_user(api_db, password="x", email="taken@test.ae")
    client = _client(api_db)
    _login(client, admin.email, "AdminPW-1!")

    resp = client.post(
        f"{API}/users",
        json={"email": "  Taken@Test.AE  ", "employee_id": None, "role": "operator"},
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "EMAIL_TAKEN"
    count = api_db.query(User).filter(User.email == "taken@test.ae").count()
    assert count == 1


def test_create_with_unknown_employee_returns_404_without_partial_creation(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    client = _client(api_db)
    _login(client, admin.email, "AdminPW-1!")

    resp = client.post(
        f"{API}/users",
        json={"email": "ghost@test.ae", "employee_id": "GNOPE", "role": "operator"},
    )

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"
    assert api_db.query(User).filter(User.email == "ghost@test.ae").count() == 0


# ---------------------------------------------------------------------------
# 2. Mandatory password setup before session/API access
# ---------------------------------------------------------------------------


def test_temporary_password_blocks_login_until_setup_is_completed(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    user, temp_pw = auth_service.create_user(
        api_db, email="setup@test.ae", employee_id=None, role="operator", actor=admin.email
    )
    client = _client(api_db)

    login_resp = _login(client, "setup@test.ae", temp_pw)
    assert login_resp.status_code == 403
    assert login_resp.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert "gssg_session" not in login_resp.cookies
    api_db.refresh(user)
    assert user.last_login_at is None

    me_resp = client.get(f"{API}/me")
    assert me_resp.status_code == 401

    # A stale/leftover AuthSession for a flagged user must not grant access
    # either — resolve_session rejects on password_change_required.
    raw = security.new_session_token()
    api_db.add(
        AuthSession(
            user_id=user.id,
            token_hash=security.hash_token(raw),
            expires_at=auth_service._utcnow() + auth_service.SESSION_TTL,
        )
    )
    api_db.commit()
    stale_client = _client(api_db)
    stale_client.cookies.set("gssg_session", raw)
    assert stale_client.get(f"{API}/me").status_code == 401

    setup_resp = client.post(
        f"{API}/complete-password-setup",
        json={
            "email": "setup@test.ae",
            "temporary_password": temp_pw,
            "new_password": "BrandNewPW-1!",
        },
    )
    assert setup_resp.status_code == 204
    assert "gssg_session" not in setup_resp.cookies

    login2 = _login(client, "setup@test.ae", "BrandNewPW-1!")
    assert login2.status_code == 200
    assert client.get(f"{API}/me").status_code == 200

    # Old temporary credentials no longer verify.
    other_client = _client(api_db)
    assert _login(other_client, "setup@test.ae", temp_pw).status_code == 401

    # A repeat setup attempt cannot overwrite the now-chosen password.
    repeat = client.post(
        f"{API}/complete-password-setup",
        json={
            "email": "setup@test.ae",
            "temporary_password": temp_pw,
            "new_password": "AnotherPW-2!",
        },
    )
    assert repeat.status_code == 401  # old temp password no longer authenticates


def test_setup_rejects_when_not_required(api_db: Session):
    user = _seed_user(api_db, password="AlreadyGood-1!")
    client = _client(api_db)

    resp = client.post(
        f"{API}/complete-password-setup",
        json={
            "email": user.email,
            "temporary_password": "AlreadyGood-1!",
            "new_password": "SomethingElse-1!",
        },
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "PASSWORD_SETUP_NOT_REQUIRED"


# ---------------------------------------------------------------------------
# 3. Wrong credentials, bcrypt-boundary replacement, and no credential leakage
# ---------------------------------------------------------------------------


def test_wrong_temporary_password_is_generic_and_locks_out(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    user, temp_pw = auth_service.create_user(
        api_db, email="wrong@test.ae", employee_id=None, role="operator", actor=admin.email
    )
    client = _client(api_db)

    for _ in range(auth_service.MAX_FAILED_ATTEMPTS):
        resp = client.post(
            f"{API}/complete-password-setup",
            json={
                "email": "wrong@test.ae",
                "temporary_password": "definitely-wrong",
                "new_password": "SomeNewPW-1!",
            },
        )
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "INVALID_CREDENTIALS"

    api_db.refresh(user)
    assert user.status == "locked"

    # Even the *correct* temporary password now reveals the lock, not a reset.
    locked_resp = client.post(
        f"{API}/complete-password-setup",
        json={"email": "wrong@test.ae", "temporary_password": temp_pw, "new_password": "X" * 10},
    )
    assert locked_resp.status_code == 403
    assert locked_resp.json()["error"]["code"] == "ACCOUNT_LOCKED"


def test_replacement_equal_to_temporary_past_bcrypt_boundary_is_rejected(api_db: Session):
    # bcrypt only considers the first 72 bytes. A "different" password that
    # shares the first 72 bytes with the temporary one hashes identically —
    # verify_password (hash-equivalence), not a string-inequality check, must
    # catch this or the owner could "change" their password to something
    # that still verifies as the old temporary one.
    temp_pw = "A" * 72 + "-old-tail"
    new_pw = "A" * 72 + "-new-tail"
    user = _seed_user(api_db, password=temp_pw, password_change_required=True)
    original_hash = user.password_hash
    client = _client(api_db)

    resp = client.post(
        f"{API}/complete-password-setup",
        json={"email": user.email, "temporary_password": temp_pw, "new_password": new_pw},
    )

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "PASSWORD_UNCHANGED"
    api_db.refresh(user)
    assert user.password_hash == original_hash
    assert user.password_change_required is True


def test_invalid_setup_body_does_not_echo_or_persist_passwords(api_db: Session):
    client = _client(api_db)
    weak_password = "sekrit9"  # 7 chars, below the 8-char minimum

    resp = client.post(
        f"{API}/complete-password-setup",
        json={
            "email": "nobody@test.ae",
            "temporary_password": "x",
            "new_password": weak_password,
        },
    )

    assert resp.status_code == 422
    raw = resp.text
    assert weak_password not in raw
    for entry in resp.json()["error"]["details"]["errors"]:
        assert "input" not in entry


# ---------------------------------------------------------------------------
# 4. A concurrent disable/reset cannot be overwritten by an in-flight setup
# ---------------------------------------------------------------------------


def test_concurrent_disable_wins_over_in_flight_password_setup(api_db: Session, monkeypatch):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    user, temp_pw = auth_service.create_user(
        api_db, email="race@test.ae", employee_id=None, role="operator", actor=admin.email
    )
    client = _client(api_db)
    real_hash_password = security.hash_password

    def _hash_after_concurrent_disable(password: str) -> str:
        other = Session(bind=api_db.get_bind())
        try:
            auth_service.set_status(other, user.id, "disabled", actor="concurrent-admin")
        finally:
            other.close()
        return real_hash_password(password)

    monkeypatch.setattr(security, "hash_password", _hash_after_concurrent_disable)

    resp = client.post(
        f"{API}/complete-password-setup",
        json={
            "email": "race@test.ae",
            "temporary_password": temp_pw,
            "new_password": "RaceNewPW-1!",
        },
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "PASSWORD_SETUP_CHANGED"
    api_db.refresh(user)
    assert user.status == "disabled"
    assert security.verify_password(temp_pw, user.password_hash)
    assert user.password_change_required is True


# ---------------------------------------------------------------------------
# 5. Disable/restore session lifecycle, lockout recovery, last-admin guard
# ---------------------------------------------------------------------------


def test_disable_revokes_session_and_blocks_login_even_after_lockout_window(
    api_db: Session, monkeypatch
):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    admin_client = _client(api_db)
    _login(admin_client, admin.email, "AdminPW-1!")

    user, temp_pw = auth_service.create_user(
        api_db, email="lifecycle@test.ae", employee_id=None, role="operator", actor=admin.email
    )
    setup_client = _client(api_db)
    setup_client.post(
        f"{API}/complete-password-setup",
        json={
            "email": "lifecycle@test.ae",
            "temporary_password": temp_pw,
            "new_password": "SetupPW-1!",
        },
    )
    _login(setup_client, "lifecycle@test.ae", "SetupPW-1!")
    assert setup_client.get(f"{API}/me").status_code == 200

    disable_resp = admin_client.post(f"{API}/users/{user.id}/disable")
    assert disable_resp.status_code == 200
    assert disable_resp.json()["status"] == "disabled"

    # The old cookie is dead immediately.
    assert setup_client.get(f"{API}/me").status_code == 401

    # Simulate the automatic-lockout window elapsing — disable has no timer,
    # so this must still refuse a correct-password login.
    future = datetime.now(UTC).replace(tzinfo=None) + timedelta(
        minutes=auth_service.LOCKOUT_MINUTES + 5
    )
    monkeypatch.setattr(auth_service, "_utcnow", lambda: future)
    still_blocked = _login(_client(api_db), "lifecycle@test.ae", "SetupPW-1!")
    assert still_blocked.status_code == 403
    assert still_blocked.json()["error"]["code"] == "ACCOUNT_DISABLED"
    monkeypatch.undo()

    # Resetting the password does not reactivate a disabled account.
    reset_resp = admin_client.post(
        f"{API}/users/{user.id}/reset-password", json={"password": "ResetPW-1!"}
    )
    assert reset_resp.status_code == 200
    assert reset_resp.json()["status"] == "disabled"
    still_disabled = _login(_client(api_db), "lifecycle@test.ae", "ResetPW-1!")
    assert still_disabled.status_code == 403
    assert still_disabled.json()["error"]["code"] == "ACCOUNT_DISABLED"

    # Explicit restore permits a fresh login, but never revives the old cookie.
    restore_resp = admin_client.post(f"{API}/users/{user.id}/unlock")
    assert restore_resp.status_code == 200
    assert restore_resp.json()["status"] == "active"
    assert setup_client.get(f"{API}/me").status_code == 401  # old cookie stays dead

    fresh_client = _client(api_db)
    assert _login(fresh_client, "lifecycle@test.ae", "ResetPW-1!").status_code == 200
    assert fresh_client.get(f"{API}/me").status_code == 200


def test_automatic_bad_password_lockout_recovers_after_its_window(api_db: Session, monkeypatch):
    user = _seed_user(api_db, password="GoodPW-1!")
    client = _client(api_db)

    for _ in range(auth_service.MAX_FAILED_ATTEMPTS):
        _login(client, user.email, "wrong-password")
    api_db.refresh(user)
    assert user.status == "locked"

    future = datetime.now(UTC).replace(tzinfo=None) + timedelta(
        minutes=auth_service.LOCKOUT_MINUTES + 5
    )
    monkeypatch.setattr(auth_service, "_utcnow", lambda: future)

    recovered = _login(_client(api_db), user.email, "GoodPW-1!")
    assert recovered.status_code == 200


def test_disabling_the_only_active_admin_is_refused(api_db: Session):
    admin = _seed_user(api_db, password="SoleAdminPW-1!", role="admin")
    client = _client(api_db)
    _login(client, admin.email, "SoleAdminPW-1!")

    resp = client.post(f"{API}/users/{admin.id}/disable")

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LAST_ADMIN"
    assert client.get(f"{API}/me").status_code == 200


# ---------------------------------------------------------------------------
# 6. Approval requires a deliberate, explicit employee-link decision
# ---------------------------------------------------------------------------


def test_approve_applies_the_administrator_selected_employee(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    claimed = _seed_employee(api_db, "GCLAIM1", "Self Claimed")
    correct = _seed_employee(api_db, "GCORRECT", "Actually Them")
    pending = _seed_user(api_db, password="PendingPW-1!", status="pending", employee_id=claimed.id)
    client = _client(api_db)
    _login(client, admin.email, "AdminPW-1!")

    resp = client.post(
        f"{API}/users/{pending.id}/approve",
        json={"role": "operator", "employee_id": correct.id},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["employee_id"] == correct.id
    assert body["status"] == "active"


def test_approve_with_explicit_null_clears_self_claim(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    claimed = _seed_employee(api_db, "GCLAIM2", "Self Claimed")
    pending = _seed_user(api_db, password="PendingPW-1!", status="pending", employee_id=claimed.id)
    client = _client(api_db)
    _login(client, admin.email, "AdminPW-1!")

    resp = client.post(
        f"{API}/users/{pending.id}/approve", json={"role": "operator", "employee_id": None}
    )

    assert resp.status_code == 200
    assert resp.json()["employee_id"] is None


def test_approve_requires_the_employee_key_and_rejects_unknown_employee(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    pending = _seed_user(api_db, password="PendingPW-1!", status="pending")
    client = _client(api_db)
    _login(client, admin.email, "AdminPW-1!")

    missing_key = client.post(f"{API}/users/{pending.id}/approve", json={"role": "operator"})
    assert missing_key.status_code == 422

    unknown = client.post(
        f"{API}/users/{pending.id}/approve",
        json={"role": "operator", "employee_id": "GHOSTX"},
    )
    assert unknown.status_code == 404
    api_db.refresh(pending)
    assert pending.status == "pending"
    assert pending.employee_id is None


def test_approve_and_reject_refuse_non_pending_accounts(api_db: Session):
    admin = _seed_user(api_db, password="AdminPW-1!", role="admin")
    active_user = _seed_user(api_db, password="ActivePW-1!", status="active")
    disabled_user = _seed_user(api_db, password="DisabledPW-1!", status="disabled")
    client = _client(api_db)
    _login(client, admin.email, "AdminPW-1!")

    approve_active = client.post(
        f"{API}/users/{active_user.id}/approve",
        json={"role": "operator", "employee_id": None},
    )
    reject_disabled = client.post(f"{API}/users/{disabled_user.id}/reject", json={})

    assert approve_active.status_code == 409
    assert approve_active.json()["error"]["code"] == "INVALID_ACCOUNT_STATE"
    assert reject_disabled.status_code == 409
    assert reject_disabled.json()["error"]["code"] == "INVALID_ACCOUNT_STATE"
