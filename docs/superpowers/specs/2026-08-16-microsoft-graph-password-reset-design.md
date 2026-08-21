# Microsoft Graph password reset — design

**Date:** 2026-08-16
**Area:** `backend/app/api/v1/auth.py`, `backend/app/services/auth_service.py`, new password-reset/mail services, `backend/app/db/models.py`, `backend/app/config.py`, `frontend/src/pages/auth/LoginPage.tsx`, auth API client/types, `frontend/src/locales/{en,ar}.json`
**External systems:** Microsoft 365 Exchange Online, Microsoft Entra, Microsoft Graph, Cloudflare DNS

## Problem

The public login page offers **Forgot password?**, but the resulting screen only tells the user to contact IT. Sentinel has an admin-only reset endpoint (`POST /api/v1/auth/users/{user_id}/reset-password`) and no self-service reset-token model, public request/complete endpoints, or transactional mail transport.

The existing outbound mail service is not a suitable reset-email transport. `backend/app/services/email_service.py` is an operator mailbox feature: it decrypts each user's IONOS SMTP password, sends as that user's account, and writes a correspondence-ledger entry. Password-reset mail needs one application-owned sender, no mailbox password, no user-mailbox dependency, no correspondence side effects, and a least-privilege Microsoft authorization boundary.

`gssg.app` is registered through GoDaddy, but its authoritative name servers are Cloudflare (`elias.ns.cloudflare.com`, `evangeline.ns.cloudflare.com`). Public DNS currently publishes neither MX nor SPF TXT records. Microsoft 365 reports the domain as healthy and the tenant exposes Entra App registrations; domain ownership and Graph application provisioning are therefore available, but Exchange mail routing/authentication records still need to be activated in Cloudflare.

## Goal

An eligible Sentinel user can request a password-reset email from the public login page, follow a 30-minute single-use link sent from `security@gssg.app`, choose a new password, and sign in normally. The public request flow must not reveal whether an email address is registered. A successful reset revokes every existing session and clears a temporary login lock.

## Approved decisions

- Microsoft Graph, not SMTP, sends the reset email.
- Sender: shared mailbox **GSSG Account Security** `<security@gssg.app>`.
- Exchange Application RBAC grants `Application Mail.Send` only over that mailbox.
- No parallel tenant-wide `Mail.Send` grant in Entra; such a grant would union with and defeat the Exchange mailbox scope.
- Client-credential authentication uses a rotating client secret stored in Sentinel's ACL-protected production `.env`.
- Reset token: 32 random bytes, SHA-256 hash at rest, 30-minute expiry, single use.
- The request endpoint always gives the same accepted response for eligible and ineligible addresses.
- Reset email contains Arabic and English; the requested locale controls which language appears first.
- Password reset does not create a session. The user signs in with the new password.
- The separate locked-account IT-contact screen remains unchanged.

## Non-goals

- No Microsoft/Entra single sign-on.
- No email-address verification or account-email change flow.
- No rewrite of the operator IONOS mailbox/ledger service.
- No automatic purchase of a GoDaddy/Microsoft license.
- No automatic DNS, mailbox, Entra, Exchange, or production changes. Each external change is a separate operator-confirmed action.
- No persistent general-purpose mail queue. A reset email is low-volume and may be requested again after a provider/process failure.
- No automatic login after reset.
- No change to the existing minimum password length or bcrypt helper.

## Microsoft 365 and DNS architecture

### Sender mailbox

Create `security@gssg.app` as a Microsoft 365 shared mailbox with display name **GSSG Account Security**. Direct sign-in remains blocked. Add the IT administrator as a member only if replies need monitoring. Microsoft documents that a shared mailbox normally needs no separate license below 50 GB unless advanced retention/archive scenarios apply.

If the GoDaddy-managed tenant exposes only a paid user mailbox instead of shared-mailbox creation, stop before purchase. A licensed user mailbox is technically compatible with the Graph endpoint, but its plan and price require explicit approval.

### Authoritative DNS

Mailbox creation and email-product management may occur in GoDaddy/Microsoft 365, but DNS changes must occur in Cloudflare while Cloudflare remains authoritative. In Microsoft 365 Admin Center, open `Settings -> Domains -> gssg.app -> DNS records` and copy the tenant-specific values rather than guessing them.

Required rollout records:

