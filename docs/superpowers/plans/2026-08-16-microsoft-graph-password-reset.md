# Microsoft Graph Password Reset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for Tasks 1–6, `superpowers:verification-before-completion` before declaring the code complete, and the repository's browser-testing rules for Task 7.

**Goal:** Replace Sentinel's public “contact IT” forgot-password flow with a non-enumerating, 30-minute, single-use password-reset link delivered from `security@gssg.app` through mailbox-scoped Microsoft Graph access.

**Architecture:** Two unauthenticated auth endpoints schedule reset-mail work and atomically consume hashed reset tokens. A dedicated Microsoft Graph transport authenticates with MSAL client credentials and sends a bilingual multipart MIME message; it remains separate from the operator IONOS mailbox/ledger service. The React login surface owns the request and reset states, scrubs the token query string, and remains reachable before the normal auth gate.

**Tech stack:** FastAPI, Pydantic Settings, SQLAlchemy 2, Alembic, SQLite/WAL, MSAL for Python, HTTPX, React 19, React Router 7, i18next, Vitest/Testing Library.

**Approved specification:** `docs/superpowers/specs/2026-08-16-microsoft-graph-password-reset-design.md` at commit `9d54ddc`.

**Scope guardrails:**

- Do not modify `backend/app/services/email_service.py`; it remains the user-owned IONOS mailbox/ledger feature.
- Do not add SMTP fallback, a persistent mail queue, SSO, automatic sign-in, or a new password policy.
- Do not put the raw reset token, recipient, reset URL, access token, or client secret in logs.
- Do not create mailboxes, DNS records, Entra credentials, Exchange grants, production secrets, or deployments while implementing Tasks 1–7. Those are separately confirmed actions in Task 8.
- Keep `GSSG_PASSWORD_RESET_EMAIL_ENABLED=0` until every Task 8 acceptance check passes.

---

## Task 1: Add fail-closed Microsoft mail configuration

**Files:**
- Create: `backend/tests/test_password_reset_config.py`
- Modify: `backend/app/config.py`
- Modify: `requirements.txt`
- Modify: `pyproject.toml`

### Step 1: Write the failing configuration tests

Cover these observable contracts in `backend/tests/test_password_reset_config.py`:

```python
import pytest
from pydantic import ValidationError

from app.config import Settings


def test_password_reset_email_defaults_disabled() -> None:
    settings = Settings(_env_file=None)
    assert settings.password_reset_email_enabled is False


def test_enabled_password_reset_email_requires_complete_credentials() -> None:
    with pytest.raises(ValidationError) as exc_info:
        Settings(password_reset_email_enabled=True, _env_file=None)

    message = str(exc_info.value)
    assert "microsoft_tenant_id" in message
    assert "microsoft_client_id" in message
    assert "microsoft_client_secret" in message
    assert "public_base_url" in message


def test_enabled_password_reset_email_rejects_non_https_public_url() -> None:
    with pytest.raises(ValidationError, match="HTTPS"):
        Settings(
            password_reset_email_enabled=True,
            microsoft_tenant_id="tenant",
            microsoft_client_id="client",
            microsoft_client_secret="super-secret",
            password_reset_sender="security@gssg.app",
            public_base_url="http://gssg.app",
            _env_file=None,
        )


def test_client_secret_is_redacted_from_settings_repr() -> None:
    settings = Settings(
        microsoft_client_secret="super-secret",
        _env_file=None,
    )
    assert "super-secret" not in repr(settings)
```

Add an autouse fixture that removes all six password-reset/Microsoft `GSSG_*`
variables with `monkeypatch.delenv(..., raising=False)`. The tests must not inherit
an enabled production/service environment.

Also add one positive test for a complete enabled configuration and assert `public_base_url` is stored without a trailing slash.

### Step 2: Run the focused test and observe failure

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_password_reset_config.py -q
```

Expected: failures because the settings do not exist.

### Step 3: Add settings and one cross-field validator

In `backend/app/config.py`:

- Import `SecretStr` and `model_validator` from Pydantic and `urlsplit` from `urllib.parse`.
- Add these fields to `Settings`:

```python
password_reset_email_enabled: bool = False
microsoft_tenant_id: str = ""
microsoft_client_id: str = ""
microsoft_client_secret: SecretStr = SecretStr("")
password_reset_sender: str = "security@gssg.app"
public_base_url: str = ""
```

- Add a model-level validator. When the feature is disabled, it must not require Microsoft credentials. When enabled, it must:
  - report all missing tenant/client/secret/sender/base-URL fields in one validation error;
  - require `public_base_url` to be an origin-only HTTPS URL with no credentials, query, or fragment;
  - strip its trailing slash;
  - reject sender values containing control characters or lacking exactly one `@`.
- Never include a secret value in an exception.

Use one validator rather than scattered checks in the mailer; `create_app()` already resolves settings at startup, so an enabled but incomplete production service fails before accepting traffic.

### Step 4: Declare runtime dependencies in both manifests

In `requirements.txt`, add these under runtime dependencies:

```text
httpx>=0.27,<1.0
msal>=1.37,<2.0
```

Move the existing `httpx` entry out of the Dev section instead of duplicating it.

In `pyproject.toml`, add the same two packages to `[project].dependencies`. Do not add the Microsoft Graph SDK; this feature needs one HTTP endpoint, and HTTPX keeps the transport narrow and testable.

### Step 5: Install and run the test

Run:

```powershell
venv\Scripts\python.exe -m pip install "msal>=1.37,<2.0"
venv\Scripts\python.exe -m pytest backend/tests/test_password_reset_config.py -q
```

Expected: all configuration tests pass.

### Step 6: Commit

```powershell
git add backend/app/config.py backend/tests/test_password_reset_config.py requirements.txt pyproject.toml
git commit -m "feat(auth): add Microsoft reset mail configuration"
```

---

## Task 2: Persist hashed reset tokens with migration 0071

**Files:**
- Create: `backend/app/db/migrations/versions/0071_password_reset_tokens.py`
- Create: `backend/tests/test_migration_password_reset_tokens.py`
- Modify: `backend/app/db/models.py`

### Step 1: Write the failing model and migration tests

In `backend/tests/test_migration_password_reset_tokens.py`, assert:

1. `PasswordResetToken` exposes `user_id`, `token_hash`, `created_at`, `expires_at`, and nullable `used_at`.
2. `token_hash` is length 64 and has a unique index.
3. `(user_id, used_at)` has a non-unique composite index.
4. A temporary SQLite database can upgrade from `0070_user_preferences` to `0071_password_reset_tokens`, downgrade to `0070_user_preferences`, and upgrade again.
5. The migration's foreign key targets `users.id` with `ON DELETE CASCADE`.

Follow the temporary-database pattern in `backend/tests/test_migration_permit_validity_period.py`; never run downgrade against the user's real database.

### Step 2: Run the focused test and observe failure

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_migration_password_reset_tokens.py -q
```

Expected: import/migration failure because the model and revision do not exist.

### Step 3: Add the SQLAlchemy model

In `backend/app/db/models.py`, immediately after `AuthSession`, add:

```python
class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ux_password_reset_tokens_token_hash", "token_hash", unique=True),
        Index("ix_password_reset_tokens_user_used", "user_id", "used_at"),
    )
```

A relationship on `User` is unnecessary for this flow; query by `user_id` and keep the model surface small.

### Step 4: Add Alembic revision 0071

Create `0071_password_reset_tokens.py` with:

```python
revision = "0071_password_reset_tokens"
down_revision = "0070_user_preferences"
```

`upgrade()` creates the table and the two named indexes. `downgrade()` drops the indexes/table cleanly. Do not add an expiry index; the initial implementation performs no expiry scan.

### Step 5: Run the migration test

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_migration_password_reset_tokens.py -q
```

Expected: all tests pass, including upgrade → downgrade → upgrade.

### Step 6: Commit

```powershell
git add backend/app/db/models.py backend/app/db/migrations/versions/0071_password_reset_tokens.py backend/tests/test_migration_password_reset_tokens.py
git commit -m "feat(auth): persist password reset tokens"
```

---

## Task 3: Build the scoped Graph MIME mailer and bilingual reset message

**Files:**
- Create: `backend/app/services/graph_mailer.py`
- Create: `backend/app/services/password_reset_mail.py`
- Create: `backend/tests/test_graph_mailer.py`
- Create: `backend/tests/test_password_reset_mail.py`

### Step 1: Write Graph transport tests first

In `backend/tests/test_graph_mailer.py`, use `httpx.MockTransport` and a fake MSAL client. Cover:

- token acquisition requests `https://graph.microsoft.com/.default` through `acquire_token_for_client`;
- the request is exactly `POST /v1.0/users/security@gssg.app/sendMail`;
- `Authorization: Bearer <token>` and `Content-Type: text/plain` are present;
- the request body is base64-encoded MIME containing one plain-text and one HTML part, the intended recipient, and subject;
- only HTTP 202 is accepted;
- 200, 4xx, 5xx, malformed responses, MSAL errors, and transport errors raise one sanitized `GraphMailError`;
- captured logs may contain only status, provider error code, request/correlation ID, and exception class;
- logs do not contain the recipient, raw reset token, full reset URL, bearer token, client secret, HTML, or plain-text body.

Reset `graph_mailer._transport` and its cached MSAL client after every test.

### Step 2: Write reset-message tests first

In `backend/tests/test_password_reset_mail.py`, patch `graph_mailer.send_multipart_mail` and assert:

- sender is exactly the configured `security@gssg.app`;
- reset URL is `https://gssg.app/reset-password?token=<url-encoded-token>`;
- English and Arabic sections both appear in text and HTML;
- `locale="ar"` puts Arabic first, while `locale="en"` puts English first;
- the visible URL and HTML link match;
- dynamic values are HTML-escaped;
- no password, G-number, role, account status, employee data, or personal IT contact is present.

### Step 3: Run both tests and observe failure

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_graph_mailer.py backend/tests/test_password_reset_mail.py -q
```

Expected: module import failures.

### Step 4: Implement the low-level Graph transport

`backend/app/services/graph_mailer.py` owns only Microsoft authentication and `sendMail` transport:

```python
class GraphMailError(RuntimeError):
    def __init__(
        self,
        *,
        status_code: int | None,
        error_code: str,
        request_id: str | None,
    ) -> None: ...


def send_multipart_mail(
    *,
    sender: str,
    recipient: str,
    subject: str,
    text_body: str,
    html_body: str,
) -> None: ...
```

Implementation details:

1. Cache `msal.ConfidentialClientApplication` with `functools.lru_cache` using:
   - authority `https://login.microsoftonline.com/{tenant_id}`;
   - configured client ID;
   - `microsoft_client_secret.get_secret_value()`.
2. Call `acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])`; current MSAL performs application-token cache lookup internally.
3. Build a stdlib `email.message.EmailMessage`, call `set_content(text_body)` and `add_alternative(html_body, subtype="html")`, then base64-encode `message.as_bytes()`.
4. POST that base64 body with HTTPX to `/v1.0/users/{sender}/sendMail`. MIME mode is required because Graph's JSON message shape has only one body and cannot provide a true text/plain + text/html alternative.
5. Use a short finite timeout (10 seconds is sufficient for background handoff) and an overridable module-level `_transport`, matching `openwa_client.py`'s test seam.
6. Treat only 202 as success. Parse only Graph's error code and request/correlation identifiers; never include the provider message/body in the exception or log.
7. Log transport failures by exception class only, not `str(exc)`.

Do not add retries here. A second send can create duplicate reset messages; users can request another link after an operational failure.

### Step 5: Implement the reset-specific renderer

`backend/app/services/password_reset_mail.py` exports the approved narrow contract:

```python
def send_password_reset_email(*, recipient: str, raw_token: str, locale: str) -> None:
    ...
```

Keep templates as application-owned static functions/constants. Build the URL from validated `public_base_url`, URL-encode the token, and use `html.escape(..., quote=True)` for every dynamic HTML value. Both languages must always be present; locale changes section order only.

### Step 6: Run focused tests

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_graph_mailer.py backend/tests/test_password_reset_mail.py -q
```

Expected: all mailer/template tests pass.

### Step 7: Commit

```powershell
git add backend/app/services/graph_mailer.py backend/app/services/password_reset_mail.py backend/tests/test_graph_mailer.py backend/tests/test_password_reset_mail.py
git commit -m "feat(auth): send reset mail through Microsoft Graph"
```

---

## Task 4: Implement issuance and atomic reset completion

**Files:**
- Create: `backend/app/services/password_reset_service.py`
- Create: `backend/tests/test_password_reset_service.py`
- Modify: `backend/app/services/auth_service.py`

### Step 1: Check symbol callers before refactoring

Use LSP references for:

- `auth_service._normalize_email` before making it public as `normalize_email`;
- `auth_service.reset_password`;
- `auth_service.revoke_user_sessions`.

Migrate every caller in the same task. Do not leave a compatibility alias for `_normalize_email`.

### Step 2: Write service tests before implementation

Create file-backed SQLite fixtures with `check_same_thread=False`, `attach_sqlite_pragmas`, and a fresh `sessionmaker` so concurrency matches production WAL/busy-timeout behavior. Cover:

1. Active and locked users receive an issued token; unknown, pending, rejected, and disabled users return `None`.
2. The raw token is at least 32 bytes of entropy, differs from the persisted SHA-256 hex digest, and cannot be recovered from the row.
3. Expiry is exactly 30 minutes after creation (inject `now` into service internals for deterministic assertions).
4. A second issuance marks an earlier unused row used.
5. A Graph handoff failure marks the just-issued token used and writes only sanitized log fields.
6. Used, expired, unknown, and status-ineligible tokens raise the same `PASSWORD_RESET_LINK_INVALID` `AppError` and mutate nothing.
7. Success changes the password, clears `failed_attempts`/`locked_at`, changes locked → active, marks sibling reset tokens used, revokes every live `AuthSession`, and writes `reset_password` with actor `self-service`.
8. The existing admin `reset_password` API behavior remains unchanged after sharing internals.
9. Two threads completing the same token against the same file database produce exactly one success and one `PASSWORD_RESET_LINK_INVALID`; no `database is locked` escapes.
10. Monkeypatching the audit/staging path to raise before commit rolls back token claim, password, lock state, sibling-token changes, sessions, and audit together.

### Step 3: Run the test and observe failure

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_password_reset_service.py -q
```

Expected: module/function failures.

### Step 4: Refactor auth primitives without changing public behavior

In `backend/app/services/auth_service.py`:

- Rename `_normalize_email` to `normalize_email` and update every reference.
- Split the no-commit internals from the committing APIs:

```python
def _stage_revoke_user_sessions(db: Session, user_id: int) -> int: ...


def _stage_password_reset(
    db: Session,
    user: User,
    new_password: str,
    *,
    actor: str | None,
) -> None:
    user.password_hash = security.hash_password(new_password)
    user.failed_attempts = 0
    user.locked_at = None
    if user.status == "locked":
        user.status = "active"
    _stage_revoke_user_sessions(db, user.id)
    _audit(db, actor, "reset_password", user)
```

- Keep `revoke_user_sessions` as the existing committing public helper for its other caller.
- Change admin `reset_password` to stage password/session/audit changes and commit once. Its route, response, actor, and status semantics stay unchanged.

### Step 5: Implement reset token service

`backend/app/services/password_reset_service.py` should expose:

