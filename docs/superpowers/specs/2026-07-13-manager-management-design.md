# Admin manager management (add / edit / deactivate) — Design

**Date:** 2026-07-13
**Status:** Approved design → implementation plan
**Area:** Settings → Managers section (frontend) + `managers` API (backend)

## Problem

The Settings → Managers section only lets an admin **link/unlink a login account**
to a manager record (`PATCH /managers/{id}` with `user_id`). Manager records
themselves (name EN/AR, title, signature, active) are **import-only** — seeded once
from v3 legacy data (`app/v3_import.py`) and never editable through the app. There is
no way to **add**, **edit**, or **remove** a manager. Admins need full lifecycle
management of the document-signatory directory.

"Manager" here = a **Manager record** (`managers` table) — a signatory whose
name/title/signature is printed on generated documents and who can approve/sign them.
This is distinct from a User's **role** (operator/manager/admin), which is managed on
the Access Requests screen and is out of scope.

## Goals

- Admin can **add** a new manager (name EN/AR, title, optional signature, optional user link).
- Admin can **edit** an existing manager's name EN/AR, title, signature, and active flag.
- Admin can **deactivate** a manager (soft delete). Deactivated managers disappear from
  the signatory pickers and from the Settings list.
- Signature is captured with the **existing draw/upload flow** (`SignatureDrawPanel`),
  matching how employee/signing signatures work today.
- Existing user-link behaviour is preserved unchanged.

## Non-goals

- Hard-deleting managers (documents reference `Book.doc_manager_id`; a hard delete would
  orphan those references). Deactivation only.
- A "reactivate" control in the UI. Deactivation is hidden from the list; reactivation is
  not surfaced (recoverable via API/DB if ever needed — see Decisions).
- Changing a User's account **role** (operator/manager/admin) — that lives on Access Requests.
- No database migration: the `managers` table already has every needed column.

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Operations | Add + Edit + Deactivate |
| Delete semantics | Soft delete via `active=false`; **no hard delete** |
| Signature capture | Reuse `SignatureDrawPanel` (draw or upload PNG) |
| Deactivated managers in list | **Hidden** (not shown, no reactivate button). Deactivate uses a confirm dialog for safety. |
| Permission | `settings.edit` (admin-only), same gate as today's linking |

## Data model

**No migration required.** `Manager` (`backend/app/db/models.py:439`) already has:
`id`, `name_en`, `name_ar`, `title`, `sig_path` (Text, absolute file path used by the
`{{ manager_sig }}` embed), `active` (default true), `user_id` (nullable login link).

## Backend

### Schemas — `app/schemas/manager.py`
- `ManagerCreate`: `name_en: str | None`, `name_ar: str | None`, `title: str | None`,
  `active: bool = True`, `user_id: int | None = None`.
  Validation: **at least one of `name_en` / `name_ar` must be non-blank** (else 422).
- `ManagerUpdate`: all fields optional (`name_en`, `name_ar`, `title`, `active`, `user_id`) —
  a partial patch. Keep `ManagerLinkUpdate` working: existing link calls send `{user_id}`,
  which is a subset of `ManagerUpdate`, so the PATCH endpoint accepts `ManagerUpdate` and the
  current frontend link call is unaffected.
- `ManagerRead`: unchanged (already carries `user_name` enrichment). Add a
  `has_signature: bool` computed field (derived from `sig_path` file existence) so the UI can
  show a signature status pill without a second request.

### Service — `app/services/manager_service.py`
- `list_managers(db, include_inactive=False)` — default returns `active` only (sorted by
  name_en). The `include_inactive` param keeps the door open for a future toggle without an
  API redesign; the default UI never sets it.
- `create_manager(db, data: ManagerCreate) -> Manager`.
- `update_manager(db, manager_id, data: ManagerUpdate) -> Manager` (partial; `NotFoundError`
  if missing). Supersedes `set_manager_user` (which becomes a thin call into this, or the
  route calls `update_manager` directly).
- `manager_signature_path(manager_id) -> Path` — `data_dir/signatures/managers/manager_{id}.png`,
  with vault-style containment guard (resolve + assert under `data_dir`).