1. Microsoft-provided MX record.
2. SPF TXT record, with exactly one SPF policy for the root domain.
3. Autodiscover CNAME.
4. Both Microsoft-provided DKIM selector CNAME records; enable DKIM after they resolve.
5. DMARC TXT record after verified test delivery, beginning with an observation policy and tightening only after legitimate sources are known.

Cloudflare record proxying must be disabled for mail/DNS-authentication records. Final acceptance requires public resolvers, not only the Microsoft admin UI, to show the intended values.

### Entra and Exchange authorization

Register one Entra application: **Sentinel Password Reset Mailer**. Create the corresponding Exchange service-principal pointer and a resource scope matching only `security@gssg.app`. Assign Exchange's `Application Mail.Send` application role through Exchange Application RBAC.

Do not also add Microsoft Graph `Mail.Send` as an organization-wide Entra application permission. Microsoft documents that Exchange RBAC and Entra grants are independent and additive; an unscoped Entra grant would allow every mailbox despite the scoped Exchange role.

Provisioning acceptance uses `Test-ServicePrincipalAuthorization` against:

- `security@gssg.app`: `InScope = True` for `Application Mail.Send`.
- A different mailbox: no effective send permission / `InScope = False`.

After authorization caches settle, a real Graph call must succeed only for the scoped sender.

## Runtime configuration

Add settings following the existing `GSSG_*` environment convention:

```text
GSSG_PASSWORD_RESET_EMAIL_ENABLED=0
GSSG_MICROSOFT_TENANT_ID=
GSSG_MICROSOFT_CLIENT_ID=
GSSG_MICROSOFT_CLIENT_SECRET=
GSSG_PASSWORD_RESET_SENDER=security@gssg.app
GSSG_PUBLIC_BASE_URL=https://gssg.app
```

`password_reset_email_enabled` defaults false for local/dev installs. When enabled, an empty tenant ID, client ID, client secret, sender, or HTTPS public base URL is a startup configuration error. Sentinel must never silently fall back to the IONOS mail service or expose the forgot form as operational with incomplete credentials.

The production client secret lives only in the protected root `.env`/service environment, never the database, source tree, frontend bundle, logs, or API. Rotation replaces the environment value and restarts the service before the Entra credential expires.

## Persistence contract

Add `PasswordResetToken` after the current migration head:

```python
class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int]                         # integer primary key
    user_id: Mapped[int]                    # FK users.id, CASCADE
    token_hash: Mapped[str]                 # SHA-256 hex, String(64), unique
    created_at: Mapped[datetime]
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
```

Indexes:

- unique index on `token_hash` for lookup;
- index on `(user_id, used_at)` for invalidating a user's outstanding tokens;
- index on `expires_at` only if cleanup/query evidence requires it; the initial flow does not scan by expiry.

The raw token exists only in process memory and the reset URL. New issuance marks all earlier unused rows for the same user used at the current UTC time, preserving a small audit trail without leaving multiple valid links.

Expired/used rows may be removed by a bounded opportunistic cleanup during later issuance. No scheduler is required solely for this table.

## Public API contract

### Request a link

`POST /api/v1/auth/password-reset/request`

```python
class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=3, max_length=256)
    locale: Literal["en", "ar"] = "en"


class PasswordResetRequestResult(BaseModel):
    status: Literal["accepted"] = "accepted"
```

Successful public response: `202 Accepted` with `{"status": "accepted"}` for all syntactically valid requests, including unknown or ineligible users.

Eligibility is `User.status in {"active", "locked"}`. Pending, rejected, and disabled accounts receive no token/email. No response field, error text, status code, or materially different Graph wait exposes eligibility.

The route:

1. Normalizes the email exactly as `auth_service` does.
2. Applies an IP limiter. High-volume IP abuse returns the existing generic 429 envelope.
3. Applies a normalized-address limiter. An address over its limit still receives the ordinary accepted response and schedules no work.
4. Adds a background task containing only the normalized address and locale.
5. Returns immediately, before user lookup or Graph I/O.

The background task opens its own database session, resolves eligibility, invalidates older links, persists a fresh hash/expiry, builds the bilingual message, and calls Graph. It must not reuse a request-scoped SQLAlchemy session after the response.

Initial limits:

- 20 request attempts per IP per 15 minutes;
- 3 effective issues per normalized email per 15 minutes.

These are process-local, matching Sentinel's existing single-process production model and `RateLimiter` implementation.

### Complete a reset

`POST /api/v1/auth/password-reset/complete`