```python
@dataclass(frozen=True)
class IssuedPasswordReset:
    recipient: str
    raw_token: str
    token_hash: str


def issue_password_reset(
    db: Session,
    normalized_email: str,
    *,
    now: datetime | None = None,
) -> IssuedPasswordReset | None: ...


def complete_password_reset(
    db: Session,
    raw_token: str,
    new_password: str,
    *,
    now: datetime | None = None,
) -> User: ...


def issue_and_send_password_reset(normalized_email: str, locale: str) -> None: ...
```

Issuance:

- query only by normalized email;
- allow status `active` or `locked`;
- mark prior unused tokens used at `now`;
- generate `secrets.token_urlsafe(32)` and persist only `security.hash_token(raw_token)`;
- set expiry to `now + timedelta(minutes=30)`;
- commit before Graph I/O so no SQL transaction spans a network request.

Background orchestration:

- open its own session from `app.db.session.SessionLocal` at execution time; do not capture or reuse request-scoped `db`;
- send through `password_reset_mail.send_password_reset_email`;
- on any known Graph rejection, mark the newly issued row used and commit;
- on unexpected failure, also invalidate the row and log only the exception class;
- never log the normalized email or any token/URL/body.

Completion must atomically claim the row with a conditional `UPDATE ... WHERE token_hash = :hash AND used_at IS NULL AND expires_at > :now RETURNING id, user_id`. SQLite serializes the writers; the second transaction observes no eligible row and gets the generic invalid-link error. After a successful claim, require the user still be active/locked, call `_stage_password_reset(..., actor="self-service")`, invalidate siblings, and commit once. Wrap the whole operation in `try/except` with explicit rollback before re-raising.

### Step 6: Run the service tests

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_password_reset_service.py -q
```

Expected: all service and concurrency tests pass.

### Step 7: Commit

```powershell
git add backend/app/services/auth_service.py backend/app/services/password_reset_service.py backend/tests/test_password_reset_service.py
git commit -m "feat(auth): issue and consume reset tokens"
```

---

## Task 5: Add non-enumerating public auth endpoints and generated contracts

**Files:**
- Create: `backend/tests/test_password_reset_api.py`
- Modify: `backend/app/core/ratelimit.py`
- Modify: `backend/app/schemas/auth.py`
- Modify: `backend/app/api/v1/auth.py`
- Modify: `backend/app/api/errors.py`
- Modify (generated): `backend/openapi.json`
- Modify (generated): `frontend/src/lib/api.types.ts`
- Modify: `frontend/src/lib/api.ts`

### Step 1: Write failing route tests

Use a temporary database and dependency overrides following `backend/tests/test_user_preferences_api.py`. Reset the new limiter singletons before/after every test. Patch `password_reset_service.issue_and_send_password_reset` to a recorder so tests do not perform Graph I/O.

Cover:

- enabled request endpoint returns 202 and exactly `{"status": "accepted"}` for active, locked, unknown, pending, rejected, and disabled addresses;
- every scheduled background task receives only normalized email and locale, never a DB session;
- address attempts 1–3 schedule work; attempt 4 still returns generic 202 and schedules nothing;
- IP attempts 1–20 return 202; attempt 21 returns existing 429 `RATE_LIMITED` envelope and schedules nothing;
- disabled feature returns 503 `PASSWORD_RESET_UNAVAILABLE` without scheduling work;
- complete endpoint needs no authenticated user;
- matching passwords call the completion service and return `{"status": "reset"}`;
- completion deletes `gssg_session` even if a cookie was present;
- password mismatch returns 422 and never calls the service;
- validation responses omit raw `token`, `password`, and `password_confirmation`
  values;
- `PASSWORD_RESET_LINK_INVALID` remains one generic 400 envelope.

Do not assert timing; assert that lookup/Graph behavior exists only in the background callable.

### Step 2: Run the route test and observe failure

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_password_reset_api.py -q
```

Expected: endpoint/schema failures.

### Step 3: Add limiter constants and singletons

In `backend/app/core/ratelimit.py`, add:

```python
PASSWORD_RESET_IP_MAX_HITS = 20
PASSWORD_RESET_IP_WINDOW_SECONDS = 15 * 60
PASSWORD_RESET_EMAIL_MAX_HITS = 3
PASSWORD_RESET_EMAIL_WINDOW_SECONDS = 15 * 60
```

Create `password_reset_ip_limiter` and `password_reset_email_limiter` with those values and export them. The route calls `enforce(password_reset_ip_limiter, request)` for the visible IP limit and calls `password_reset_email_limiter.allow(normalized_email)` directly for the silent address limit.

### Step 4: Add request/response schemas

In `backend/app/schemas/auth.py`, add the four approved models:

```python
class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=3, max_length=256)
    locale: Literal["en", "ar"] = "en"


class PasswordResetRequestResult(BaseModel):
    status: Literal["accepted"] = "accepted"


class PasswordResetCompleteRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    password: str = Field(min_length=8, max_length=128)
    password_confirmation: str = Field(min_length=8, max_length=128)


class PasswordResetCompleteResult(BaseModel):
    status: Literal["reset"] = "reset"
```

Update `__all__`. Check password equality in the route rather than with a
model-level validator: a model-level error carries the entire request object.

### Step 5: Remove raw inputs from validation envelopes