- `has_signature(manager) -> bool` — `sig_path` set and the file exists.

### Routes — `app/api/v1/managers.py` (all gated `require_capability("settings.edit")`
except `GET`, which stays open like today)
- `GET /managers` — unchanged (active only).
- `POST /managers` → `ManagerRead` — create.
- `PATCH /managers/{id}` → `ManagerRead` — now accepts full `ManagerUpdate` (was link-only).
- `POST /managers/{id}/signature` — upload; `signature_core.normalize_to_png`, save to
  `manager_signature_path(id)`, set `manager.sig_path` to that path. Mirrors
  `employees.py:upload_signature`.
- `GET /managers/{id}/signature` — raw PNG or `?encoding=base64` text/plain (mirrors the
  employee route, including `X-Signature-Updated` mtime header).
- `DELETE /managers/{id}/signature` — unlink file (idempotent), null `sig_path`.

No `DELETE /managers/{id}` — deactivation is `PATCH {active:false}`.

### Signature storage location
New directory `data_dir/signatures/managers/`, created on demand (extend
`ensure_dirs` or mkdir-parents in the path helper). Existing imported managers keep their
original `sig_path` until re-saved through the new UI, at which point the path is rewritten
to the canonical location.

## Frontend

### Extract `ManagersSection` into its own file
Move `ManagersSection` out of `SettingsPage.tsx` into
`frontend/src/pages/settings/ManagersSection.tsx` (it grows past a simple inline component).
SettingsPage keeps the `<CapabilityGate cap="settings.edit"><ManagersSection /></CapabilityGate>`
mount.

### `api.ts` additions
`createManager(body)`, `updateManager(id, body)`, `uploadManagerSignature(id, blob)`,
`getManagerSignature(id)`, `deleteManagerSignature(id)`. Then resync `api.types.ts` via the
`/sync-api-types` skill; commit `openapi.json` + `api.types.ts` together.

### UI behaviour
- **List**: active managers only. Each row shows name (`dir="auto"`), title, a signature
  status pill (from `has_signature`), the existing **user-link dropdown**, an **Edit** button,
  and a **Deactivate** button.
- **Add**: "Add manager" button reveals a form — `name_en`, `name_ar`, `title`, active
  (default on), and an inline `SignatureDrawPanel` (`showSaveToProfile={false}`). On submit:
  `POST /managers` → take the new id → if a signature was drawn/uploaded,
  `POST /managers/{id}/signature`. One mutation orchestrates both; invalidate `['managers']`.
- **Edit**: same form pre-filled. Signature managed like the employee `SignaturePad`
  (show current image via `getManagerSignature` → Replace / Remove). Fields patch via
  `PATCH /managers/{id}`.
- **Deactivate**: `ConfirmDialog` → `PATCH /managers/{id}` with `{active:false}`; the row
  drops out of the list on refetch.

### i18n
New keys under `settings.managers.*` in both `en.json` and `ar.json` (add, edit, deactivate,
confirm text, name EN, name AR, title, signature, added/updated/deactivated toasts).
Reviewed by `i18n-rtl-reviewer`.

## Testing

**Backend (`backend/tests/`):**
- create manager (happy path) → row persisted, returned `ManagerRead`.
- create with blank name_en **and** name_ar → 422.
- update name/title/active (partial patch) → only supplied fields change.
- deactivate (`active=false`) → excluded from default `GET /managers`.
- user-link via PATCH still works (regression).
- signature upload → file at canonical path, `sig_path` set, `has_signature=true`;
  get (raw + base64); delete → file gone, `sig_path` null.
- capability gating: non-admin (no `settings.edit`) → 403 on POST/PATCH/signature routes.

**Frontend (`ManagersSection.test.tsx`):**
- add flow (fill form, submit, list refetch shows new manager).
- edit flow (pre-fill, patch).
- deactivate flow (confirm dialog → manager removed from list).

## Rollout

Standard: branch → TDD → gates (pytest, ruff, mypy, vitest, tsc, eslint) → `/sync-api-types`
→ i18n-rtl-reviewer → merge to `main` → **push to origin/main** (live checkout) → user deploys
via `mng update`/`deploy`.
