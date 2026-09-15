"""Email verification + self-service password reset — API and unit coverage.

Covers: register/login/approve gating on ``email_verified_at``, the public
verify/reset link routes, ``account_token_service`` claim atomicity, the
Graph mailer transport, and the bilingual mail templates. The
``GSSG_ACCOUNT_MAIL_ENABLED`` flag is off by default (real ``Settings()``),
so every test that needs the feature on explicitly monkeypatches
``get_settings`` in both ``auth_service`` and the ``auth`` route module —
mirroring the pattern in ``test_book_template_routes_m4.py`` etc.
"""

from __future__ import annotations

import re
import threading
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.v1 import auth as auth_api
from app.config import Settings
from app.core import ratelimit
from app.db import session as session_mod
from app.db.models import AccountEmailToken, AuditLog, AuthSession, User
from app.db.session import get_db
from app.main import create_app
from app.services import account_mail_templates, account_mailer, account_token_service, auth_service


@pytest.fixture(autouse=True)
def _reset_rate_limiters() -> None:
    """These limiters are process-wide singletons; without a reset, hits from
    an earlier test in the same session bleed into this one (TestClient always
    reports the same client IP)."""
    for limiter in (
        ratelimit.login_limiter,
        ratelimit.register_limiter,
        ratelimit.email_verify_limiter,
        ratelimit.password_reset_limiter,
        ratelimit.email_address_limiter,
    ):
        limiter.reset()


COOKIE = "gssg_session"


def _mail_settings(**overrides: object) -> Settings:
    return Settings(
        account_mail_enabled=True,
        microsoft_tenant_id="tenant-1",
        microsoft_client_id="client-1",
        microsoft_client_secret="secret-1",
        account_mail_link_base_url="https://gssg.app",
        **overrides,  # type: ignore[arg-type]
    )


def _off_settings() -> Settings:
    return Settings(account_mail_enabled=False)


class _MailRecorder:
    def __init__(self) -> None:
        self.verify_calls: list[dict[str, str]] = []
        self.reset_calls: list[dict[str, str]] = []
        self.raise_next = False

    def send_verification_email(self, *, recipient: str, raw_token: str, locale: str) -> None:
        if self.raise_next:
            self.raise_next = False
            raise account_mailer.AccountMailError(500, "req-fail")
        self.verify_calls.append({"recipient": recipient, "raw_token": raw_token, "locale": locale})

    def send_password_reset_email(self, *, recipient: str, raw_token: str, locale: str) -> None:
        if self.raise_next:
            self.raise_next = False
            raise account_mailer.AccountMailError(500, "req-fail")
        self.reset_calls.append({"recipient": recipient, "raw_token": raw_token, "locale": locale})


@pytest.fixture()
def mail_recorder(monkeypatch: pytest.MonkeyPatch) -> _MailRecorder:
    rec = _MailRecorder()
    monkeypatch.setattr(account_mailer, "send_verification_email", rec.send_verification_email)
    monkeypatch.setattr(account_mailer, "send_password_reset_email", rec.send_password_reset_email)
    return rec


@pytest.fixture()
def mail_on(monkeypatch: pytest.MonkeyPatch) -> Settings:
    settings = _mail_settings()
    monkeypatch.setattr(auth_service, "get_settings", lambda: settings)
    monkeypatch.setattr(auth_api, "get_settings", lambda: settings)
    return settings


@pytest.fixture()
def mail_off(monkeypatch: pytest.MonkeyPatch) -> Settings:
    settings = _off_settings()
    monkeypatch.setattr(auth_service, "get_settings", lambda: settings)
    monkeypatch.setattr(auth_api, "get_settings", lambda: settings)
    return settings


def _client(db: Session, user: User | None = None) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _make_user(
    db: Session,
    *,
    email: str,
    role: str = "operator",
    status: str = "pending",
    verified: bool = False,
    password: str = "correct-horse-1",
) -> User:
    from app.core import security

    u = User(
        email=email,
        password_hash=security.hash_password(password),
        role=role,
        status=status,
        email_verified_at=auth_service._utcnow() if verified else None,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


# ─── register ────────────────────────────────────────────────────────────────


def test_register_sends_verification_and_sets_no_session(
    api_db: Session, mail_on: Settings, mail_recorder: _MailRecorder
) -> None:
    # Seed an existing active admin so this registration is not "first".
    _make_user(api_db, email="admin@x.ae", role="admin", status="active", verified=True)
    client = _client(api_db)

    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "newbie@x.ae", "password": "password123", "locale": "en"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "verify_email", "is_first": False, "user": None}
    assert COOKIE not in resp.cookies
    assert len(mail_recorder.verify_calls) == 1
    assert mail_recorder.verify_calls[0]["recipient"] == "newbie@x.ae"


def test_first_account_register_also_requires_verification(
    api_db: Session, mail_on: Settings, mail_recorder: _MailRecorder
) -> None:
    client = _client(api_db)

    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "firstadmin@x.ae", "password": "password123", "locale": "en"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "verify_email"
    assert body["is_first"] is True
    assert body["user"] is None
    assert COOKIE not in resp.cookies
    assert len(mail_recorder.verify_calls) == 1


def test_flag_off_register_is_unchanged(api_db: Session, mail_off: Settings) -> None:
    # Seed an existing admin so this registration is not "first" (which would
    # auto-activate regardless of the flag — unrelated to this feature).
    _make_user(api_db, email="existing-admin@x.ae", role="admin", status="active", verified=True)
    client = _client(api_db)

    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "legacy@x.ae", "password": "password123"},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


# ─── login gating ───────────────────────────────────────────────────────────


def test_login_before_verification_is_blocked(api_db: Session, mail_on: Settings) -> None:
    _make_user(api_db, email="unverified@x.ae", status="active", verified=False)
    client = _client(api_db)

    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "unverified@x.ae", "password": "correct-horse-1"},
    )

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "ACCOUNT_EMAIL_UNVERIFIED"


def test_login_wrong_password_is_unchanged(api_db: Session, mail_on: Settings) -> None:
    _make_user(api_db, email="unverified2@x.ae", status="active", verified=False)
    client = _client(api_db)

    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "unverified2@x.ae", "password": "totally-wrong"},
    )

    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_flag_off_login_of_unverified_active_user_succeeds(
    api_db: Session, mail_off: Settings
) -> None:
    _make_user(api_db, email="legacyuser@x.ae", status="active", verified=False)
    client = _client(api_db)

    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "legacyuser@x.ae", "password": "correct-horse-1"},
    )

    assert resp.status_code == 200
    assert COOKIE in resp.cookies


# ─── approve gating + verify-email consumption ─────────────────────────────


def test_approve_blocked_until_verified_then_full_cycle(api_db: Session, mail_on: Settings) -> None:
    admin = _make_user(api_db, email="admin2@x.ae", role="admin", status="active", verified=True)
    pending = _make_user(api_db, email="pending2@x.ae", status="pending", verified=False)
    raw = account_token_service.issue(api_db, pending, account_token_service.PURPOSE_VERIFY)

    admin_client = _client(api_db, admin)
    approve_resp = admin_client.post(
        f"/api/v1/auth/users/{pending.id}/approve", json={"role": "operator"}
    )
    assert approve_resp.status_code == 409
    assert approve_resp.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"

    listed = admin_client.get("/api/v1/auth/users").json()
    row = next(u for u in listed if u["id"] == pending.id)
    assert row["email_verified_at"] is None

    anon_client = _client(api_db)
    verify_resp = anon_client.post("/api/v1/auth/verify-email", json={"token": raw})
    assert verify_resp.status_code == 200
    assert verify_resp.json() == {"status": "verified"}

    # Reused token → invalid.
    reuse_resp = anon_client.post("/api/v1/auth/verify-email", json={"token": raw})
    assert reuse_resp.status_code == 400
    assert reuse_resp.json()["error"]["code"] == "EMAIL_LINK_INVALID"

    approve_resp2 = admin_client.post(
        f"/api/v1/auth/users/{pending.id}/approve", json={"role": "operator"}
    )
    assert approve_resp2.status_code == 200

    login_resp = anon_client.post(
        "/api/v1/auth/login",
        json={"email": "pending2@x.ae", "password": "correct-horse-1"},
    )
    assert login_resp.status_code == 200
    assert COOKIE in login_resp.cookies


