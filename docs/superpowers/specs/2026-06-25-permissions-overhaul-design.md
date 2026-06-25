# Permissions Overhaul — Design Spec

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan

## Summary

Two related improvements to the capability/permission system, sharing one
foundation:

1. **Permission requests** — when an employee hits a blocked action, the UI
   shows it (locked) and offers to *request* the permission. The request
   reaches admins, who **grant it once** (time-limited), **grant it
   permanently**, or **refuse**.
2. **Explained permission editor** — replace the cramped per-user permissions
   side-panel with a spacious, grouped, *described* layout so an admin always
   sees what each permission allows before granting it.

The shared foundation is a **capability registry with descriptions** plus
**expiry-capable grants**.

## Goals

- Employees can discover and request permissions they lack instead of silently
  hitting hidden/blocked controls.
- Admins decide per request: grant once (auto-expiring), grant permanently, or
  refuse — and are notified when a request arrives.
- Admins manage per-user permissions in a clear, self-documenting screen.

## Non-goals

- No change to the role model or role presets.
- `users.manage` and `system.admin` remain **non-grantable** via override and
  therefore non-requestable.
- No approval-chain/multi-approver flow for requests — any admin can decide.
- No bulk request handling in v1 (one request = one capability for one user).

## Existing pieces reused (from code exploration)

- **Capability catalog:** `backend/app/core/permissions.py` — `CAPABILITIES`
  tuple of `Capability(id, domain, label)` (22 caps), `CAPABILITY_IDS`,
  `ROLE_DEFAULTS`.
- **Resolution:** `perm_service.effective_caps(db, user)` = role defaults +
  `grant` overrides − `deny` overrides; admins short-circuit to all caps.
  `set_user_override(db, user_id, cap, effect, *, actor)` writes/clears a
  `user_permissions` row. `_SENSITIVE_CAPS = {users.manage, system.admin}` are
  hard-blocked from override.
- **Models:** `UserPermission(user_id, capability, effect)` with
  `effect IN ('grant','deny')`; `RolePermission(role, capability)`.
- **Gate + 403:** `deps.require_capability(cap)` raises
  `AppError("FORBIDDEN", "Missing capability: <cap>", http_status=403)`;
  envelope is `{error:{code,message,details}}` — **cap name only in `message`
  today**.
- **Frontend gating:** `useCapabilities().has(cap)`; `CapabilityGate` (hides
  child via `fallback=null`); `RequireCapability` (route → `<Navigate to="/">`).
  Single 403 chokepoint: `unwrap()` in `lib/api.ts` throwing `ApiError`.
- **Admin UI:** `pages/access/AccessRequestsPage.tsx` (account-signup review +
  user admin, gated `users.manage`) embeds `components/access/UserPermissionsSheet.tsx`
  (tri-state Default/Grant/Deny per cap). Endpoints in `api/v1/auth.py`:
  `GET /auth/users/{id}/permissions`, `PUT /auth/users/{id}/permissions`.
- **Admins:** `select(User).where(role == ADMIN_ROLE, status == 'active')`.
- **Push:** `push_service.send_to_user(db, user_id, {locale:(title,body)}, url)`;
  durable `push_sent` ledger keyed `(user_id, kind, ref)`.

> Note: the existing `AccessRequestsPage` handles **account signups**
> (`User.status == 'pending'`), NOT permission requests. The permission-request
> entity is new.

## Key decisions (confirmed)

- **"Grant once" = time-limited grant.** Admin picks a window — **2 hours /
  today (end of day) / this week (7 days)** — after which the grant
  auto-revokes. The employee can use the capability freely until expiry.
- **Blocked controls are shown, not hidden.** Visible with a 🔒 badge; clicking
  opens the request dialog. Blocked pages show a "request access" screen.
- **Admin home = the existing Access Requests page**, extended with a
  "Permission requests" tab; the side-panel editor is replaced in place with
  the explained layout.

## Capability registry (foundation)

Extend `core/permissions.py` `Capability` from `(id, domain, label)` to include
`description: str`. Author a plain-language description for all 22 capabilities
(e.g. `books.approve` → "Approve and sign documents in the approval queue";
`leaves.edit` → "Create and edit leave records"). Expose `description` through:

- `GET /auth/capabilities` (catalog) — add `description` to each entry.
- The frontend capability catalog type, used by both the request dialog and the
  explained editor.

EN strings live in code (the catalog); Arabic descriptions live in the i18n
files keyed by capability id, looked up client-side, so the explained editor and
request dialog localize.

## Data model

### `user_permissions.expires_at` (new column, nullable `DateTime`)
- `NULL` → permanent grant/deny (current behavior, unchanged).
- A timestamp → temporary grant. `effective_caps` treats an **expired** `grant`
  row as absent. A sweep deletes expired rows so the table stays clean and audit
  is truthful. (Only meaningful for `effect='grant'`; denies are always
  permanent.)

### `permission_requests` (new table)
| column | type | notes |
|---|---|---|
| `id` | int PK | |
| `user_id` | FK users.id CASCADE | the requester |
| `capability` | str | must be in `CAPABILITY_IDS`, not sensitive |
| `status` | str | `pending` \| `granted` \| `refused` |
| `decision` | str \| null | `once` \| `permanent` \| `refused` (set when decided) |
| `note` | str \| null | optional admin note / refuse reason |
| `created_at` | DateTime | |
| `decided_by_user_id` | FK users.id \| null | |
| `decided_at` | DateTime \| null | |

Unique partial constraint: at most **one `pending` row per (user_id,
capability)** — re-requesting an already-pending cap updates `created_at`
(re-pings admins) rather than creating duplicates. (Enforced in the service;
SQLite partial-unique index where supported.)