```python
class PasswordResetCompleteRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    password: str = Field(min_length=8, max_length=128)
    password_confirmation: str = Field(min_length=8, max_length=128)


class PasswordResetCompleteResult(BaseModel):
    status: Literal["reset"] = "reset"
```

Mismatched passwords return 422. Invalid, expired, already-used, or ineligible-token cases share one `400 PASSWORD_RESET_LINK_INVALID` error message. A caller holding a token may learn only whether that token is usable, not account state.

Completion is one database transaction:

1. Hash the submitted raw token with SHA-256.
2. Find the row and atomically claim it only when `used_at IS NULL` and `expires_at > now`.
3. Require the related user to remain active or locked.
4. Hash/store the new password using the existing security helper.
5. Clear `failed_attempts` and `locked_at`; change `locked` to `active`.
6. Mark every other unused reset token for the user used.
7. Revoke all `AuthSession` rows for that user in the same transaction.
8. Write the existing `reset_password` audit action with actor `self-service`.
9. Commit.

Concurrent submissions for the same token must allow exactly one transaction to claim it. Refactor the current admin reset internals only as needed to share staged password/session-reset behavior; keep the existing admin API contract unchanged.

The completion response also deletes the current `gssg_session` cookie. This handles the case where an already-signed-in browser opens the email link; server-side sessions are revoked and the stale cookie is removed together.

## Microsoft Graph mailer

Add a dedicated transactional mail module rather than extending `email_service.py`. The module has one narrow contract:

```python
def send_password_reset_email(*, recipient: str, raw_token: str, locale: str) -> None:
    ...
```

Implementation responsibilities:

1. Acquire/cache an application token with Microsoft's authentication library using the client-credential flow and `https://graph.microsoft.com/.default`.
2. Construct the reset URL from validated `public_base_url`.
3. Render plain-text and HTML content from application-owned templates; escape all values.
4. Call:

```http
POST https://graph.microsoft.com/v1.0/users/security@gssg.app/sendMail
```

5. Set `saveToSentItems` true/default.
6. Accept only Graph `202 Accepted` as successful handoff.
7. On failure, record the provider status/error code and Microsoft request/correlation ID without logging recipient, token, message body, access token, client credential, or reset URL.

A Graph `202` means accepted, not guaranteed final delivery. Real DNS/header verification therefore remains part of rollout.

If Graph rejects the handoff before acceptance, the task invalidates the newly issued token. The public request response has already remained generic; the user can request a new link after the operational problem is resolved.

## Email contract

Subject includes both languages, for example:

```text
Reset your GSSG Manager password | إعادة تعيين كلمة المرور
```

The locale controls whether Arabic or English appears first; both are always present. Each language section contains:

- reset-password heading;
- a primary link/button and visible plain URL;
- 30-minute expiry statement;
- instruction to ignore the message if the recipient did not request it;
- support identity, without exposing internal administrator personal details.

The email never contains a password, G-number, role, account status, employee data, or administrative contact's personal phone number.

## Frontend

### Forgot screen

Replace the forgot-only IT-contact panel in `LoginPage.tsx` with:

- email field, prefilled from the selected/typed login account when available;
- **Send reset link** button;
- submitting state;
- generic accepted state matching the backend's non-enumerating copy;
- temporary-unavailable error only for provider/config/service failures visible as actual API errors.

The current `ItContact` component remains for the locked-account screen. Removing it only from `ForgotScreen` is the requested clean cutover.

### Public reset route

Recognize `/reset-password?token=...` before the normal authenticated/anonymous app gate so the reset screen works even when the browser currently holds a session. The reset page:

1. Captures the token into component memory.
2. Immediately replaces browser history to remove the query value from the address bar.
3. Shows new-password and confirmation fields using existing password-field/accessibility patterns.
4. Submits the complete request.
5. On success, clears the frontend auth user, shows confirmation, and returns to normal sign-in.
6. Shows one localized invalid/expired/used-link state for `PASSWORD_RESET_LINK_INVALID`.

No token enters localStorage, sessionStorage, analytics, error telemetry, clipboard, or page-rendered debug output. Add an appropriate referrer policy to prevent URL leakage during the initial navigation.

### API and i18n

Add typed frontend API methods for request/complete, regenerate `backend/openapi.json`, then regenerate `frontend/src/lib/api.types.ts`. Add complete English and Arabic copy for the request form, accepted state, reset form, password mismatch, success, invalid link, and temporary unavailability.

