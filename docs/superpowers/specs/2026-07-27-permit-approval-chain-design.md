# Permit letters: approval chain instead of auto-sign

**Date:** 2026-07-27
**Status:** Approved (design), pending implementation plan

## Problem

Creating or editing a security permit generates its 1/5 General Book letter with
`force_manager_embed=True` (`permit_service.regenerate_permit_book`), stamping the
manager's signature instantly with no review. Permits must instead ride the same
approval chain every other book uses: submit → manager approves → signature
stamped at sign time.

## Decisions (user-confirmed)

1. **Auto-send behind a switch, default OFF.** The New Permit form gets a Switch
   (notify-employee-toggle pattern, not a checkbox). OFF (default) = generate the
   letter as a draft so the operator can double-check it. ON = auto-submit to the
   selected manager right after generation.
2. **Manual send from the permit detail.** A "Send for approval" button on
   PermitDetailDialog (visible while draft, hidden when revoked), plus a
   bilingual approval-state badge (Draft / Pending / Approved).
3. **Regeneration auto-resubmits if already in the loop.** Any roster/vehicle
   change, edit, or renewal regenerates the letter as a new version. If the
   book's approval state was `pending` or `approved` before regeneration, the new
   version is auto-resubmitted to the manager. Never-sent permits stay draft.
   A `rejected`/`returned` letter does NOT auto-resubmit on regeneration — the
   operator fixes the permit and explicitly resends via the button.

## Backend

- `regenerate_permit_book`: drop `force_manager_embed` — letters render unsigned.
  Capture `book.approval_state` *before* regenerating; after generation call
  `book_service.submit_for_approval(...)` when (a) this is a create with
  `send_for_approval=True`, or (b) the prior state was `pending`/`approved`.
  Approver passes `approver_user_id=None` → resolves from
  `Book.doc_manager_id → Manager.user_id` (existing logic). `submitted_by_user_id`
  = the actor's User row (already resolved in `regenerate_permit_book`).
- **Resilience:** auto-submit wraps `ValidationFailedError` (e.g. manager not
  linked to an active account) — log + audit (`permit.book_submit_failed`), book
  stays draft, permit mutation still succeeds. The Draft badge makes it visible.
- `PermitCreate` schema: `send_for_approval: bool = False`.
- New endpoint `POST /permits/{id}/submit-approval` (same permission gate as the
  other permit mutations): resolves `permit.book_id`, calls
  `book_service.submit_for_approval` directly — errors surface (manual path does
  NOT swallow; operator sees "link the manager in Settings → Managers").
- `PermitRead`: add `approval_state: str | None` (the linked Book's
  `approval_state`, verbatim; `to_read` already fetches the Book row). Detail
  only — no list-item field, no register column (register opens the detail).

## Frontend

- **PermitFormDialog** (create mode only): "Send for approval" Switch, default
  OFF, sends `send_for_approval` in the create payload.
- **PermitDetailDialog:** approval-state badge + "Send for approval" button.
  Badge covers all book states: `none`→Draft, `pending`, `approved`,
  `rejected`, `returned` (bilingual). Button shown when `approval_state` is
  `none`/`rejected`/`returned`/null and permit not revoked. Calls the new
  endpoint, invalidates permit queries, error toast on failure.
- i18n: en/ar keys for switch label, badge states, button, errors. i18n tests
  assert the Arabic strings (per `i18n-tests-must-assert-arabic`).
- Resync `api.types.ts` via `/sync-api-types` after the schema change.

## Unchanged (reused wholesale)

- Manager-side approve/reject/sign UI and notifications (dashboard
  WaitingApprovalsCard, Books page, `sign_book` stamping, signed-PDF swap on the
  permit's existing print/download button).
- Revocation: no book action; the send button just hides.

## Edge cases

- Manager without linked account: auto-send → draft + audit; manual → error.
- No manager chosen: `resolve_manager` fallback sets `doc_manager_id`; if still
  none, same APPROVER_REQUIRED error path.
- Existing already-signed permit books: untouched until next regeneration; then
  new unsigned version + auto-resubmit (prior state `approved`).
- `submit_for_approval`'s `SIGNATURE_ALREADY_PRESENT` guard no longer trips
  because permits stop embedding.

## Testing

- Backend: create switch-off → unsigned book, state `none`; switch-on → pending
  approver step = manager's user; regen of pending/approved → resubmitted; regen
  of never-sent → stays draft; manual endpoint happy + APPROVER_REQUIRED paths;
  auto-send swallow leaves permit mutation committed.
- Frontend: switch default off + payload wiring; badge rendering per state; send
  button visibility (draft vs pending vs revoked) + action; Arabic i18n asserts.

## Rejected

- Permit-specific approval state machine — duplicates the book chain.
- Register-row approval column — YAGNI; detail badge suffices.