Migration: `0042_permission_requests` — adds the column and the table
(additive; downgrade reverses).

## Backend

### Resolution & grants
- `effective_caps`: when applying a `grant` override, skip it if
  `expires_at is not None and expires_at <= now`.
- `set_user_override`: add optional `expires_at: datetime | None = None`,
  persisted on the row. Existing callers pass `None` (permanent) — unchanged.
- **Expiry sweep:** a new scheduler job (or fold into the existing 1-minute
  tick) deletes `user_permissions` rows where
  `effect='grant' AND expires_at <= now`. Idempotent, cheap.

### 403 envelope
`require_capability` includes the missing cap in `details`:
`AppError("FORBIDDEN", "Missing capability: <cap>", http_status=403,
details={"capability": cap})`. Frontend reads `err.details.capability`.

### Permission-request service + endpoints
New `permission_request_service` and router (prefix `/permissions`):
- `POST /permissions/requests` `{capability}` (any authed user) → create/refresh
  a pending request. Guards: cap exists, not sensitive, user doesn't already
  have it (else 409/no-op), not already pending (refresh). On create → notify
  admins.
- `GET /permissions/requests?status=pending` (admin, `users.manage`) → list with
  requester display name + capability label/description.
- `POST /permissions/requests/{id}/decide` (admin) body
  `{decision: 'once'|'permanent'|'refused', window?: '2h'|'today'|'week', note?}`:
  - `permanent` → `set_user_override(grant, expires_at=None)`, status=granted.
  - `once` → compute `expires_at` from `window`,
    `set_user_override(grant, expires_at=...)`, status=granted.
  - `refused` → status=refused, store note.
  - Always: set `decided_by_user_id`, `decided_at`; audit via
    `auth_service.audit_permission_change` where a grant happened.

### Notifications
On a new request, push **every active admin** via `push_service.send_to_user`
with a new ledger kind `access_request` (ref `access_request:{id}`), deep-linked
to `/access?tab=permission-requests` (or the page's route), localized EN/AR
("<name> requested <capability>"). Also drives the in-app bell via
`notification_service` (admin-only actionable item of kind `access_request`).

## Employee experience

- **`CapabilityGate` "lock mode":** a new prop (e.g. `requestable`) renders the
  child **visible** wrapped so a missing cap shows a 🔒 affordance and
  intercepts the click to open `PermissionRequestDialog(capability)` instead of
  the child's action. Default behavior (hide) preserved for call sites that opt
  out or for sensitive caps.
- **`PermissionRequestDialog`:** shows the capability's name + description,
  "You don't have permission to *<label>*. Request access?" → **[Request]**
  (POST the request, toast "Request sent") / **[Close]**. If a request is
  already pending, show "Request pending" instead.
- **Blocked pages (`RequireCapability`):** render a "You don't have access to
  *<page>*" screen with a **Request access** button, instead of redirecting home.
- **API fallback:** `unwrap()`/a React Query error handler detects
  `status===403 && code==='FORBIDDEN'` with `details.capability` and surfaces the
  same dialog, covering any control that slips through.

## Admin experience

### Permission requests tab (on Access Requests page)
New tab listing pending requests: requester, capability **name + description**,
when asked. Per row: **[Grant once ▾]** (window picker: 2h / today / this week),
**[Grant permanent]**, **[Refuse]** (optional note). Decisions call the decide
endpoint and refresh the list + the user's effective caps. Decided requests move
to a collapsed history.

### Explained permission editor (replaces the side-panel)
Full-width, in-place editor (still launched from a user's row):
- Capabilities **grouped by domain** with a section header per domain.
- Each capability shows its **name + description**, the tri-state
  Default / Grant / Deny control, and — for temporary grants — a small
  "expires <when>" chip with a way to clear it early.
- Admin users keep the "all caps, controls disabled" treatment.
- Saves via the existing `PUT /auth/users/{id}/permissions` (extended to accept
  an optional `expires_at` when granting, mirroring `set_user_override`).

## Edge cases

- Sensitive caps (`users.manage`, `system.admin`): never requestable, never
  shown as lock-to-request, never grantable via override (existing guard).
- Requesting a cap you already have (incl. via role): no-op with a friendly
  message.
- Duplicate pending requests collapse to one (refresh timestamp).
- Expiry is enforced centrally (resolution skips expired + sweep deletes), so a
  stale grant never leaks.
- Admin can't change their own permissions (existing guard) — and can't action
  a request that would grant themselves (n/a, requests come from non-admins).
- Refused requests don't write a `deny` (a refusal just means "not now"); the
  employee may re-request later.

## Testing

- `effective_caps` ignores an expired grant; honors a future-dated grant.
- Expiry sweep deletes only expired `grant` rows, leaves permanent + deny rows.
- Request lifecycle: create → notify admins → grant-once (window math) → usable
  → expiry revokes; grant-permanent persists; refuse marks refused.
- Re-request collapses to the single pending row.
- 403 envelope carries `details.capability`.
- Sensitive caps rejected at request and decide endpoints.

## Build order (phasing)

1. **Foundation:** capability descriptions + `user_permissions.expires_at` +
   `effective_caps`/`set_user_override` expiry + sweep + 403 `details.capability`.
2. **Request flow (employee):** `permission_requests` model/migration + service
   + create endpoint; `PermissionRequestDialog`, `CapabilityGate` lock mode,
   blocked-page screen.
3. **Admin decisions + notifications:** list/decide endpoints, Permission
   requests tab, admin push/bell.
4. **Explained editor:** redesign `UserPermissionsSheet` into the grouped,
   described, expiry-aware editor.

Each phase is independently shippable and leaves the app working.