def test_flag_off_approve_succeeds_without_verification(
    api_db: Session, mail_off: Settings
) -> None:
    admin = _make_user(api_db, email="admin3@x.ae", role="admin", status="active", verified=True)
    pending = _make_user(api_db, email="pending3@x.ae", status="pending", verified=False)
    admin_client = _client(api_db, admin)

    resp = admin_client.post(f"/api/v1/auth/users/{pending.id}/approve", json={"role": "operator"})

    assert resp.status_code == 200


# ─── request routes: no enumeration, rate limiting ─────────────────────────


def test_link_requests_are_silent_and_generic(
    api_db: Session, mail_on: Settings, mail_recorder: _MailRecorder
) -> None:
    unverified = _make_user(api_db, email="stillpending@x.ae", status="pending", verified=False)
    disabled = _make_user(api_db, email="disableduser@x.ae", status="disabled", verified=True)
    client = _client(api_db)

    # Unknown address: always 202, never a mail.
    resp = client.post(
        "/api/v1/auth/verify-email/request", json={"email": "unknown@x.ae", "locale": "en"}
    )
    assert resp.status_code == 202
    assert mail_recorder.verify_calls == []

    # An unverified pending user IS eligible to re-request their own verify link.
    resp = client.post(
        "/api/v1/auth/verify-email/request", json={"email": unverified.email, "locale": "en"}
    )
    assert resp.status_code == 202
    assert len(mail_recorder.verify_calls) == 1

    # Reset requests: unknown, disabled, and not-yet-verified are all ineligible.
    for email in ("unknown@x.ae", disabled.email, unverified.email):
        resp = client.post(
            "/api/v1/auth/password-reset/request", json={"email": email, "locale": "en"}
        )
        assert resp.status_code == 202
    assert mail_recorder.reset_calls == []


def test_email_address_rate_limit_returns_202_with_no_mail_on_fourth_request(
    api_db: Session, mail_on: Settings, mail_recorder: _MailRecorder
) -> None:
    user = _make_user(api_db, email="ratelimited@x.ae", status="pending", verified=False)
    client = _client(api_db)

    for _ in range(3):
        resp = client.post(
            "/api/v1/auth/verify-email/request", json={"email": user.email, "locale": "en"}
        )
        assert resp.status_code == 202
    assert len(mail_recorder.verify_calls) == 3

    fourth = client.post(
        "/api/v1/auth/verify-email/request", json={"email": user.email, "locale": "en"}
    )
    assert fourth.status_code == 202
    assert len(mail_recorder.verify_calls) == 3  # unchanged — 4th was silently dropped


def test_flag_off_verify_email_request_returns_503(api_db: Session, mail_off: Settings) -> None:
    client = _client(api_db)

    resp = client.post(
        "/api/v1/auth/verify-email/request", json={"email": "x@x.ae", "locale": "en"}
    )

    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "ACCOUNT_MAIL_DISABLED"


def test_features_endpoint_reflects_flag(api_db: Session, mail_on: Settings) -> None:
    client = _client(api_db)
    assert client.get("/api/v1/auth/features").json() == {"account_mail": True}


def test_flag_off_features_endpoint(api_db: Session, mail_off: Settings) -> None:
    client = _client(api_db)
    assert client.get("/api/v1/auth/features").json() == {"account_mail": False}


# ─── password reset ─────────────────────────────────────────────────────────