## Failure behavior

| Failure | Public behavior | Internal behavior |
| --- | --- | --- |
| Unknown/ineligible email | Generic 202 | No token or Graph call |
| Address rate limit | Generic 202 | No token or Graph call |
| IP abuse limit | Existing generic 429 | No background task |
| Configuration disabled/incomplete | Service unavailable; no fake success | Startup failure when enabled but incomplete; clear operational log |
| Graph token/send failure | Request already returned generic 202 | Invalidate issued token; log sanitized provider identifiers |
| Invalid/expired/used reset token | One generic 400 error | No password/session mutation |
| Concurrent token submission | One success, remaining requests generic 400 | Atomic claim + transaction |
| Process stops after request response | User may not receive email and can request again | Next issuance invalidates old outstanding token |

## Security invariants

- Request response does not enumerate accounts.
- Graph I/O occurs after the public response.
- Only a hash of each reset token is stored.
- One reset token has one successful use and a 30-minute maximum life.
- A reset revokes every live session and removes the current cookie.
- App authorization can send only as `security@gssg.app`.
- No SMTP/basic-auth mailbox password exists in this flow.
- No secrets, recipients, raw tokens, or complete reset URLs appear in logs.
- No link GET consumes a token.
- Provider failure cannot leave the just-issued token active after a known Graph rejection.

## Testing

### Backend

Focused tests cover observable contracts:

- known-active, known-locked, unknown, pending, rejected, and disabled request cases return the same public request shape/status;
- background task, not request timing, performs lookup and Graph work;
- unknown/ineligible/rate-limited addresses create no token and send no message;
- raw token differs from the persisted SHA-256 hash and cannot be recovered from the row;
- a new issuance invalidates an older unused token;
- expired, used, unknown, and status-ineligible tokens return the same public error;
- password mismatch returns validation error before mutation;
- successful completion changes the password, clears lock counters, activates a locked user, revokes all sessions, invalidates sibling tokens, and writes the audit action;
- two concurrent completions permit exactly one success;
- transaction rollback leaves password/token/sessions consistent after an injected failure;
- Graph request targets `/users/security@gssg.app/sendMail`, carries the right recipient/content, and treats only 202 as accepted;
- sanitized Graph failure logs exclude email, raw token, reset URL, access token, and client secret;
- enabled-but-incomplete mail configuration fails validation.

### Frontend

Focused component tests cover:

- Forgot screen prefills the current email and no longer renders IT contact details;
- request submits once, disables during submission, and always shows generic accepted copy;
- `/reset-password?token=...` captures then removes the token from the URL;
- mismatched passwords do not call the API;
- success clears auth state and offers sign-in;
- invalid/expired/used error renders the shared localized state;
- EN/AR content and RTL layout preserve accessible labels and focus order.

## Real rollout verification

Keep `GSSG_PASSWORD_RESET_EMAIL_ENABLED=0` until all external prerequisites pass.

1. Public DNS resolvers return Microsoft's MX and SPF values.
2. DKIM selectors resolve and Microsoft reports DKIM enabled.
3. DMARC exists in observation mode.
4. Exchange authorization test is in-scope for `security@gssg.app` and out-of-scope for another mailbox.
5. Graph sends a test message to an external mailbox.
6. Received headers show expected SPF, DKIM, and DMARC results.
7. Deployed login page requests a real reset.
8. Message arrives with the correct host/sender/content.
9. Link changes the password.
10. Old password fails; new password succeeds.
11. Reusing the link fails.
12. A session opened before the reset is rejected afterward.

Only after these checks does production enable the feature. DNS edits, mailbox creation, Entra registration, Exchange permission grants, secret placement, service restart, and production enablement require exact point-of-change confirmation.

## Source references

- Microsoft Graph `sendMail`: https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0
- Exchange Online Application RBAC: https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac
- Create a Microsoft 365 shared mailbox: https://learn.microsoft.com/en-us/microsoft-365/admin/email/create-a-shared-mailbox?view=o365-worldwide
- Add Microsoft 365 domain DNS records: https://learn.microsoft.com/en-us/microsoft-365/admin/get-help-with-domains/create-dns-records-at-any-dns-hosting-provider?view=o365-worldwide
- Microsoft 365 SPF: https://learn.microsoft.com/en-us/defender-office-365/email-authentication-spf-configure
- Microsoft 365 DKIM: https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure
- Microsoft 365 DMARC: https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure
