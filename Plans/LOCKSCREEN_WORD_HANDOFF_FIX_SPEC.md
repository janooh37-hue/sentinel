# Unlock without losing the Word handoff

Status: implementation specification, not an implemented or runtime-verified fix.

## 1. Destination and scope

An operator can leave the app to write in Microsoft Word, return after the app's idle lock activates, type their password, and continue the same Word handoff without refreshing or opening Records as a recovery step.

This is a focused frontend bug fix. No decision-ticket map is needed. Implementation must use a feature worktree, not the live production checkout. This document alone does not authorize deployment.

### Terms

- **Privacy lock:** the in-app lock that re-verifies the signed-in user's password. It is not the Windows lock screen or a replacement login session.
- **Word handoff:** the existing waiting/saved/finished dialog tied to a Word editing session.
- **Word save:** Word uploads the working document; the app observes `edit_session.last_put_at`.
- **Finish:** the operator explicitly commits the saved working document through the existing Finish action. Unlocking must not perform this action automatically.

### Non-goals

- Changing or disabling idle locking, or treating Word activity as browser activity.
- Refresh recovery, browser-restart recovery, or a new durable draft/session store.
- Replacing Word/WebDAV, changing the Word protocol launch, or redesigning Records.
- Authentication endpoints, password policy, retry policy, database schema, generated API types, or notification formatting changes.
- A general overlay framework, a new UI dependency, or a lock-screen visual redesign.
- Preserving the handoff across deliberate navigation, sign-out, or authentication loss. Those are different lifecycle boundaries from privacy lock/unlock.

## 2. Evidence and diagnostic status

The reported failure is accepted: when the idle lock appears over the Word waiting dialog, the password field cannot be used; refreshing loses the visible handoff.

The following are source observations, not a browser reproduction:

| Location | Observed behavior | Consequence for this fix |
| --- | --- | --- |
| `frontend/src/App.tsx`, `Shell`, lines 153-157 and 518-526 | `useLockState` drives a conditionally mounted `LockOverlay`; the routes remain mounted. | Preserve this ownership. Lock must not replace the routed application tree. |
| `frontend/src/components/shell/LockOverlay.tsx`, lines 321-325 and 430-439 | The current lock is a plain `div` with dialog ARIA attributes; an effect attempts password focus. | ARIA naming and visual stacking do not implement modal focus ownership. |
| `frontend/src/components/shell/LockOverlay.css`, lines 1-9 | The lock uses fixed positioning and `z-index: 100`. | Raising this number alone cannot solve focus trapping. |
| `frontend/src/components/ui/dialog.tsx`, lines 23-26 and 59-95 | The shared Word dialog uses Radix Root/Portal/Content, portalled to the body. | A lock fix must cooperate with portalled content, not just the application root element. |
| Installed `@radix-ui/react-dialog` implementation | Modal content enables focus trapping, disables outside pointer events, and hides other content from assistive technology. | The lock needs to participate in this same modal system. |
| Installed `@radix-ui/react-focus-scope` implementation | Adding a focus scope pauses the prior scope; removing it resumes the prior scope. | This is the existing mechanism to reuse rather than hand-writing a second focus trap. |
| `frontend/src/pages/application/ApplicationPage.tsx`, lines 204, 435-450 and 890-895 | The pending Word session is component state and is passed to `WordHandoffDialog`. | Reloading loses the in-memory handoff owner. Prevent the need to reload rather than adding storage. |
| `frontend/src/pages/books/WordHandoffDialog.tsx`, lines 64-104 and 265-417 | Closing resets local handoff state. Polling runs every five seconds while open and unfinished; Finish is gated by `last_put_at`. | Do not call its close handler or change its `open`/session values on lock. Preserve explicit Finish. |
| `frontend/src/components/books/BookWordActions.tsx`, lines 107-165 | Records' reopen action also owns a `WordHandoffDialog` through local state. | Verify this entry point as well as new documents. |
| `frontend/src/lib/keyboardShortcuts.tsx`, lines 60-87 | A window keydown handler can dispatch Ctrl+K and open Ctrl+/ help even from inputs. | Lock controls must not leak app-shortcut events into the hidden workflow. |

**[INFERENCE] Primary mechanism:** the Word dialog still owns the Radix focus/pointer layer while the visually higher lock is outside that layer. This explains a field that looks available but cannot receive interaction. The browser scenario in section 7 must establish the precise mechanism before a patch is accepted.

Alternative mechanisms to distinguish in that scenario:

1. Outside-pointer blocking alone: pointer input fails while keyboard focus remains usable. The fix still must address both pointer and keyboard ownership.
2. A genuinely pending password verification request: the current field has `disabled={submitting}`. Inspect its disabled state and the verification request rather than removing that guard.
3. A browser-owned external-protocol prompt: existing handoff comments document this separate failure mode. Keep the explicit Open in Word anchor; do not introduce automatic `ms-word:` navigation.

No production interaction, browser reproduction, Word save, or application test was run for this planning deliverable. The diagnosis feedback loop is deliberately deferred to implementation; the mechanism above is not presented as confirmed.

## 3. Observable behavior specification

### Lock entry

1. The configured idle timer and manual lock action continue to activate the privacy lock.
2. The password input receives focus after the lock's modal content mounts. Clicking or tapping it permits typing, including when the Word handoff or its discard confirmation was already open.
3. The lock is the active modal for pointer interaction, keyboard traversal, and assistive technology. Tab and Shift+Tab remain within its controls.
4. Escape, outside interaction, and the Word dialog's close button cannot dismiss the lock or close the hidden handoff.
5. The routed page, Word session identity, handoff-local state, and pending requests remain intact.
6. If a create/reopen request returns a new Word session only after the lock is active, retain that returned session but defer its first dialog presentation until unlock. It must not mount a competing modal above the password field.

### Verification and errors

1. Enter and the Unlock control use the existing `api.verifyAuthPassword(password)` call.
2. Password verification success is the only normal unlock transition. No client-side password comparison or unconditional close callback is allowed.
3. While verification is pending, preserve the existing submission guard. Do not introduce automatic retries, new timeouts, or a second verification request from a double-submit.
4. A rejected password or settled network/server error leaves the lock up, displays the error through the existing `apiErrorMessage` path, and restores the ability to edit and retry the password. This does not claim every existing error is localized: non-`ApiError` failures currently fall back to `String(err)`. General error-copy localization is outside this interaction fix.
5. Password visibility toggling remains available as today. Passwords stay in transient React state; never put them in storage, logs, screenshots, or telemetry.
6. Sign-out remains an explicit exit through the existing authentication lifecycle, not an alternate successful unlock or a promise to preserve the handoff after logout.

### Successful unlock

1. Remove only the lock modal. Do not reload, navigate, remount the route, clear React Query, or clear `pendingWordSession`/`reopenSession`.
2. Return to the same handoff and record reference. If a nested handoff confirmation was open, return to that same nested state.
3. Restore focus to the previous usable control in the surviving workflow. If it no longer exists, focus the surviving modal's content; use `#main-content` only when no underlying modal remains.
4. Let the existing `unlock()` refresh the idle deadline and clear the persisted lock flag. The app must not immediately re-lock from the previous idle interval.

### Word activity while locked

1. A Word save may arrive while the browser is locked. The privacy lock must neither discard it nor restart the editing session.
2. Keep the handoff mounted and keep its existing React Query polling enabled. Browser background throttling may delay a poll; do not promise five-second wall-clock delivery while the browser is suspended.
3. After unlock, the handoff shows the latest save once the existing query completes or refetches, and Finish becomes available under the existing save gate.
4. If no save has arrived, the same waiting state remains and Finish is still disabled.
5. A Finish request explicitly started before locking may complete while locked. Its normal result is retained, the lock remains in control, and unlocking reveals the existing finished-document view. Unlock must not issue another Finish request.
6. Lock-screen password entry must never trigger the hidden handoff's Finish, Discard, Close, or template actions.

## 4. Proposed implementation

### A. Make the lock a real Radix modal

Modify `frontend/src/components/shell/LockOverlay.tsx` to use the already-installed `@radix-ui/react-dialog` primitives: controlled modal Root, Portal, Overlay, Content, and an accessible Title.

Keep the exported interface unchanged:

```ts
interface LockOverlayProps {
  onUnlocked: () => void
  onSignOut: () => void
}
```

The shell's existing conditional mount is the source of open/closed state. While mounted, the Root stays open. Do not wire `onOpenChange(false)` to `onUnlocked`; an attempted modal dismissal is not password verification.

- Use raw Radix primitives for this full-screen surface. The shared `DialogContent` intentionally adds a centered card, size constraints, zoom animation, backdrop, and close button; do not add a generic full-screen variant just for this fix.
- Keep `.lock-overlay`, `data-layout`, explicit direction, and the existing lock visuals on the actual modal content element.
- Keep Portal at body level, outside content that an existing modal may have hidden.
- Use the same existing modal layer system to acquire pointer/focus ownership. Do not set `document.body.style.pointerEvents` manually.
- Prevent default on `onEscapeKeyDown` and outside-interaction dismissal hooks. Do not render a close affordance.
- Provide a localized Radix Title using `lockScreen.title`. Connect the existing idle explanation as the description if suitable; otherwise explicitly omit the description relation rather than referencing a missing element.
- Keep the lock above the current Word overlay/content visually; style any additional Radix overlay without doubling the existing dark scrim or backdrop effects.

### B. Mount focus and layout effects at the correct time

Moving into a Portal can delay the presence of DOM refs. Existing empty-dependency effects read `overlayRef` and `unlockRef`; blindly wrapping their current render could leave those effects running before their elements exist.

Use a small module-private content component mounted inside the Portal to own the existing refs and effects. This is a lifecycle split within `LockOverlay.tsx`, not a new exported abstraction.

- Set initial password focus in Radix `onOpenAutoFocus`, after modal focus ownership has been acquired; prevent the default selection of another control.
- Remove the old independent mount-time password-focus call. Retain the clock interval with normal cleanup.
- Preserve the unlock-height ResizeObserver and Visual Viewport listeners, including cleanup. They must bind to the rendered modal DOM, not stale or initially null refs.
- Capture the pre-lock focused element before autofocus. Implement `onCloseAutoFocus` explicitly because the lock has no Radix Trigger. Follow the explicit return-focus pattern already used by `ConfirmDialog`.
- Restore focus only for a successful unlock into a surviving authenticated workflow. Do not try to focus detached private content during auth teardown.
- If unlocking also presents a deferred new handoff, its autofocus takes priority over the old page focus target. A delayed lock `onCloseAutoFocus` must not steal focus back from that newly active modal.
- Never poll `.focus()` in an interval or install a competing document-wide focus trap.

### C. Contain lock keyboard events

Consume bubbling keydown events at the lock content so the window-level app shortcuts do not receive typing or modifier combinations from lock controls. Do not blanket `preventDefault()` ordinary keys: native typing, Tab traversal, password-manager interaction, and Enter submission must still work.

Specifically verify Ctrl+K, Ctrl+/, and Ctrl+N from the lock input and non-input controls. Radix Escape handling is separately prevented through its documented hook, including capture-phase dismissal behavior. Browser/OS shortcuts are not a new interception feature.

Do not rewrite the shared shortcut registry unless the composed browser case proves local containment insufficient.

### D. Preserve existing handoffs and defer only new presentations

Keep Word session ownership in `ApplicationPage.pendingWordSession` and `WordReopenButton.reopenSession`. Do not clear either on lock, pause their requests, or add presentation logic separately to those callers.

Add one read-only boolean context in `frontend/src/lib/appLockContext.ts`, following the existing separate-context convention. `Shell` in `App.tsx` provides the `locked` value from its single existing `useLockState` call around the authenticated subtree. This is not another lock store: no duplicated timers, event bus, storage listener, or independently writable lock flag. The context's standalone default is unlocked; the production shell always provides it.

`WordHandoffDialog.tsx` consumes that context and owns a small per-session presentation history:

| Session/dialog condition | Presentation rule |
| --- | --- |
| No session, or caller has closed it | No modal; clear presentation history. |
| Session present, app unlocked | Present normally. |
| Same session's handoff was already presented before locking | Leave the same modal subtree open and mounted throughout the lock. |
| New/unpresented session arrives while locked | Retain the session and queries but do not mount its modal subtree yet. |
| Unlock with a deferred session | Present that same returned session once, without another create/reopen request. |

Record the presented session token only when the actual modal content mounts (using its mount/autofocus lifecycle), not merely when the outer component renders or the request resolves. Reset that historical marker on caller close or a different session token, using the component's existing per-token reset convention. This prevents a scheduled but not yet mounted Portal from being mistaken for an already-open dialog.

The rendering rule is `open && session != null && (!locked || presentedSessionToken === session.token)`. This gates only first presentation of a new session, not the `open` argument used by polling. Keep hooks and polling outside the deferred modal-subtree return. Do not write the session token to new persistent storage.

Apply the rule to the whole handoff modal subtree, including its existing nested dialogs. For an already-presented session, preserve the same React positions/keys across waiting, saved, and finished views so lock-related rerenders do not re-register a new background focus layer. An already-open nested confirmation stays mounted and is resumed after unlock.

Expected unchanged behavior/files:

- `frontend/src/lib/useLockState.ts`: timer, storage, and successful-unlock semantics.
- `frontend/src/pages/application/ApplicationPage.tsx`: `pendingWordSession` ownership and mutation behavior.
- `frontend/src/components/books/BookWordActions.tsx`: `reopenSession` ownership and mutation behavior.
- `WordHandoffDialog` query cadence, save/Finish gates, Finish/Discard actions, and explicit Word launch.
- Shared dialog primitives, backend routes, database, and generated contracts.

This is a targeted presentation guard in the shared Word handoff, not a generic modal-priority framework. Both Word entry points benefit without duplicating lock rules in their owners.

### E. Keep styling changes narrow

Modify `LockOverlay.css` only as needed for the modal/overlay placement and any real visual regression from the new mount structure. Preserve band, stack, and console layouts; desktop centering; mobile keyboard inset; reduced-motion behavior; and existing theme tokens.

A CSS-only z-index or pointer-events patch is not an acceptable replacement for correct modality.

## 5. State transitions and invariants

| Before | Event | Required result |
| --- | --- | --- |
| Handoff waiting, unlocked | Idle deadline or manual lock | Same session and waiting state underneath; lock owns interaction. |
| Handoff waiting, locked | Word save arrives | Same session now has a save; lock remains active. |
| Word session request pending, locked | Create/reopen response returns | Retain returned session; defer its first modal presentation; password keeps focus. |
| New handoff deferred, locked | Successful password verification | Open the retained session once and focus it; do not create/reopen again. |
| Any retained handoff state, locked | Invalid password or settled verification error | Remain locked; editable retry; no handoff mutation. |
| Any retained handoff state, locked | Successful password verification | Return to that workflow's current state with focus restored. |
| Handoff ready, unlocked | Operator chooses Finish | Existing finish flow; no new lock-related behavior. |
| Finish already pending, locked | Finish succeeds | Preserve finished result underneath the still-active lock. |
| Any locked state | Escape, outside interaction, app shortcut | No dismissal, navigation, hidden action, or competing help dialog. |

The privacy lock and the Word session are independent lifecycles. A lock/unlock cycle must not allocate another record reference, create another Word session, call Discard, or manufacture a saved/finished state.

## 6. Changed-file plan

| File | Planned work |
| --- | --- |
| `frontend/src/components/shell/LockOverlay.tsx` | Modal integration, mounted-content lifecycle, autofocus/return-focus, dismissal prevention, keyboard containment. |
| `frontend/src/components/shell/LockOverlay.css` | Only placement/overlay adjustments proven necessary by visual checks. |
| `frontend/src/lib/appLockContext.ts` (new) | Read-only boolean context for the shell's existing lock state; no new state store. |
| `frontend/src/App.tsx` | Provide that context from `Shell` without changing route ownership, keys, or timer behavior. |
| `frontend/src/pages/books/WordHandoffDialog.tsx` | Defer first presentation of a new session while locked; preserve already-open modal subtrees and existing polling/business behavior. |
| `frontend/src/pages/books/WordHandoffDialog.test.tsx` | Cover deferred first presentation, release on unlock, token replacement, and retention of an already-open handoff. |
| `frontend/src/components/shell/LockOverlay.test.tsx` | Behavior-level regression coverage with a real open Radix dialog beneath the real lock; error/retry and dismissal tests. |
| `frontend/e2e/lock-word-handoff.spec.ts` (new) | Actual composed workflow in Chromium with synthetic networking, real portals/CSS, idle transition, unlock, and retained save/Finish behavior. |
| `frontend/e2e/lock-word-handoff.config.ts` (new, narrow test configuration) | Isolated local frontend port/base URL and no accidental reuse of the production-connected default server. Extend existing Playwright conventions. |
| `DESIGN.md`, section 3.7 | After implementation passes, document the modal/focus ownership and state-preserving unlock contract. |

No translation changes are expected: reuse existing Arabic/English keys. If a new user-facing string is unavoidable, update both locale files together and include them in the RTL review.

## 7. Verification plan

### First gate: capture the exact composed failure

Use the real application and actual `WordHandoffDialog` + `LockOverlay` in Chromium. Synthetic API data is allowed; mocking the modal primitives, input events, lock component, or Word handoff component is not.

1. Enter `/application` with a synthetic signed-in operator and create a Word handoff through the real UI.
2. Leave the handoff open with `last_put_at: null`. Choose the existing short timeout in fixture account data.
3. Advance browser time past the idle deadline after all opening interactions, rather than waiting on a real clock or editing the production user's timer.
4. Observe the lock. Use an actual click followed by keyboard typing into the password field, not JavaScript assignment of the value or forced clicks.
5. Capture which element owns focus, whether the input is disabled, computed pointer-event blocking, modal ancestry/ARIA hiding, and whether verification has been requested. Do not record the password or a session token.
6. The regression must fail on the reported interaction contract before the fix, and pass after it. If this fixture fails to reach the user's failure path, improve the fixture rather than weakening its assertion or accepting a CSS guess.

### Browser acceptance matrix

| Scenario | Pass signal |
| --- | --- |
| Main reported path | Password accepts real pointer/keyboard input above an already-open Word handoff; valid verification unlocks without refresh. |
| Save after unlock | Original handoff becomes ready after a later save; Finish completes normally. |
| Save while locked | Updated `last_put_at` is reflected after unlock; same record reference; no replacement session. |
| No save yet | Unlock restores waiting state; Finish remains unavailable. |
| Incorrect password, then correct | First attempt stays locked and retry is editable; second returns to the same handoff. |
| Settled network/server error | Error remains on lock and retry works; no hidden close or navigation. |
| Nested discard confirmation | Lock takes focus over both dialogs; Escape cannot discard/close them; unlock restores the same confirmation. |
| Finish completes while locked | Lock keeps focus; unlock reveals finished-document state; no duplicate Finish. |
| Create/reopen response arrives after locking | Password keeps focus; session is retained without presenting its dialog; unlock presents it once with correct focus and no second create/reopen request. |
| Keyboard isolation | Tab/Shift+Tab stay in lock; `Ctrl+K`, `Ctrl+/`, and `Ctrl+N` cannot act on the underlying app; Enter submits only verification. |
| Repeated cycles | A second lock/unlock works; no stuck focus, pointer blocking, or immediate re-lock from old activity. |
| Records reopen and ordinary dialog | Same lock ownership for the alternate handoff entry point and a non-Word Radix dialog. |
| No background dialog | Ordinary lock/unlock still works and restores focus to the page. |
| English/Arabic; desktop/narrow viewport | Same functional result in both directions, reachable password/submit controls, no new overflow; all three lock layouts retain their presentation. |

For no-refresh proof, combine the existing browser heap-marker technique in `refresh.spec.ts` with assertions that the same handoff remains, the reference is unchanged, and the existing Finish action remains usable. A surviving marker alone is insufficient.

Check pointer blocking through actual attempted background interaction, and keyboard ownership through focus assertions. Merely asserting `aria-modal`, a high z-index, or the input's `value` after programmatic assignment is insufficient.

### Edge-ordering release check

Radix focus ownership is mount-ordered, not a permanent priority level. Check a Word-session creation response arriving after the app has locked, plus any relevant already-running request that could mount a new modal while locked. A newly mounted background modal must not steal the password focus or hide the lock from assistive technology.

Section 4D's shared-context and per-session presentation guard is part of the planned patch, not an unspecified fallback. Verify both orderings: handoff first then lock, and lock first then session response. Include the Portal-mount boundary, session-token replacement, and unlock autofocus ordering. A failure blocks acceptance and must be fixed at this specified presentation guard or lock modal, not by raising z-index, repeatedly calling focus, or broadening to a generic overlay manager.

### Automated checks after implementation

Run from the implementation worktree, sequentially on this host:

```powershell
pnpm -C frontend test src/components/shell/LockOverlay.test.tsx src/lib/useLockState.test.ts src/pages/books/WordHandoffDialog.test.tsx src/components/books/BookWordActions.test.tsx
pnpm -C frontend exec playwright test --config=e2e/lock-word-handoff.config.ts
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
```

The browser spec/config above are planned additions; those commands are not claims that these files already exist or that checks passed. Keep new permanent tests only for plausible interaction, lifecycle, and authentication failures. Do not repin incidental wording or implementation-shaped assertions encountered in touched tests.

### Safe runtime setup and manual smoke

- The existing Vite proxy defaults to `127.0.0.1:8765`; the existing Playwright webServer defaults to port 5173 with server reuse. Do not run this workflow against those defaults blindly.
- The targeted browser configuration must launch the worktree frontend on a verified-free loopback port, set matching baseURL/webServer URLs, and disable reuse of unrelated servers. The automated browser regression needs no live backend: set `GSSG_API_TARGET=http://lock-handoff-test.invalid`, intercept required API traffic with Playwright fixtures, and set `serviceWorkers: 'block'`. The reserved `.invalid` target is a fail-closed backstop, never a production endpoint.
- In that dedicated configuration, resolve `testDir` explicitly to `frontend/e2e` and select only `lock-word-handoff.spec.ts` with `testMatch`. A config stored inside `e2e/` must not accidentally inherit a relative `./e2e` path as `e2e/e2e`, or discover the whole unrelated suite.
- Fulfill required `/api` requests from synthetic fixtures and abort/fail the test on any unhandled API request rather than continuing it to the proxy. Stub unrelated weather requests. Neither production credentials nor the existing preview accounts are prerequisites for this synthetic test.
- After browser regressions pass, perform the real Word smoke using the disposable-backend procedure below. Open Word explicitly, let the app lock, save in Word, return, unlock, and Finish from the retained handoff. Verify an already-existing session, not merely a standalone lock demo.
- Visually verify English/LTR and Arabic/RTL, desktop and narrow viewport. The narrow test checks unlock behavior and keyboard positioning, not a new ability to launch desktop Word from mobile.
- Run the required i18n/RTL review for the changed interaction/layout. Report browser-only coverage separately if the packaged shell or Word integration cannot be exercised; do not claim full end-to-end verification without that smoke.

### Disposable backend for the real Word smoke

This is a throwaway verification setup, not an additional production feature or a presumed existing seed script.

1. Use the implementation worktree with no copied `.env` or production `data/`. Allocate a new empty temporary data directory and verified-free loopback backend/frontend ports.
2. Start a child process with inherited `GSSG_*` settings cleared, then explicitly set `GSSG_DATA_DIR` to that temporary directory, `GSSG_HOST=127.0.0.1`, `GSSG_PORT` to the chosen backend port, `GSSG_DISABLE_SCHEDULER=1`, `GSSG_SMS_ENABLED=false`, and `GSSG_OPENWA_ENABLED=false`. Do not inherit gateway, BioTime, mail, or production URL credentials. Keep authentication enabled.
3. Before migrations or app imports that construct an engine, verify `get_settings().db_path` resolves under the new temporary directory and is not the live database. `backend/app/config.py` derives the SQLite file from `GSSG_DATA_DIR`; `backend/app/db/migrations/env.py` supports an explicit `-x url=...` override. Using the existing project venv Python, run `-m alembic -x url=<absolute-temporary-sqlite-url> upgrade head` from the worktree root. This initializes only the disposable database; no new migration is being authored.
4. Launch the worktree's `backend/serve.py` with the same environment through the supervised process tool, using the existing project venv Python. It respects `GSSG_HOST`/`GSSG_PORT` and disables access logging for token-bearing DAV URLs. Confirm the selected port and temporary database before sending any setup request. The scheduler disable switch is implemented in `scheduler_service._disabled_in_environment`.
5. Bootstrap a synthetic first user through `POST /api/v1/auth/register`, then use the normal login flow. `auth_service.register` makes the first account active/admin and hashes its password. Generate a disposable password without logging it; do not reuse production or presumed seeded preview credentials. Use only synthetic record content and disable optional employee notifications in the smoke workflow.
6. Point the separate worktree frontend's `GSSG_API_TARGET` at this backend. Set the backend's `GSSG_PUBLIC_BASE_URL` to the isolated origin Word will reach, and inspect the generated Word launch target before opening it. It must not retain the default `https://gssg.lan` or any production origin. Use cookie/TLS settings appropriate to that test origin without weakening production settings.
7. Word must accept the isolated WebDAV origin under the host's existing trust/security policy. If a trusted test origin or the interactive Word/shell capability is unavailable, record that exact smoke limitation; do not fall back to a production database, gateway, or Word session to obtain a passing result.
8. Stop only the supervised test processes and remove their temporary database, output, credentials, and launcher artifacts after the smoke. Leave production services and data untouched.

## 8. Delivery gates

1. The composed regression captures the original failure and passes after the patch.
2. Only successful password verification performs the normal unlock transition; dismissal cannot bypass it.
3. Password input is usable with the handoff open, and the same handoff survives unlock.
4. Save-before-unlock, no-save, error/retry, nested-dialog, and repeated-cycle cases pass.
5. Focus restoration, background inaccessibility, portal stacking, and relevant late-mount ordering are verified.
6. Both languages, supported layouts, and desktop/mobile unlock presentation are checked.
7. Existing relevant tests, lint, type-check, and production build pass in the isolated worktree; Word/shell smoke evidence or its exact limitation is recorded.
8. After verification, update the existing lock documentation and remove throwaway diagnostics/fixtures not retained as regression coverage.
9. Submit through the repository's normal review/PR process. Do not deploy as part of this planning request; production changes require their separate committed-and-pushed deployment workflow.