def test_password_reset_full_flow(
    api_db: Session, mail_on: Settings, mail_recorder: _MailRecorder
) -> None:
    user = _make_user(api_db, email="reset-me@x.ae", status="active", verified=True)
    client = _client(api_db)

    # A signed-in browser holds a live cookie before the reset.
    login_resp = client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": "correct-horse-1"}
    )
    assert login_resp.status_code == 200
    old_cookie = login_resp.cookies.get(COOKIE)
    assert old_cookie

    first = client.post(
        "/api/v1/auth/password-reset/request", json={"email": user.email, "locale": "en"}
    )
    assert first.status_code == 202
    assert len(mail_recorder.reset_calls) == 1
    first_token = mail_recorder.reset_calls[0]["raw_token"]

    second = client.post(
        "/api/v1/auth/password-reset/request", json={"email": user.email, "locale": "en"}
    )
    assert second.status_code == 202
    assert len(mail_recorder.reset_calls) == 2
    second_token = mail_recorder.reset_calls[1]["raw_token"]

    # The first token was invalidated when the second was issued.
    stale = client.post(
        "/api/v1/auth/password-reset/complete",
        json={
            "token": first_token,
            "password": "new-password-1",
            "password_confirmation": "new-password-1",
        },
    )
    assert stale.status_code == 400
    assert stale.json()["error"]["code"] == "PASSWORD_RESET_LINK_INVALID"

    mismatch = client.post(
        "/api/v1/auth/password-reset/complete",
        json={
            "token": second_token,
            "password": "new-password-1",
            "password_confirmation": "does-not-match",
        },
    )
    assert mismatch.status_code == 422

    complete = client.post(
        "/api/v1/auth/password-reset/complete",
        json={
            "token": second_token,
            "password": "new-password-1",
            "password_confirmation": "new-password-1",
        },
    )
    assert complete.status_code == 200
    assert complete.json() == {"status": "reset"}
    # The response instructs the browser to drop its cookie.
    assert complete.cookies.get(COOKIE) is None

    # Old password no longer works; new one does.
    old_pw_resp = client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": "correct-horse-1"}
    )
    assert old_pw_resp.status_code == 401

    new_pw_resp = client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": "new-password-1"}
    )
    assert new_pw_resp.status_code == 200

    # The pre-reset session cookie is dead even if a client still presents it.
    me_with_old_cookie = client.get("/api/v1/auth/me", cookies={COOKIE: old_cookie})
    assert me_with_old_cookie.status_code == 401

    api_db.refresh(user)
    assert user.status == "active"
    audit_row = (
        api_db.execute(
            select(AuditLog)
            .where(AuditLog.entity_id == str(user.id), AuditLog.action == "reset_password")
            .order_by(AuditLog.id.desc())
        )
        .scalars()
        .first()
    )
    assert audit_row is not None
    assert audit_row.actor == "self-service"


