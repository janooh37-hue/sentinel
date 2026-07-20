# Per-book "Notify employee" switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an On-by-default "Notify employee" switch to the form-generation preview so an operator can suppress the employee notification for one book before saving it.

**Architecture:** No new notification code. A `notify_employee: bool = True` field on the generate request feeds the *existing* autosend gate in `documents.py`; the frontend adds a switch to the preview's Save-Book area, shown only for the 8 notifying forms and only when global autosend is on. Default `True` keeps today's behaviour byte-for-byte.

**Tech Stack:** FastAPI + Pydantic (backend), React 19 + React Query + Tailwind 4 + i18next (frontend), pytest + vitest, `openapi-typescript` for the generated contract.

**Spec:** `docs/superpowers/specs/2026-07-20-preview-sms-toggle-design.md`
**Mockup:** `docs/preview-sms-toggle-mockup.html`

## Global Constraints

- **Branch/worktree:** all work in `.claude/worktrees/preview-sms-toggle` on branch `feature/preview-sms-toggle`. Do NOT commit to `main`; do NOT push (this checkout is live prod — pushing to `origin/main` deploys).
- **Backend gates are strict:** `mypy` is `strict`; `pytest` runs with `filterwarnings=error`; `ruff check` + `ruff format --check` must pass.
- **Generated contract:** after any backend schema change, resync `backend/openapi.json` + `frontend/src/lib/api.types.ts` and commit them together, or the frontend drifts silently.
- **Bilingual + RTL:** every new UI string needs an `en.json` AND `ar.json` entry (key parity), logical CSS (`ms-`/`me-`, `rtl:` variants) not left/right. Run the `i18n-rtl-reviewer` after touching locales.
- **Commands / worktree deps:** commands below assume the repo venv and `frontend/node_modules`. In the worktree, invoke the root venv by absolute path — `C:/Users/Admin/sentinel/venv/Scripts/python.exe` — run from the worktree dir so it imports the worktree's code; if `frontend/node_modules` is absent in the worktree, run `pnpm -C frontend install` once (fast — pnpm global store) before the frontend tasks.
- **The 8 notifying templates** (verbatim, = keys of `TEMPLATE_EVENTS` in `backend/app/services/notify_format.py`): `Salary Transfer Request`, `Salary Deduction Form`, `Employee Clearance Form`, `HR Request Form`, `Passport Release Form`, `Warning Form`, `Resignation Letter`, `Leave Permit Form`.

---

### Task 1: Backend — thread `notify_employee` through the autosend gate

**Files:**
- Modify: `backend/app/api/v1/documents.py` (`_should_autosend` ~L66-68; `DocumentGenerateRequest` ~L105-136; call site ~L213)
- Test: `backend/tests/test_documents_autosend_gate.py` (create)

**Interfaces:**
- Produces: `_should_autosend(*, commit: bool, revise_of_book_id: int | None, book_id: int | None, notify_employee: bool) -> bool` and request field `DocumentGenerateRequest.notify_employee: bool = True`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_documents_autosend_gate.py`:

```python
"""The per-book notify switch (notify_employee) gates the autosend decision,
alongside the existing commit / new-book / non-revision conditions."""

from app.api.v1.documents import _should_autosend


def test_autosend_true_for_committed_new_book_with_notify_on():
    assert (
        _should_autosend(
            commit=True, revise_of_book_id=None, book_id=42, notify_employee=True
        )
        is True
    )


def test_autosend_false_when_notify_employee_off():
    assert (
        _should_autosend(
            commit=True, revise_of_book_id=None, book_id=42, notify_employee=False
        )
        is False
    )


def test_autosend_false_for_preview_even_with_notify_on():
    assert (
        _should_autosend(
            commit=False, revise_of_book_id=None, book_id=42, notify_employee=True
        )
        is False
    )