In `backend/app/api/errors.py`, copy each `exc.errors()` dictionary while omitting
its `input` key before passing the list to `jsonable_encoder`.
`RequestValidationError.errors()` in the pinned FastAPI version accepts no
`include_input` argument. Pydantic's default dictionaries echo the rejected input;
for this endpoint that would reflect a reset token or password into the response
and any client-side error capture. Preserve locations, error types, messages,
context, and the existing `VALIDATION_ERROR` code.

Add a route test that submits invalid lengths and mismatched passwords, serializes
the complete JSON response, and proves none of the three submitted secret strings
appears.

### Step 6: Add both unauthenticated routes

In `backend/app/api/v1/auth.py`:

```python
@router.post(
    "/password-reset/request",
    response_model=PasswordResetRequestResult,
    status_code=status.HTTP_202_ACCEPTED,
)
def request_password_reset(...): ...


@router.post(
    "/password-reset/complete",
    response_model=PasswordResetCompleteResult,
)
def complete_password_reset(...): ...
```

Request route order is security-sensitive:

1. Check feature enabled; otherwise raise `AppError("PASSWORD_RESET_UNAVAILABLE", ..., http_status=503)`.
2. Enforce IP limit.
3. Normalize via public `auth_service.normalize_email`.
4. If address limiter allows, add a Starlette/FastAPI background task with normalized email and locale only.
5. Return accepted immediately. Do no user query and inject no database session into this route.

The completion route first compares `password` and `password_confirmation`; a
mismatch raises
`AppError("PASSWORD_CONFIRMATION_MISMATCH", "Passwords do not match.", http_status=422)`
without calling the service. Otherwise it calls the service with the request-scoped
session and deletes `COOKIE_NAME` at path `/` from the response on success. Do not
gate completion on the email-enabled flag; a previously delivered valid link must
remain usable during a mail-provider outage or feature pause.

### Step 7: Run the API tests

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_password_reset_api.py -q
```

Expected: all route tests pass.

### Step 8: Regenerate OpenAPI and frontend generated types

Run from the repository root:

```powershell
venv\Scripts\python.exe -X utf8 scripts/dump_openapi.py
pnpm --dir frontend run gen:api
```

Inspect the generated diff. It should add only the two auth paths and four schemas plus deterministic ordering changes, if any.

### Step 9: Add typed frontend API methods

In `frontend/src/lib/api.ts`, alias the four generated schema types and add:

```typescript
requestPasswordReset: (body: PasswordResetRequest) =>
  request<PasswordResetRequestResult>('POST', '/auth/password-reset/request', body),
completePasswordReset: (body: PasswordResetCompleteRequest) =>
  request<PasswordResetCompleteResult>('POST', '/auth/password-reset/complete', body),
```

Do not hand-copy generated object fields into a second interface.

### Step 10: Re-run focused backend tests

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_password_reset_api.py backend/tests/test_password_reset_service.py -q
```

Expected: pass.

### Step 11: Commit

```powershell
git add backend/app/core/ratelimit.py backend/app/schemas/auth.py backend/app/api/errors.py backend/app/api/v1/auth.py backend/tests/test_password_reset_api.py backend/openapi.json frontend/src/lib/api.types.ts frontend/src/lib/api.ts
git commit -m "feat(auth): expose password reset API"
```

---

## Task 6: Replace the forgot screen and add the public reset route

