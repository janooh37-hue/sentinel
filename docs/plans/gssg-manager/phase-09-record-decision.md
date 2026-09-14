# Phase 9 — Record decisions

Status: not started. Branch: `refactor/p9-record-decision`. Release dependency: Phase 8.

Follow [WORKFLOW.md](WORKFLOW.md). Tests and current-code review precede every implementation slice; complete verification before each frontend build.

## Outcome and boundaries

Share approval availability and reason-entry state across Record page and detail drawer; use a single mobile dock/sheet. Compose the existing `useBookApprovalActions` hook, which already owns mutations and invalidation. Keep page signing in place, drawer signing closing the drawer, and return/reject aftermath appropriate to each caller.

Agreed boundaries: `useRecordDecision`, `RecordDecisionActions`, `DecisionReasonForm`, page and drawer integration tests. Prefer user-observable UI behavior over component-instance details. Test the final mounted page to detect duplicate mobile surfaces.

## Verify current code first

- [ ] Read `useBookApprovalActions.ts`, its tests, `BookRecordPage.tsx`, `RecordDecisionActions` and `BookDetailDrawer.tsx`.
- [ ] Trace callbacks, React Query invalidation, queue navigation, sign/return/reject availability and pending behavior.
- [ ] Locate both mobile render sites, IntersectionObserver visibility and inert handling. Identify any unrelated consumers before deleting shared code.
- [ ] Inspect reason validation rules, record-ID changes, mutation errors, focus restoration, safe-area spacing and current EN/AR labels.
- [ ] Run existing approval hook, page, drawer and action tests before adding the new hook.

## Test-first slices

| Slice | Tests before code | Verified implementation task |
| --- | --- | --- |
| 9.1 Reason lifecycle | `useRecordDecision.test.tsx`: begin return/reject clears old reason; whitespace invalid; cancel clears state; confirm sends trimmed reason; pending prevents duplicate action; record change resets state | Compose existing approval hook and add reason/availability state; do not recreate mutations |
| 9.2 Caller aftermath | Existing page/drawer integration: page sign keeps page; drawer sign closes; return/reject updates queue; failure preserves useful error/retry behavior | Pass existing onSigned/onDecided semantics through shared state |
| 9.3 Action presentation | `RecordDecisionActions.test.tsx`: real EN/AR labels, availability, disabled/busy states; reason form accessible label and validation | Move shared components into books components; preserve header and dock styling variants |
| 9.4 One mobile surface | `BookRecordPage.decision.test.tsx`: mobile page has exactly one accessible Return action and one reason input after opening; desktop header/inline form works | Remove in-document mobile duplicate and retain portal dock with one reason sheet |
| 9.5 Focus and navigation | Keyboard opening, Escape/cancel, focus return, no focus behind modal, record switch while form open, pending/error state, scroll and safe area in both directions | Remove observer/inert workaround only after their duplicate-surface purpose is gone; preserve modal focus management |

## Detailed tasks

- [ ] Define hook state (`canDecide`, `busy`, pending act, reason, validity) and actions (`sign`, `begin`, `cancel`, `setReason`, `confirm`) around the existing hook contract.
- [ ] Preserve validation exactly unless a new behavior is explicitly agreed. Guard undefined book ID and unavailable actions; ensure an old reason cannot apply to another Record.
- [ ] Move `DecisionReasonForm` and action presentation with their translations and accessible labels. Use logical CSS properties and existing PRODUCT/DESIGN tokens.
- [ ] Delete only the mobile duplicate and its now-unused observer/scroll/inert code; keep unrelated layout and scroll handling.
- [ ] Keep `useBookApprovalActions.test.tsx` and existing queue navigation coverage. Replace translation-key-only assertions with user-visible labels for bilingual UI tests.
- [ ] Retain one reason form per active surface, with clear focus target and restoration on close. Account for on-screen keyboard and bottom safe-area inset.

## Verification before build and release

- [ ] Run `pnpm -C frontend test -- useRecordDecision RecordDecisionActions BookRecordPage useBookApprovalActions BookDetailDrawer`, then full frontend tests, lint and TypeScript checks sequentially.
- [ ] Run `i18n-rtl-reviewer`, resolve material findings, then build and run applicable E2E checks under WORKFLOW.
- [ ] Browser check at 375px and 1280px in EN/AR: exactly one mobile decision surface, correct dock placement, Return/Reject reason, sign aftermath, loading/error, Escape and focus return.
- [ ] Check drawer and full page separately; verify queue changes after return/reject and page remains after sign.
- [ ] No backend/schema changes are expected. If discovered, include contract generation and relevant backend checks rather than assuming frontend-only scope.
- [ ] Rollback: revert UI code; completed decisions remain server state and must not be replayed. Verify old/new clients both reflect current approval state.

## Execution evidence

Pending: code findings, baseline/RED/GREEN commands, page/drawer behavior evidence, screenshots at both widths/languages, keyboard review, build/E2E and release evidence.