def test_autosend_false_for_revision():
    assert (
        _should_autosend(
            commit=True, revise_of_book_id=7, book_id=42, notify_employee=True
        )
        is False
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_documents_autosend_gate.py -v`
Expected: FAIL — `TypeError: _should_autosend() got an unexpected keyword argument 'notify_employee'`.

- [ ] **Step 3: Add the request field**

In `backend/app/api/v1/documents.py`, inside `DocumentGenerateRequest` (after the `classification_code` field, ~L136), add:

```python
    # Per-book notify opt-out (2026-07-20). The generation preview shows an
    # On-by-default switch for the 8 forms that notify the employee on save;
    # sending False suppresses the notification for THIS book only. Default
    # True keeps every existing caller's behaviour unchanged. ANDed with the
    # global `sms_autosend_enabled` setting inside notify_dispatch.
    notify_employee: bool = True
```

- [ ] **Step 4: Extend `_should_autosend`**

Replace `_should_autosend` (~L66-68) with:

```python
def _should_autosend(
    *,
    commit: bool,
    revise_of_book_id: int | None,
    book_id: int | None,
    notify_employee: bool,
) -> bool:
    """Autosend only for a committed, non-revision generation that produced a
    book, and only when the operator left the per-book notify switch on."""
    return (
        bool(commit)
        and revise_of_book_id is None
        and book_id is not None
        and notify_employee
    )
```

- [ ] **Step 5: Update the call site**

At the dispatch (~L213), add the new keyword argument:

```python
        if _should_autosend(
            commit=request.commit,
            revise_of_book_id=request.revise_of_book_id,
            book_id=result.book_id,
            notify_employee=request.notify_employee,
        ):
```

- [ ] **Step 6: Run test to verify it passes**

Run: `C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_documents_autosend_gate.py -v`
Expected: PASS (4 passed).

- [ ] **Step 7: Lint + typecheck**

Run: `C:/Users/Admin/sentinel/venv/Scripts/ruff.exe check backend/app/api/v1/documents.py backend/tests/test_documents_autosend_gate.py && C:/Users/Admin/sentinel/venv/Scripts/mypy.exe`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/v1/documents.py backend/tests/test_documents_autosend_gate.py
git commit -m "feat(documents): per-book notify_employee gate on autosend"
```

---

### Task 2: Resync the generated API contract

**Files:**
- Modify (generated): `backend/openapi.json`, `frontend/src/lib/api.types.ts`

**Interfaces:**
- Produces: `components['schemas']['DocumentGenerateRequest'].notify_employee?: boolean` in `api.types.ts` (consumed by the frontend's `DocumentGenerateRequest` type in Task 4).

- [ ] **Step 1: Dump the OpenAPI schema**

Run: `C:/Users/Admin/sentinel/venv/Scripts/python.exe -X utf8 scripts/dump_openapi.py`
Expected: `backend/openapi.json` rewritten (no error).

- [ ] **Step 2: Regenerate the TS types**

Run: `pnpm -C frontend run gen:api`
Expected: `frontend/src/lib/api.types.ts` rewritten.

- [ ] **Step 3: Verify the field landed**

Run: `grep -n "notify_employee" frontend/src/lib/api.types.ts`
Expected: a line inside the `DocumentGenerateRequest` schema, e.g. `notify_employee?: boolean;`.

- [ ] **Step 4: Typecheck the frontend still compiles**

Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit (both files together)**

```bash
git add backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "chore(api): resync types for notify_employee"
```

---

### Task 3: Frontend — notify-toggle visibility helper (pure, TDD)

**Files:**
- Create: `frontend/src/pages/application/notifyToggle.ts`
- Test: `frontend/src/pages/application/notifyToggle.test.ts`

**Interfaces:**
- Produces: `SMS_FORMS: ReadonlySet<string>` and `shouldShowNotifyToggle(templateId: string | null, autosendEnabled: boolean): boolean` (consumed by ApplicationPage in Task 4).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/application/notifyToggle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SMS_FORMS, shouldShowNotifyToggle } from './notifyToggle'

describe('notifyToggle', () => {
  it('covers exactly the 8 notifying forms', () => {
    expect(SMS_FORMS.size).toBe(8)
    expect(SMS_FORMS.has('Employee Clearance Form')).toBe(true)
    expect(SMS_FORMS.has('Leave Permit Form')).toBe(true)
  })

  it('shows for a notifying form when autosend is on', () => {
    expect(shouldShowNotifyToggle('Employee Clearance Form', true)).toBe(true)
  })

  it('hides for a non-notifying form', () => {
    expect(shouldShowNotifyToggle('General Book', true)).toBe(false)
  })

  it('hides when autosend is off app-wide', () => {
    expect(shouldShowNotifyToggle('Employee Clearance Form', false)).toBe(false)
  })

  it('hides when no template is selected', () => {
    expect(shouldShowNotifyToggle(null, true)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/application/notifyToggle.test.ts`
Expected: FAIL — cannot resolve `./notifyToggle`.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/pages/application/notifyToggle.ts`:

```ts
/**
 * The 8 document templates whose committed save notifies the employee.
 * Mirrors `TEMPLATE_EVENTS` in backend/app/services/notify_format.py — keep in
 * sync if that map changes.
 */
export const SMS_FORMS: ReadonlySet<string> = new Set([
  'Salary Transfer Request',
  'Salary Deduction Form',
  'Employee Clearance Form',
  'HR Request Form',
  'Passport Release Form',
  'Warning Form',
  'Resignation Letter',
  'Leave Permit Form',
])

/**
 * Show the "Notify employee" switch only for a notifying form, and only when
 * notifications are enabled app-wide — otherwise the switch would do nothing,
 * so it is hidden rather than shown misleadingly "On".
 */
export function shouldShowNotifyToggle(
  templateId: string | null,
  autosendEnabled: boolean,
): boolean {
  return templateId !== null && autosendEnabled && SMS_FORMS.has(templateId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/pages/application/notifyToggle.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/application/notifyToggle.ts frontend/src/pages/application/notifyToggle.test.ts
git commit -m "feat(application): notify-toggle visibility helper"
```

---

### Task 4: Frontend — wire the switch into ApplicationPage + bilingual strings

**Files:**
- Modify: `frontend/src/pages/application/ApplicationPage.tsx` (imports; page state ~L162; a settings query near the other queries ~L229; `buildPayload` return ~L426-443; preview block ~L1001-1012)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (add a `notify` object under the existing `application` key, as a sibling of `actions`)

**Interfaces:**
- Consumes: `shouldShowNotifyToggle`, `SMS_FORMS` (Task 3); `notify_employee` on `DocumentGenerateRequest` (Task 2); `api.getSettings()` → `{ sms_autosend_enabled: boolean }`.

- [ ] **Step 1: Add the bilingual strings**

In `frontend/src/locales/en.json`, inside the `"application"` object, right after the `"savedHint"` line, add:

```json
    "notify": {
      "label": "Notify employee",
      "hintOn": "The employee will get a message when this form is saved.",
      "hintOff": "Saved without notifying the employee."
    },
```

In `frontend/src/locales/ar.json`, inside the same `"application"` object (mirror position), add:

```json
    "notify": {
      "label": "إشعار الموظف",
      "hintOn": "سيصل الموظف إشعار عند حفظ هذا النموذج.",
      "hintOff": "سيتم الحفظ دون إشعار الموظف."
    },
```

- [ ] **Step 2: Add imports**

In `ApplicationPage.tsx`, add near the top imports:

```tsx
import { cn } from '@/lib/utils'
import { shouldShowNotifyToggle } from './notifyToggle'
```

(If `cn` is already imported, skip that line.)

- [ ] **Step 3: Add state + settings query**

In the "Page state" block (~after L162, near the other `useState` calls), add:

```tsx
  // Per-book notify opt-out — On by default; resets per form. Only surfaced for
  // the 8 notifying forms when global autosend is on (see notifyToggle.ts).
  const [notifyEmployee, setNotifyEmployee] = useState(true)
```

Near the other `useQuery` calls (e.g. after `employeeQuery`, ~L229), add:

```tsx
  // Global notify setting — hides the per-book switch when notifications are
  // off app-wide. Same query key/fn as the shell (TopNav/NavDrawer) so it's cached.
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
    staleTime: 5 * 60 * 1000,
  })
```

- [ ] **Step 4: Include the field in the payload**

In `buildPayload`'s returned object (~L426-443), add a line (e.g. after `commit,`):

```tsx
      // Per-book notify opt-out — only meaningful on the committed save of a
      // notifying form; the backend ignores it otherwise.
      notify_employee: notifyEmployee,
```

- [ ] **Step 5: Render the switch in the preview block**

In the `activeTab === 'preview' && activeJobId` block, immediately after `<JobStatus key={activeJobId} jobId={activeJobId} onDone={handleJobDone} />` (~L1003) and before the `<div className="mt-6 ...">` save-bar (~L1012), insert:

```tsx
                  {shouldShowNotifyToggle(
                    selectedTemplate,
                    settingsQuery.data?.sms_autosend_enabled ?? false,
                  ) && (
                    <label className="mt-4 flex items-center gap-3 rounded-md border border-hairline bg-muted/20 px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-[0.85em] font-medium text-foreground">
                          {t('application.notify.label')}
                        </span>
                        <span className="mt-0.5 block text-[0.75em] text-muted-foreground">
                          {notifyEmployee
                            ? t('application.notify.hintOn')
                            : t('application.notify.hintOff')}
                        </span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={notifyEmployee}
                        aria-label={t('application.notify.label')}
                        onClick={() => setNotifyEmployee((v) => !v)}
                        className={cn(
                          'relative ms-auto inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors',
                          notifyEmployee ? 'bg-primary' : 'bg-muted',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
                            notifyEmployee
                              ? 'translate-x-5 rtl:-translate-x-5'
                              : 'translate-x-0',
                          )}
                        />
                      </button>
                    </label>
                  )}
```

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: no errors. (If lint flags the `notify_employee` snake_case key, it is an API-contract field — match the existing `revise_of_book_id`/`manager_id` keys already in the same object; no override needed.)

- [ ] **Step 7: Run the frontend suite**

Run: `pnpm -C frontend exec vitest run src/pages/application`
Expected: PASS (the Task 3 helper tests; ApplicationPage has no render test).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/application/ApplicationPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(application): On-by-default Notify employee switch on preview"
```

---

### Task 5: Full verification + bilingual review

**Files:** none (verification gate only)

- [ ] **Step 1: Full backend suite**

Run: `C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest`
Expected: all pass (existing autosend tests in `test_notify_dispatch.py` unaffected — default `notify_employee=True`).

- [ ] **Step 2: Full frontend suite + typecheck + lint**

Run: `pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint && pnpm -C frontend test`
Expected: all pass.

- [ ] **Step 3: Bilingual / RTL review**

Dispatch the `i18n-rtl-reviewer` agent on the diff (locales + the switch JSX), and the `notification-template-reviewer` agent on the wording. Expected: en/ar key parity for `application.notify.*`, RTL-correct switch (the `rtl:-translate-x-5` mirrors the knob), no EN-in-AR leak. Fix any findings, re-run Step 2, re-commit.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Open `docs/preview-sms-toggle-mockup.html` to confirm the intended UX, then (post-merge, via `mng deploy`) verify on a real form: pick `Employee Clearance Form`, preview, confirm the switch shows On; toggle off; Save; confirm no `outbound_messages` row / no message was sent for that book; repeat with the switch left On to confirm a message goes out. Confirm the switch is absent on a non-notifying form (e.g. a General Book).

---

## Self-Review

**Spec coverage:**
- Switch On by default, per-book, not remembered → Task 4 state `useState(true)`, local only. ✅
- Only the 8 forms → `SMS_FORMS` (Task 3), used in Task 4. ✅
- Hidden when global autosend off → `shouldShowNotifyToggle` reads `sms_autosend_enabled` via `settingsQuery` (Tasks 3–4). ✅
- Backend `notify_employee: bool = True` + gate → Task 1. ✅
- Backward compatible (default True) → default in Task 1; existing tests unaffected (Task 5). ✅
- API types resync → Task 2. ✅
- Bilingual label "Notify employee" / "إشعار الموظف" + on/off hints → Task 4 strings. ✅
- Tests: backend gate matrix (Task 1), frontend visibility (Task 3). ✅
- Out of scope (leave-status path, direct send, audit, no-phone detection) → not touched. ✅

**Placeholder scan:** every code step contains complete code; commands have expected output; no TBD/TODO. ✅

**Type consistency:** `_should_autosend(..., notify_employee)` signature matches its call site (Task 1) and the field name `notify_employee` is identical across backend schema, generated type, payload, and helper. `shouldShowNotifyToggle` / `SMS_FORMS` names match between Task 3 and Task 4. ✅