**Files:**
- Create: `frontend/src/pages/auth/AuthFields.tsx`
- Create: `frontend/src/pages/auth/PasswordResetScreens.tsx`
- Create: `frontend/src/pages/auth/LoginPage.passwordReset.test.tsx`
- Modify: `frontend/src/pages/auth/LoginPage.tsx`
- Modify: `frontend/src/pages/auth/LoginPage.css` only if existing atoms cannot express an accessible state
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`
- Modify: `frontend/index.html`

### Step 1: Write failing component tests

Render `LoginPage` under `MemoryRouter` and an `AuthContext.Provider`; spy on the two API methods and provide `login`, `logout`, and `setUser` mocks. Keep the tests behavioral, not source-text assertions.

Cover:

1. Entering an email on sign-in and opening **Forgot password?** prefills that email.
2. Forgot screen has no IT email/phone/contact panel.
3. Submit calls `requestPasswordReset` once with normalized email and current locale, disables the button while pending, and shows generic accepted copy without echoing the address.
4. A request API failure shows one localized temporary-unavailable state.
5. `/reset-password?token=raw-test-token...` captures the token, then a location probe observes an empty query string after route replacement.
6. A missing token opens the same invalid-link state used for expired/used links.
7. Mismatched passwords show local mismatch copy and do not call the complete API.
8. Successful completion calls the API with the captured token, calls `logout()` to clear cached auth data/cookies, shows success, and offers normal sign-in.
9. `ApiError` code `PASSWORD_RESET_LINK_INVALID` renders the shared invalid/expired/used state without the token.
10. Arabic renders the new labels and preserves RTL direction and logical focus order.

Use a deferred promise in the pending-button test instead of arbitrary timers.

### Step 2: Run the component test and observe failure

```powershell
pnpm --dir frontend exec vitest run src/pages/auth/LoginPage.passwordReset.test.tsx
```

Expected: missing UI/API behavior.

### Step 3: Extract the existing field atoms once

Move `TFn`, `EmailField`, and `PasswordField` from `LoginPage.tsx` into `AuthFields.tsx`, then import them back into `LoginPage.tsx`. Extend `PasswordField` with optional `autoComplete`, `placeholder`, and `minLength` props so the reset form can use `new-password` without duplicating markup. Existing login/request screens must render unchanged.

Do not copy the field JSX into the reset component; one field convention is enough.

### Step 4: Implement request and reset screens

In `PasswordResetScreens.tsx`:

- `ForgotPasswordScreen` accepts initial/current email, locale, and `onBack`.
- It submits through `api.requestPasswordReset`, guards against duplicate pending submissions, then replaces the form with generic accepted copy.
- It never renders the submitted address in the accepted state.
- It maps any actual API failure to localized temporary-unavailable copy; 429 may retain the API's generic retry wording if desired, but must not imply account existence.

`ResetPasswordScreen`:

- reads the token once from `useLocation().search` into component state;
- uses a layout/effect-time `navigate({ pathname, search: "", hash }, { replace: true })` so the raw value leaves the address bar without entering storage;
- renders two shared `PasswordField`s with `autoComplete="new-password"` and minimum length 8;
- checks equality before calling the API;
- calls `api.completePasswordReset`, then `await logout()` (the logout helper clears auth/query caches in `finally`, even though the completion response already deleted the cookie);
- never logs, renders, copies, persists, or places the token in an error;
- maps `PASSWORD_RESET_LINK_INVALID` and missing token to one invalid-link state;
- maps other API failures to temporary-unavailable copy;
- navigates to `/` with replacement from the success/back action.

### Step 5: Wire screens into `LoginPage`

In `LoginPage.tsx`:

- detect `location.pathname === "/reset-password"` and render `ResetPasswordScreen` inside the existing login card/chrome;
- replace `ForgotScreen` with `ForgotPasswordScreen` and pass `picked?.email ?? email` as the initial value;
- remove `ItContact` only from the forgot path;
- leave `LockedScreen` and its `ItContact` behavior unchanged;
- retain selected-account, access-request, EN/AR toggle, and existing login behavior.

### Step 6: Put the reset route before the auth gate

In `frontend/src/App.tsx`, before `status === "loading"` / `status === "anon"` checks, handle `/reset-password` with the same public `LoginPage` + `Toaster` surface. This must work for loading, anonymous, and authenticated auth states. Do not add a second router tree.

### Step 7: Add bilingual copy and referrer policy

Add complete matching `auth.*` keys in both locale files for:

- send-link form/action/pending state;
- generic accepted title/body;
- reset title/body;
- new password and confirmation labels;
- reset action/pending state;
- mismatch;
- success;
- invalid/expired/used link;
- temporary unavailable.

Use the existing Arabic terminology and punctuation style. Do not translate `security@gssg.app` into UI copy; the public success response stays generic.

In `frontend/index.html`, add:

```html
<meta name="referrer" content="no-referrer" />
```

This prevents the initial reset URL from becoming a referrer. Sentinel's production Uvicorn entry points already keep access logging disabled; do not enable request-line logging for this route.

### Step 8: Run focused component and existing auth-adjacent tests

```powershell
pnpm --dir frontend exec vitest run src/pages/auth/LoginPage.passwordReset.test.tsx src/lib/userPreferences.test.tsx
```

Expected: pass. The second file guards logout/cache behavior used by reset success.

### Step 9: Commit

```powershell
git add frontend/src/pages/auth/AuthFields.tsx frontend/src/pages/auth/PasswordResetScreens.tsx frontend/src/pages/auth/LoginPage.passwordReset.test.tsx frontend/src/pages/auth/LoginPage.tsx frontend/src/pages/auth/LoginPage.css frontend/src/App.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/index.html
git commit -m "feat(auth): add self-service password reset UI"
```

If `LoginPage.css` did not need a change, omit it from `git add`.

---

## Task 7: Verify the complete local implementation

**Files:** No new permanent files unless a real defect requires a source/test correction.

### Step 1: Run all password-reset contracts together

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_password_reset_config.py backend/tests/test_migration_password_reset_tokens.py backend/tests/test_graph_mailer.py backend/tests/test_password_reset_mail.py backend/tests/test_password_reset_service.py backend/tests/test_password_reset_api.py -q
pnpm --dir frontend exec vitest run src/pages/auth/LoginPage.passwordReset.test.tsx src/lib/userPreferences.test.tsx
```

Expected: all pass.

### Step 2: Run targeted static checks

```powershell
venv\Scripts\ruff.exe check backend/app/config.py backend/app/db/models.py backend/app/db/migrations/versions/0071_password_reset_tokens.py backend/app/services/graph_mailer.py backend/app/services/password_reset_mail.py backend/app/services/password_reset_service.py backend/app/services/auth_service.py backend/app/core/ratelimit.py backend/app/schemas/auth.py backend/app/api/v1/auth.py backend/tests/test_password_reset_config.py backend/tests/test_migration_password_reset_tokens.py backend/tests/test_graph_mailer.py backend/tests/test_password_reset_mail.py backend/tests/test_password_reset_service.py backend/tests/test_password_reset_api.py
venv\Scripts\mypy.exe backend/app/config.py backend/app/db/models.py backend/app/services/graph_mailer.py backend/app/services/password_reset_mail.py backend/app/services/password_reset_service.py backend/app/services/auth_service.py backend/app/core/ratelimit.py backend/app/schemas/auth.py backend/app/api/v1/auth.py
pnpm --dir frontend exec eslint src/pages/auth/AuthFields.tsx src/pages/auth/PasswordResetScreens.tsx src/pages/auth/LoginPage.tsx src/pages/auth/LoginPage.passwordReset.test.tsx src/App.tsx src/lib/api.ts
```