def test_admin_password_reset_invalidates_emailed_reset_links_and_live_sessions(
    api_db: Session, mail_on: Settings
) -> None:
    from app.core import security

    admin = _make_user(
        api_db,
        email="reset-admin@x.ae",
        role="admin",
        status="active",
        verified=True,
    )
    user = _make_user(
        api_db,
        email="admin-reset-target@x.ae",
        status="active",
        verified=True,
    )
    reset_token = account_token_service.issue(api_db, user, account_token_service.PURPOSE_RESET)
    verification_token = account_token_service.issue(
        api_db, user, account_token_service.PURPOSE_VERIFY
    )
    session_token = auth_service.start_session(api_db, user)

    client = _client(api_db, admin)
    response = client.post(
        f"/api/v1/auth/users/{user.id}/reset-password",
        json={"password": "admin-chosen-2"},
    )

    assert response.status_code == 200
    stale_link = client.post(
        "/api/v1/auth/password-reset/complete",
        json={
            "token": reset_token,
            "password": "link-overwrite-3",
            "password_confirmation": "link-overwrite-3",
        },
    )
    assert stale_link.status_code == 400
    assert stale_link.json()["error"]["code"] == "PASSWORD_RESET_LINK_INVALID"

    api_db.expire_all()
    reset_row = api_db.scalar(
        select(AccountEmailToken).where(
            AccountEmailToken.token_hash == security.hash_token(reset_token)
        )
    )
    verification_row = api_db.scalar(
        select(AccountEmailToken).where(
            AccountEmailToken.token_hash == security.hash_token(verification_token)
        )
    )
    session_row = api_db.scalar(
        select(AuthSession).where(AuthSession.token_hash == security.hash_token(session_token))
    )
    stored_user = api_db.get(User, user.id)
    assert reset_row is not None and reset_row.used_at is not None
    assert verification_row is not None and verification_row.used_at is None
    assert session_row is not None and session_row.revoked is True
    assert stored_user is not None
    assert security.verify_password("admin-chosen-2", stored_user.password_hash)

    audit_row = api_db.scalar(
        select(AuditLog)
        .where(
            AuditLog.entity_id == str(user.id),
            AuditLog.action == "reset_password",
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_row is not None
    assert audit_row.actor == admin.email


def test_password_reset_rolls_back_if_session_revocation_fails(
    api_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core import security

    user = _make_user(
        api_db,
        email="rollback-reset@x.ae",
        status="active",
        verified=True,
    )
    reset_token = account_token_service.issue(api_db, user, account_token_service.PURPOSE_RESET)
    session_token = auth_service.start_session(api_db, user)
    real_execute = api_db.execute

    def fail_session_revoke(statement: object, *args: object, **kwargs: object) -> object:
        table = getattr(statement, "table", None)
        if getattr(table, "name", None) == "auth_sessions":
            raise RuntimeError("session revocation failed")
        return real_execute(statement, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(api_db, "execute", fail_session_revoke)
    with pytest.raises(RuntimeError, match="session revocation failed"):
        auth_service.complete_password_reset(api_db, reset_token, "should-not-stick-2")
    api_db.rollback()
    monkeypatch.setattr(api_db, "execute", real_execute)
    api_db.expire_all()

    token_row = api_db.scalar(
        select(AccountEmailToken).where(
            AccountEmailToken.token_hash == security.hash_token(reset_token)
        )
    )
    session_row = api_db.scalar(
        select(AuthSession).where(AuthSession.token_hash == security.hash_token(session_token))
    )
    stored_user = api_db.get(User, user.id)
    reset_audit = api_db.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == str(user.id),
            AuditLog.action == "reset_password",
        )
    )
    assert token_row is not None and token_row.used_at is None
    assert session_row is not None and session_row.revoked is False
    assert stored_user is not None
    assert security.verify_password("correct-horse-1", stored_user.password_hash)
    assert not security.verify_password("should-not-stick-2", stored_user.password_hash)
    assert reset_audit is None


def test_flag_off_rejects_existing_link_completion_without_consuming_tokens(
    api_db: Session, mail_off: Settings
) -> None:
    from app.core import security

    user = _make_user(
        api_db,
        email="mail-disabled-links@x.ae",
        status="active",
        verified=True,
    )
    verification_token = account_token_service.issue(
        api_db, user, account_token_service.PURPOSE_VERIFY
    )
    reset_token = account_token_service.issue(api_db, user, account_token_service.PURPOSE_RESET)
    client = _client(api_db)

    verify_response = client.post(
        "/api/v1/auth/verify-email",
        json={"token": verification_token},
    )
    reset_response = client.post(
        "/api/v1/auth/password-reset/complete",
        json={
            "token": reset_token,
            "password": "disabled-reset-2",
            "password_confirmation": "disabled-reset-2",
        },
    )

    assert verify_response.status_code == 503
    assert verify_response.json()["error"]["code"] == "ACCOUNT_MAIL_DISABLED"
    assert reset_response.status_code == 503
    assert reset_response.json()["error"]["code"] == "ACCOUNT_MAIL_DISABLED"
    api_db.expire_all()
    rows = {
        row.purpose: row
        for row in api_db.scalars(
            select(AccountEmailToken).where(AccountEmailToken.user_id == user.id)
        )
    }
    assert rows[account_token_service.PURPOSE_VERIFY].used_at is None
    assert rows[account_token_service.PURPOSE_RESET].used_at is None
    stored_user = api_db.get(User, user.id)
    assert stored_user is not None
    assert security.verify_password("correct-horse-1", stored_user.password_hash)


def test_failed_older_send_does_not_invalidate_newer_delivered_reset_link(
    api_db: Session,
    mail_on: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core import security

    user = _make_user(
        api_db,
        email="overlapping-reset@x.ae",
        status="active",
        verified=True,
    )
    first_sending = threading.Event()
    newer_sent = threading.Event()
    sent_tokens: list[str] = []
    calls_lock = threading.Lock()

    def send_password_reset_email(*, recipient: str, raw_token: str, locale: str) -> None:
        del recipient, locale
        with calls_lock:
            sent_tokens.append(raw_token)
            call_number = len(sent_tokens)
        if call_number == 1:
            first_sending.set()
            assert newer_sent.wait(timeout=5)
            raise account_mailer.AccountMailError(500, "older-failed")
        newer_sent.set()

    monkeypatch.setattr(
        account_mailer,
        "send_password_reset_email",
        send_password_reset_email,
    )
    older = threading.Thread(
        target=auth_service.request_email_link,
        args=(user.email, account_token_service.PURPOSE_RESET, "en"),
    )
    older.start()
    assert first_sending.wait(timeout=5)

    auth_service.request_email_link(
        user.email,
        account_token_service.PURPOSE_RESET,
        "en",
    )
    older.join(timeout=5)
    assert not older.is_alive()
    assert len(sent_tokens) == 2

    api_db.expire_all()
    token_rows = {
        row.token_hash: row
        for row in api_db.scalars(
            select(AccountEmailToken).where(AccountEmailToken.user_id == user.id)
        )
    }
    older_row = token_rows[security.hash_token(sent_tokens[0])]
    newer_row = token_rows[security.hash_token(sent_tokens[1])]
    assert older_row.used_at is not None
    assert newer_row.used_at is None


def test_password_reset_of_locked_user_reactivates_account(
    api_db: Session, mail_on: Settings
) -> None:
    user = _make_user(api_db, email="locked-reset@x.ae", status="locked", verified=True)
    raw = account_token_service.issue(api_db, user, account_token_service.PURPOSE_RESET)
    client = _client(api_db)

    resp = client.post(
        "/api/v1/auth/password-reset/complete",
        json={"token": raw, "password": "brandnew-1", "password_confirmation": "brandnew-1"},
    )

    assert resp.status_code == 200
    api_db.refresh(user)
    assert user.status == "active"


def test_password_reset_rejects_unknown_or_reused_token(api_db: Session, mail_on: Settings) -> None:
    client = _client(api_db)
    resp = client.post(
        "/api/v1/auth/password-reset/complete",
        json={"token": "x" * 40, "password": "whatever1", "password_confirmation": "whatever1"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "PASSWORD_RESET_LINK_INVALID"


# ─── account_token_service atomicity ────────────────────────────────────────


def test_claim_is_single_use_under_concurrent_attempts(api_db: Session) -> None:
    from app.core import security

    user = User(email="concurrent@x.ae", password_hash=security.hash_password("x12345678"))
    api_db.add(user)
    api_db.commit()
    api_db.refresh(user)
    raw = account_token_service.issue(api_db, user, account_token_service.PURPOSE_VERIFY)

    results: list[AccountEmailToken | None] = []
    lock = threading.Lock()
    barrier = threading.Barrier(2)

    def _attempt() -> None:
        db2 = session_mod.SessionLocal()
        try:
            barrier.wait(timeout=5)
            try:
                row = account_token_service.claim(db2, raw, account_token_service.PURPOSE_VERIFY)
            except Exception:  # a lock-contention error counts as "did not win"
                row = None
            else:
                if row is not None:
                    db2.commit()
                else:
                    db2.rollback()
            with lock:
                results.append(row)
        finally:
            db2.close()

    threads = [threading.Thread(target=_attempt) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    winners = [r for r in results if r is not None]
    assert len(winners) == 1


# ─── account_mailer transport ────────────────────────────────────────────────


@pytest.fixture()
def mailer_settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    settings = _mail_settings()
    monkeypatch.setattr(account_mailer, "get_settings", lambda: settings)
    monkeypatch.setattr(account_mailer, "_cached_token", None)
    monkeypatch.setattr(account_mailer, "_cached_expires_monotonic", 0.0)
    return settings


def test_mailer_token_request_uses_client_credentials(
    monkeypatch: pytest.MonkeyPatch, mailer_settings: Settings
) -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if "login.microsoftonline.com" in str(request.url):
            captured["token_url"] = str(request.url)
            captured["form"] = parse_qs(request.content.decode())
            return httpx.Response(200, json={"access_token": "tok-1", "expires_in": 3600})
        assert "graph.microsoft.com" in str(request.url)
        captured["send_url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(202)

    monkeypatch.setattr(account_mailer, "_transport", httpx.MockTransport(handler))

    account_mailer.send_verification_email(recipient="a@x.ae", raw_token="rawtok", locale="en")

    assert "tenant-1" in captured["token_url"]  # type: ignore[operator]
    form = captured["form"]
    assert form["grant_type"] == ["client_credentials"]
    assert form["client_id"] == ["client-1"]
    assert form["client_secret"] == ["secret-1"]
    assert form["scope"] == ["https://graph.microsoft.com/.default"]
    assert (
        captured["send_url"] == "https://graph.microsoft.com/v1.0/users/security@gssg.app/sendMail"
    )
    assert captured["auth"] == "Bearer tok-1"


def test_mailer_only_202_counts_as_success(
    monkeypatch: pytest.MonkeyPatch, mailer_settings: Settings
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "login.microsoftonline.com" in str(request.url):
            return httpx.Response(200, json={"access_token": "tok-2", "expires_in": 3600})
        return httpx.Response(200)  # not 202 — must be treated as a failure

    monkeypatch.setattr(account_mailer, "_transport", httpx.MockTransport(handler))

    with pytest.raises(account_mailer.AccountMailError):
        account_mailer.send_verification_email(recipient="a@x.ae", raw_token="rawtok", locale="en")


def test_mailer_send_failure_logs_no_secrets(
    monkeypatch: pytest.MonkeyPatch, mailer_settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "login.microsoftonline.com" in str(request.url):
            return httpx.Response(200, json={"access_token": "tok-3", "expires_in": 3600})
        return httpx.Response(500, headers={"request-id": "req-xyz"})

    monkeypatch.setattr(account_mailer, "_transport", httpx.MockTransport(handler))

    with caplog.at_level("WARNING"), pytest.raises(account_mailer.AccountMailError) as exc_info:
        account_mailer.send_verification_email(
            recipient="secret-recipient@x.ae", raw_token="super-secret-token", locale="en"
        )

    assert exc_info.value.status == 500
    assert exc_info.value.request_id == "req-xyz"
    log_text = "\n".join(r.getMessage() for r in caplog.records)
    assert "secret-recipient@x.ae" not in log_text
    assert "super-secret-token" not in log_text


def test_settings_rejects_enabled_flag_with_missing_secret() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Settings(
            account_mail_enabled=True,
            microsoft_tenant_id="t",
            microsoft_client_id="c",
            microsoft_client_secret="",
            account_mail_link_base_url="https://gssg.app",
        )


# ─── account_mail_templates ──────────────────────────────────────────────────

_ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
_LATIN_WORD_RE = re.compile(r"[A-Za-z]{2,}")
_TAG_RE = re.compile(r"<[^>]+>")


def test_verification_template_is_bilingual_requested_language_first() -> None:
    url = "https://gssg.app/verify-email?token=abc123"
    subject, html = account_mail_templates.render_verification(url, "en")

    assert subject.startswith("Confirm your GSSG Manager email")
    assert " | " in subject
    assert html.index('lang="en"') < html.index('lang="ar"')
    assert html.count(url) >= 4  # href + visible text, per language section

    ar_subject, ar_html = account_mail_templates.render_verification(url, "ar")
    assert ar_html.index('lang="ar"') < ar_html.index('lang="en"')
    assert ar_subject.split(" | ")[0] != subject.split(" | ")[0]


def test_template_sections_stay_in_their_own_language() -> None:
    url = "https://gssg.app/reset-password?token=abc123"
    _subject, html = account_mail_templates.render_password_reset(url, "en")

    ar_start = html.index('<div dir="rtl"')
    ar_section = html[ar_start:]
    en_section = html[: html.index("<hr>")]

    # Arabic section: strip markup, then no Latin words besides the product
    # name and the URL.
    ar_text = _TAG_RE.sub(" ", ar_section)
    scrubbed_ar = ar_text.replace("GSSG Manager", "").replace(url, "")
    assert not _LATIN_WORD_RE.search(scrubbed_ar)
    # English section: no Arabic script at all.
    assert not _ARABIC_RE.search(en_section)