Expected: no new diagnostics. Fix source causes; do not suppress errors.

### Step 3: Verify generated contracts are current

Run the generators again:

```powershell
venv\Scripts\python.exe -X utf8 scripts/dump_openapi.py
pnpm --dir frontend run gen:api
```

Expected: the tracked generated files remain unchanged after the second generation.

### Step 4: Build the production frontend

```powershell
pnpm --dir frontend run build
```

Expected: TypeScript and Vite production build succeed.

### Step 5: Smoke the actual UI in Chrome for Testing

Read `skill://sentinel-live-preview`, `skill://browser-testing-with-devtools`, and `skill://verification` before starting. Follow the repository rule exactly: resolve the newest installed `~/.omp/puppeteer/chrome/win64-*/chrome-win64/chrome.exe`, open one Browser-tool session with that explicit `app.path` plus `--headless=new`, `--hide-scrollbars`, and `--mute-audio`, and reuse it. Do not fall back to another browser or launch mode.

Exercise the real built/local app surface:

1. Anonymous English desktop: type a login email → Forgot password → verify prefill and no IT contact.
2. Intercept only the reset-request HTTP response as 202 to verify pending and generic accepted UI; the backend transport itself is already covered with `MockTransport`.
3. Visit `/reset-password?token=<fake-43-character-token>` and verify the address bar loses the query before any user action.
4. Verify mismatch stays client-side; intercept one successful completion and verify success + sign-in action.
5. Return one `PASSWORD_RESET_LINK_INVALID` response and verify the shared invalid state.
6. Sign into the seeded local app, then visit the reset URL and verify the reset screen wins over the authenticated dashboard gate.
7. Repeat the reset form at 390×844 in Arabic/RTL and dark mode; verify labels, focus order, password reveal controls, and no horizontal overflow.

Capture screenshots for desktop success/invalid and mobile Arabic states. Close the Browser session when finished.

### Step 6: Review security-sensitive diff

Inspect only the final feature diff and verify:

- no raw token, recipient, client secret, bearer token, or full reset URL logging;
- no Graph `Mail.Send` tenant-wide assumption in code/docs;
- no import/use of `email_service.py` from the reset flow;
- request route has no DB dependency and schedules only normalized email + locale;
- complete route's password/token/session/audit changes commit atomically;
- reset query is scrubbed and never stored;
- generated OpenAPI/types match source.

Use `skill://requesting-code-review` for a final review pass before merge.

### Step 7: Commit any verification fixes, then stop before external rollout

If verification changed source, commit only those corrections. Do not provision or deploy yet.

---

## Task 8: Provision Microsoft 365 and enable production — separately confirmed operations

**External systems:** GoDaddy/Microsoft 365 Admin Center, Microsoft Entra, Exchange Online PowerShell, Cloudflare DNS, Sentinel production host.

Every numbered step below changes an external account, permission, DNS record, secret, or production service. Before executing each step, show the exact target/scope/value (redacting secrets) and obtain point-of-risk confirmation. Never ask the user to paste credentials or client secrets into chat.

### Step 1: Create the sender mailbox

After confirmation, create shared mailbox:

- Address: `security@gssg.app`
- Display name: `GSSG Account Security`
- Direct sign-in: blocked
- Membership: add the IT administrator only if replies must be monitored

If GoDaddy offers only a paid user mailbox, stop and present the exact plan/price before purchase. Do not accept a license or legal term automatically.

### Step 2: Activate Microsoft mail DNS in authoritative Cloudflare

In Microsoft 365 Admin Center, copy the tenant-specific records for `gssg.app`; never infer them. After confirmation, add to Cloudflare with proxying disabled:

1. MX
2. exactly one root SPF TXT policy
3. Autodiscover CNAME
4. both DKIM selector CNAMEs
5. DMARC TXT initially in observation mode

Enable DKIM in Microsoft only after both selectors resolve. Verify with public resolvers, not only the admin UI.

### Step 3: Register the Entra application and secret

After confirmation:

- App registration: `Sentinel Password Reset Mailer`
- Account type: this organization only
- Redirect URI: none
- Client credential: rotating secret with the shortest operationally practical expiry
- Record tenant ID, client ID, and the **Enterprise application service-principal object ID**. Do not use the App registrations object's ID for Exchange `New-ServicePrincipal`.

Do **not** grant tenant-wide Microsoft Graph `Mail.Send` in Entra. Exchange Application RBAC is the only mail authorization.

### Step 4: Grant mailbox-scoped Exchange Application RBAC

After confirmation and `Connect-ExchangeOnline`, substitute the reviewed IDs and run:

```powershell
New-ServicePrincipal `
  -AppId <CLIENT_APPLICATION_ID> `
  -ObjectId <ENTERPRISE_APP_SERVICE_PRINCIPAL_OBJECT_ID> `
  -DisplayName "Sentinel Password Reset Mailer"

New-ManagementScope `
  -Name "Sentinel Password Reset Sender" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'security@gssg.app'"

New-ManagementRoleAssignment `
  -Name "Sentinel Password Reset Mail.Send" `
  -App <ENTERPRISE_APP_SERVICE_PRINCIPAL_OBJECT_ID> `
  -Role "Application Mail.Send" `
  -CustomResourceScope "Sentinel Password Reset Sender"
```

Verify the filter resolves exactly one mailbox before assigning the role. Then run:

```powershell
Test-ServicePrincipalAuthorization `
  -Identity <ENTERPRISE_APP_SERVICE_PRINCIPAL_OBJECT_ID> `
  -Resource security@gssg.app | Format-Table

Test-ServicePrincipalAuthorization `
  -Identity <ENTERPRISE_APP_SERVICE_PRINCIPAL_OBJECT_ID> `
  -Resource <DIFFERENT_TENANT_MAILBOX> | Format-Table
```

Acceptance: `Application Mail.Send` is in scope for `security@gssg.app` and out of scope for the other mailbox. Check Entra again for an accidental unscoped `Mail.Send` grant; Exchange and Entra permissions are additive.

Allow 30 minutes to 2 hours for Exchange authorization caches when a real call initially disagrees with `Test-ServicePrincipalAuthorization`.

### Step 5: Place production configuration with feature off

After confirmation, put these in the protected production root `.env`/service environment, never source control or the database:

```text
GSSG_PASSWORD_RESET_EMAIL_ENABLED=0
GSSG_MICROSOFT_TENANT_ID=<tenant-id>
GSSG_MICROSOFT_CLIENT_ID=<client-id>
GSSG_MICROSOFT_CLIENT_SECRET=<secret-value>
GSSG_PASSWORD_RESET_SENDER=security@gssg.app
GSSG_PUBLIC_BASE_URL=https://gssg.app
```

Confirm ACLs permit only the service identity/administrator. Restarting production is a separate confirmed action.

### Step 6: Deploy code while the feature remains disabled

After explicit deployment confirmation, use the repository's production path:

```powershell
scripts\mng.ps1 update
```

Verify service health, migration 0071, and the disabled forgot endpoint's controlled 503 behavior. Do not flip the flag yet.

### Step 7: Send one confirmed Graph test message

After explicit confirmation of recipient and message, invoke the dedicated password-reset mailer with a freshly generated throwaway token that is not stored in the database. Inspect the received message and headers.

Acceptance:

- From is `GSSG Account Security <security@gssg.app>`;
- Graph returns 202;
- message contains both languages and both MIME alternatives;
- SPF, DKIM, and DMARC results match the intended policy;
- the throwaway link is invalid, as expected;
- a Graph send attempt as another mailbox is denied.

Do not include the generated token or secret in terminal/chat logs.

### Step 8: Enable and verify the real end-to-end flow

After explicit confirmation, set `GSSG_PASSWORD_RESET_EMAIL_ENABLED=1` and restart the service. Then:

1. request a reset from deployed `https://gssg.app`;
2. receive the message in an external mailbox;
3. confirm sender/host/content and SPF/DKIM/DMARC headers;
4. open the link and change the password;
5. verify old password fails and new password succeeds;
6. verify reusing the link fails;
7. verify a session opened before reset is rejected afterward;
8. verify unknown/ineligible requests retain the same public 202 response;
9. inspect sanitized service logs for provider status/request IDs only.

If any check fails, turn the feature flag back to 0, restart, and diagnose without switching to SMTP or weakening mailbox scope.

### Step 9: Record operational ownership

Record outside source control:

- secret expiry and rotation owner;
- mailbox owner/reply-monitoring decision;
- DNS ownership (Cloudflare) and Microsoft tenant ownership (GoDaddy/M365);
- quarterly check that no unscoped Entra `Mail.Send` permission has appeared;
- Graph send failure/runbook path.

No persistent reset-mail queue is added; users request a fresh link after an outage.

---

## Final acceptance checklist

- [ ] Configuration defaults off and fails startup when enabled but incomplete.
- [ ] Migration 0071 upgrades, downgrades, and re-upgrades on a temporary database.
- [ ] Only SHA-256 token hashes are persisted; links expire after 30 minutes and are single-use.
- [ ] Request endpoint cannot enumerate users and performs no DB/Graph work before responding.
- [ ] Completion is atomic under concurrent submissions and revokes all sessions.
- [ ] Graph app can send only as `security@gssg.app`.
- [ ] Email is bilingual multipart MIME and contains no account-sensitive fields.
- [ ] Forgot screen no longer shows IT contact; locked-account screen still does.
- [ ] Reset URL works for authenticated and anonymous browsers and is scrubbed from history.
- [ ] Focused tests, static checks, generated contracts, production build, and real-browser smoke pass.
- [ ] Public MX/SPF/DKIM/DMARC and received headers pass before feature enablement.
- [ ] Real deployed reset, old/new password, link reuse, and prior-session invalidation checks pass.
