# Service Completion Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every document-producing service a durable post-save handoff with Print, Send for approval, and Open record, while giving every notifier-backed generated form a default-on per-save employee-notification switch.

**Architecture:** The backend publishes notifier capability and completed `book_id` in the generated API contract. The frontend adds one shared `SavedRecordActions` component, routes printing through the existing full-record PDF canvas, and integrates that component into generated forms, finished Word sessions, and Duty Locations transfers. Generated forms retain the existing `NotifyEmployeeToggle`, but backend metadata—not a frontend template list—controls visibility.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, SQLAlchemy/SQLite, pytest, React, TypeScript, React Query, React Router, react-i18next, Tailwind CSS, Vitest/Testing Library, pdf.js.

**Approved design:** `docs/superpowers/specs/2026-08-06-service-completion-actions-design.md`  
**Visual reference:** `docs/service-post-save-actions-review.html`

## Global Constraints

- Work in an isolated Git worktree; never modify or switch branches in the live production checkout.
- No new dependency and no database/Alembic migration.
- Backend is the only source of truth for whether a template automatically notifies.
- The switch label is **Notify employee / إشعار الموظف**; delivery stays WhatsApp-first with SMS fallback.
- The switch starts On for every new form and controls only that committed save.
- Never claim the notification was delivered; use **Notification enabled for this save** or **Saved without notifying the employee**.
- Revisions do not auto-notify and must not render the switch.
- General Book alone may render **Save as template**; Report must not render it.
- Print uses `/books/{bookId}?print=1` and the existing `.print-paper` record canvas; do not duplicate print CSS.
- The completion surface treats `pending` as status, not as a re-submit action; the full record screen retains its existing pending-request reroute behavior.
- English and Arabic ship together. Use logical CSS properties, visible focus rings, semantic controls, and reduced-motion-safe transitions.
- Do not contact a real WhatsApp or SMS gateway during tests or smoke checks.
- After Pydantic response changes, regenerate and commit both `backend/openapi.json` and `frontend/src/lib/api.types.ts`.
- After UI changes, run the project i18n/RTL and notification reviews.

## File and Interface Map

### Backend contract

- `backend/app/services/notify_format.py` — owns `SPECIAL_TEMPLATE_ROUTES` and `AUTO_NOTIFY_TEMPLATE_IDS`.
- `backend/app/services/notify_dispatch.py` — consumes `SPECIAL_TEMPLATE_ROUTES`; retains the current leave/duty/violation routing behavior.
- `backend/app/services/template_service.py` — exposes `TemplateMeta.notifies_employee`.
- `backend/app/services/job_registry.py` — stores nullable completed `book_id`.
- `backend/app/api/v1/documents.py` — returns `JobStatusResponse.book_id` and passes the generated ID to the registry.
- `backend/openapi.json`, `frontend/src/lib/api.types.ts` — generated contract artifacts.

### Frontend print path

- `frontend/src/pages/application/DocPdfCanvas.tsx` — adds optional `onReady(): void`.
- `frontend/src/pages/books/useRecordPrintMode.ts` — one-shot `?print=1` behavior.
- `frontend/src/pages/books/BookRecordPage.tsx` — connects PDF readiness to print mode.

### Shared and source-specific UI

- `frontend/src/components/books/SavedRecordActions.tsx` — shared saved status/reference, Print, draft-only approval, pending state, and Open record.
- `frontend/src/pages/application/notifyToggle.ts` — metadata/global/revision visibility predicate; no template IDs.
- `frontend/src/pages/application/savedGeneration.ts` — validates/extracts `{ bookId, docId, ref }` from a completed job.
- `frontend/src/pages/application/GeneratedSaveActions.tsx` — generated-form pre-save status, notifier switch, and Save to Records action.
- `frontend/src/pages/application/ApplicationPage.tsx` — owns pre/post transition and email-basket wiring.
- `frontend/src/pages/books/WordHandoffDialog.tsx` — renders shared actions after Finish and guards Save as template by latest version template ID.
- `frontend/src/pages/dutyLocations/TransferDialog.tsx` — returns the successful transfer result to its parent.
- `frontend/src/pages/dutyLocations/DutyLocationsPage.tsx` — persists the latest document-producing result and renders shared actions.
- `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` — all new shared/generated/duty completion copy.

---

### Task 1: Publish the Backend Completion Contract

**Files:**
- Modify: `backend/app/services/notify_format.py:16-63`
- Modify: `backend/app/services/notify_dispatch.py:338-362`
- Modify: `backend/app/services/template_service.py:27-38,98-109`
- Modify: `backend/app/services/job_registry.py:60-112`
- Modify: `backend/app/api/v1/documents.py:147-176,199-258,312-340`
- Modify: `backend/tests/test_templates_catalog.py`
- Modify: `backend/tests/test_documents_autosend.py`
- Modify: `backend/tests/test_job_registry_prune.py`
- Modify: `backend/tests/test_notify_dispatch.py` only if existing special-route assertions require the new constants
- Regenerate: `backend/openapi.json`
- Regenerate: `frontend/src/lib/api.types.ts`

**Interfaces:**
- Produces: `notify_format.SPECIAL_TEMPLATE_ROUTES: dict[str, str]`.
- Produces: `notify_format.AUTO_NOTIFY_TEMPLATE_IDS: frozenset[str]`.
- Produces: `TemplateMeta.notifies_employee: bool`.
- Produces: `job_registry.set_done(job_id: str, *, book_id: int | None, submission_id: str, documents: list[JobDocumentItem]) -> None`.
- Produces: generated `JobStatusResponse.book_id?: number | null` and `TemplateMeta.notifies_employee: boolean` for Tasks 4–7.

- [ ] **Step 1: Add failing notifier-metadata tests**

Add these contracts to `backend/tests/test_templates_catalog.py`:

```python
from app.services import notify_format, template_service


def test_every_auto_notifying_template_publishes_capability():
    by_id = {item.id: item for item in template_service.list_templates().items}
    assert notify_format.AUTO_NOTIFY_TEMPLATE_IDS
    for template_id in notify_format.AUTO_NOTIFY_TEMPLATE_IDS:
        assert by_id[template_id].notifies_employee is True


def test_non_notifying_word_templates_publish_false():
    assert template_service.get_template_fields("General Book").meta.notifies_employee is False
    assert template_service.get_template_fields("Report").meta.notifies_employee is False


def test_auto_notify_capability_is_union_of_mapped_and_special_routes():
    assert notify_format.AUTO_NOTIFY_TEMPLATE_IDS == frozenset(
        set(notify_format.TEMPLATE_EVENTS) | set(notify_format.SPECIAL_TEMPLATE_ROUTES)
    )
```

- [ ] **Step 2: Run the metadata tests and confirm RED**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_templates_catalog.py -q
```

Expected: failures because `AUTO_NOTIFY_TEMPLATE_IDS`, `SPECIAL_TEMPLATE_ROUTES`, and `TemplateMeta.notifies_employee` do not exist.

- [ ] **Step 3: Centralize special notifier routes and publish template capability**

In `notify_format.py`, add this map immediately after `TEMPLATE_EVENTS`:

```python
SPECIAL_TEMPLATE_ROUTES: dict[str, str] = {
    "Leave Application Form": "leave_status",
    "Administrative Leave Form": "leave_status",
    "Duty Resumption Form": "duty_resumption",
    "Violation Form": "violation",
}

AUTO_NOTIFY_TEMPLATE_IDS: frozenset[str] = frozenset(TEMPLATE_EVENTS) | frozenset(
    SPECIAL_TEMPLATE_ROUTES
)
```

In `notify_dispatch.auto_send_for_book()`, replace the four template-name comparisons with one lookup while preserving linked-record guards:

```python
route = nf.SPECIAL_TEMPLATE_ROUTES.get(tpl)
if doc is not None:
    if route == "leave_status" and doc.leave_id is not None:
        return _send_leave_status(db, doc.leave_id, sent_by=sent_by)
    if route == "duty_resumption" and doc.leave_id is not None:
        return send_for_event(db, nf.EVENT_DUTY_RESUMPTION, doc.leave_id, sent_by=sent_by)
    if route == "violation" and doc.violation_id is not None:
        return send_for_event(db, nf.EVENT_VIOLATION, doc.violation_id, sent_by=sent_by)
```

In `template_service.TemplateMeta`, add:

```python
notifies_employee: bool
```

Populate it in `_build_meta()`:

```python
notifies_employee=template_id in notify_format.AUTO_NOTIFY_TEMPLATE_IDS,
```

Import `notify_format` from `app.services`; do not copy the set into `template_service.py`.

- [ ] **Step 4: Add failing completed-book identity tests**

Update every existing `job_registry.set_done(...)` call in `backend/tests/test_job_registry_prune.py` to pass `book_id=None`. Add:

```python
def test_completed_job_keeps_book_id():
    jid = job_registry.submit_job()
    job_registry.set_done(jid, book_id=42, submission_id="sub", documents=[])
    job = job_registry.get_job(jid)
    assert job is not None
    assert job.book_id == 42
```

Extend `backend/tests/test_documents_autosend.py` with a worker-level
parametrized test. Add `from types import SimpleNamespace` and `import pytest`,
then add:

```python
@pytest.mark.parametrize(
    ("template_id", "notify_kwargs", "expected_dispatches"),
    [
        ("Salary Deduction Form", {"notify_employee": False}, []),
        ("Violation Form", {"notify_employee": False}, []),
        ("Salary Deduction Form", {}, [42]),
        ("Violation Form", {"notify_employee": True}, [42]),
    ],
)
def test_run_generation_notification_choice_and_book_id(
    monkeypatch,
    template_id,
    notify_kwargs,
    expected_dispatches,
):
    class FakeSession:
        def close(self) -> None:
            return None

    dispatched: list[int] = []
    monkeypatch.setattr(docs_api, "SessionLocal", FakeSession)
    monkeypatch.setattr(
        docs_api.document_service,
        "generate_document",
        lambda *args, **kwargs: SimpleNamespace(
            book_id=42,
            submission_id="sub",
            documents=[],
        ),
    )
    monkeypatch.setattr(
        docs_api.notify_dispatch,
        "auto_send_for_book",
        lambda db, book_id, *, sent_by: dispatched.append(book_id),
    )

    job_id = docs_api.submit_job()
    request = docs_api.DocumentGenerateRequest(
        template_id=template_id,
        commit=True,
        **notify_kwargs,
    )
    docs_api._run_generation(job_id, request)

    job = docs_api.get_job(job_id)
    assert job is not None
    assert job.status == "done"
    assert job.book_id == 42
    assert dispatched == expected_dispatches
```

The fake dispatcher is local and never reaches configured gateways.

- [ ] **Step 5: Run identity/autosend tests and confirm RED**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_documents_autosend.py backend/tests/test_job_registry_prune.py -q
```

Expected: failures because `_Job` and `set_done()` do not yet carry `book_id`.

- [ ] **Step 6: Thread `book_id` through registry and API response**

In `job_registry._Job`, add:

```python
book_id: int | None = None
```

Change `set_done()` to require `book_id` and assign it under the existing lock:

```python
def set_done(
    job_id: str,
    *,
    book_id: int | None,
    submission_id: str,
    documents: list[JobDocumentItem],
) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.status = "done"
            job.book_id = book_id
            job.submission_id = submission_id
            job.documents = documents
```

In `documents.JobStatusResponse`, add:

```python
book_id: int | None = None
```

Pass `book_id=result.book_id` to `set_done()` in `_run_generation()`, and `book_id=job.book_id` to `JobStatusResponse(...)` in `get_job_status()`.

Update the stale request comment from “8 forms” to “notifier-backed forms.”

- [ ] **Step 7: Run focused backend tests and confirm GREEN**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_templates_catalog.py backend/tests/test_documents_autosend.py backend/tests/test_job_registry_prune.py backend/tests/test_notify_dispatch.py -q
```

Expected: all selected tests pass; no outbound network calls occur.

- [ ] **Step 8: Regenerate the FastAPI/TypeScript contract**

Run the project `sync-api-types` workflow exactly:

```powershell
venv\Scripts\python.exe -X utf8 scripts\dump_openapi.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm run gen:api"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm exec tsc -b --noEmit"
```

Expected: OpenAPI generation succeeds; `TemplateMeta` includes required `notifies_employee`; `JobStatusResponse` includes nullable `book_id`; TypeScript typecheck passes before frontend consumers are changed.

- [ ] **Step 9: Commit the backend contract**

```powershell
git add backend/app/services/notify_format.py backend/app/services/notify_dispatch.py backend/app/services/template_service.py backend/app/services/job_registry.py backend/app/api/v1/documents.py backend/tests/test_templates_catalog.py backend/tests/test_documents_autosend.py backend/tests/test_job_registry_prune.py backend/tests/test_notify_dispatch.py backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "feat: publish service completion contract"
```

---

### Task 2: Add One-shot Record Print Mode

**Files:**
- Create: `frontend/src/pages/books/useRecordPrintMode.ts`
- Create: `frontend/src/pages/books/useRecordPrintMode.test.tsx`
- Create: `frontend/src/pages/application/DocPdfCanvas.ready.test.tsx`
- Modify: `frontend/src/pages/application/DocPdfCanvas.tsx:38-58,82-150`
- Modify: `frontend/src/pages/books/BookRecordPage.tsx:249-306,759-786`

**Interfaces:**
- Produces: `DocPdfCanvas` optional prop `onReady?: () => void`.
- Produces: `useRecordPrintMode(): () => void`, a callback safe to pass directly to `DocPdfCanvas.onReady`.
- Consumed by: `SavedRecordActions` print URL in Task 3.

- [ ] **Step 1: Write the failing one-shot route test**

Create `useRecordPrintMode.test.tsx` with a `MemoryRouter` harness containing a button that calls the hook callback and a `useLocation()` probe. Start at `/books/42?print=1`, click twice, and assert:

```tsx
expect(window.print).toHaveBeenCalledTimes(1)
expect(screen.getByTestId('search').textContent).toBe('')
```

Also start at `/books/42` and assert the callback never invokes `window.print()`.

- [ ] **Step 2: Run the hook test and confirm RED**

Run:

```powershell
pnpm -C frontend test -- useRecordPrintMode.test.tsx
```

Expected: module-not-found failure for `./useRecordPrintMode`.

- [ ] **Step 3: Implement `useRecordPrintMode`**

Create the hook with this behavior:

```ts
import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

export function useRecordPrintMode(): () => void {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('print') === '1'
  const printed = useRef(false)

  useEffect(() => {
    if (!requested) printed.current = false
  }, [requested])

  return useCallback(() => {
    if (!requested || printed.current) return
    printed.current = true
    window.print()
    const next = new URLSearchParams(searchParams)
    next.delete('print')
    setSearchParams(next, { replace: true })
  }, [requested, searchParams, setSearchParams])
}
```

- [ ] **Step 4: Write the failing PDF-readiness callback test**

Create `DocPdfCanvas.ready.test.tsx`. Mock `pdfjs-dist.getDocument()` with one page whose `render().promise` resolves, stub `fetch` to return base64 text, and stub `HTMLCanvasElement.prototype.getContext`. Render:

```tsx
<DocPdfCanvas pdfUrl="/document.pdf" onReady={onReady} />
```

Wait for the canvas, then assert `onReady` was called exactly once. Add an HTTP-error case and assert it was not called.

- [ ] **Step 5: Run the PDF test and confirm RED**

Run:

```powershell
pnpm -C frontend test -- DocPdfCanvas.ready.test.tsx
```

Expected: TypeScript/render failure because `onReady` is not a component prop.

- [ ] **Step 6: Add callback-safe PDF readiness**

Add `onReady?: () => void` to `DocPdfCanvas`. Preserve the latest callback without adding it to the expensive PDF-fetch effect dependency list:

```tsx
const onReadyRef = useRef(onReady)
useEffect(() => {
  onReadyRef.current = onReady
}, [onReady])
```

After every page has finished painting and immediately after `setStatus('ready')`/`measure()`, call:

```tsx
onReadyRef.current?.()
```

Never call it from loading, missing-PDF, render-error, or cleanup paths.

- [ ] **Step 7: Connect record-page PDF readiness to print mode**

In `BookRecordPage`, call:

```tsx
const onPdfReady = useRecordPrintMode()
```

Pass `onReady={onPdfReady}` to the canonical `DocPdfCanvas` inside `.print-paper`. Do not change the existing header Print button: it continues to call `window.print()` immediately for an already-rendered page.

- [ ] **Step 8: Run print tests and typecheck**

Run:

```powershell
pnpm -C frontend test -- useRecordPrintMode.test.tsx DocPdfCanvas.ready.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: both test files pass; typecheck passes.

- [ ] **Step 9: Commit canonical print mode**

```powershell
git add frontend/src/pages/books/useRecordPrintMode.ts frontend/src/pages/books/useRecordPrintMode.test.tsx frontend/src/pages/application/DocPdfCanvas.ready.test.tsx frontend/src/pages/application/DocPdfCanvas.tsx frontend/src/pages/books/BookRecordPage.tsx
git commit -m "feat: print saved records after PDF readiness"
```

---

### Task 3: Build the Shared Saved-record Actions

**Files:**
- Create: `frontend/src/components/books/SavedRecordActions.tsx`
- Create: `frontend/src/components/books/SavedRecordActions.test.tsx`
- Modify: `frontend/src/locales/en.json` under `books`
- Modify: `frontend/src/locales/ar.json` under `books`

**Interfaces:**
- Consumes: `api.getBook(bookId)`, `canSendForApproval`, `SubmitForApprovalDialog`, and `/books/{id}?print=1` from Tasks 1–2.
- Produces:

```ts
export type NotificationChoice = 'enabled' | 'skipped'

export interface SavedRecordActionsProps {
  bookId: number
  refNumber: string
  detail?: string
  notification?: NotificationChoice
  className?: string
}
```

- [ ] **Step 1: Write failing shared-action behavior tests**

In `SavedRecordActions.test.tsx`, use a `QueryClientProvider` and `MemoryRouter`. Mock `api.getBook`, `useCapabilities`, `useIsMobile`, and `SubmitForApprovalDialog`. Cover these observable contracts:

1. Draft + `books.manage` + current PDF: Arabic Saved/reference text and Print, Send for approval, Open full record are visible.
2. Clicking Send for approval mounts the existing dialog with the same `bookId`.
3. Pending record: Send for approval is absent and Pending approval is visible.
4. No `books.manage`: Send for approval is absent.
5. No current/imported PDF: Print is disabled and the PDF-unavailable explanation is visible.
6. Clicking Print calls `window.open('/books/42?print=1', '_blank')` and nulls the returned window's `opener`.
7. When `window.open` returns `null`, the router location changes to `/books/42?print=1`.
8. `notification="enabled"` and `notification="skipped"` render distinct honest summaries; omitted notification renders neither.

Use a minimal `BookRead` fixture whose latest version has `pdf_url` and `approval_state: 'none'`.

- [ ] **Step 2: Run the component test and confirm RED**

Run:

```powershell
pnpm -C frontend test -- SavedRecordActions.test.tsx
```

Expected: module-not-found failure for `SavedRecordActions`.

- [ ] **Step 3: Add bilingual shared completion copy**

Add the following keys under `books.completion` in both locale files:

```json
{
  "savedToRecords": "Saved to Records",
  "reference": "Reference {{ref}}",
  "notificationEnabled": "Employee notification enabled for this save.",
  "notificationSkipped": "Saved without notifying the employee.",
  "pendingApproval": "Pending approval",
  "printUnavailable": "PDF unavailable — open the record for the DOCX fallback."
}
```

Arabic values:

```json
{
  "savedToRecords": "تم الحفظ في السجلات",
  "reference": "المرجع {{ref}}",
  "notificationEnabled": "تم الحفظ مع تفعيل إشعار الموظف.",
  "notificationSkipped": "تم الحفظ دون إشعار الموظف.",
  "pendingApproval": "بانتظار الاعتماد",
  "printUnavailable": "ملف PDF غير متاح — افتح السجل لاستخدام ملف DOCX البديل."
}
```

Reuse existing `books.record.print`, `books.approval.submitForApproval`, and `books.pane.openRecord` action labels instead of adding synonyms.

- [ ] **Step 4: Implement `SavedRecordActions`**

Required behavior:

```tsx
const bookQuery = useQuery({
  queryKey: ['books', 'detail', bookId],
  queryFn: () => api.getBook(bookId),
})
const state = bookQuery.data?.approval_state
const current = bookQuery.data?.versions?.at(-1)
const printable = Boolean(current?.pdf_url || bookQuery.data?.imported_doc?.pdf_url)
const canSubmit =
  state === 'none' && canSendForApproval(state, { canManage: has('books.manage') })
```

- Always render Saved, reference, optional detail, and Open record.
- Render Print disabled until a printable PDF is known; when loaded without one, show `printUnavailable`.
- Render Send for approval only for a draft (`state === 'none'`) with capability.
- Render Pending approval when `state === 'pending'`; do not show a reroute action here.
- Open `SubmitForApprovalDialog` locally. Its existing `['books']` invalidation refetches this component's query.
- Open Print directly from the click:

```ts
const opened = window.open(`/books/${bookId}?print=1`, '_blank')
if (opened) opened.opener = null
else navigate(`/books/${bookId}?print=1`)
```

- Open record with `navigate(`/books/${bookId}`)`.
- Use the existing mobile breakpoint hook to render DOM order matching visual order: desktop Print → Approval → Open; phone Approval → Print → Open. This preserves keyboard focus order without CSS-only reordering.
- Use logical spacing, semantic buttons, `aria-hidden` decorative icons, and visible focus rings.

- [ ] **Step 5: Run shared-action tests and typecheck**

Run:

```powershell
pnpm -C frontend test -- SavedRecordActions.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: all shared-action tests pass; typecheck passes.

- [ ] **Step 6: Commit the shared action surface**

```powershell
git add frontend/src/components/books/SavedRecordActions.tsx frontend/src/components/books/SavedRecordActions.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat: add saved record handoff actions"
```

---

### Task 4: Replace the Frontend Notifier List and Model Saved Jobs

**Files:**
- Modify: `frontend/src/pages/application/notifyToggle.ts`
- Modify: `frontend/src/pages/application/notifyToggle.test.ts`
- Create: `frontend/src/pages/application/savedGeneration.ts`
- Create: `frontend/src/pages/application/savedGeneration.test.ts`
- Modify: `frontend/src/components/notify/NotifyEmployeeToggle.tsx`
- Create: `frontend/src/components/notify/NotifyEmployeeToggle.test.tsx`
- Modify: `frontend/src/pages/application/ApplicationPage.tsx:249-265,1122-1141`

**Interfaces:**
- Consumes: generated `TemplateMeta.notifies_employee` and `JobStatusResponse.book_id` from Task 1.
- Produces:

```ts
export interface NotifyToggleContext {
  notifiesEmployee: boolean
  autosendEnabled: boolean
  isRevision: boolean
}

export function shouldShowNotifyToggle(context: NotifyToggleContext): boolean

export interface SavedGeneration {
  bookId: number
  docId: number
  ref: string
}

export function savedGenerationFromJob(job: JobStatusResponse): SavedGeneration | null
```

- Produces: optional `NotifyEmployeeToggle.disabled?: boolean`.

- [ ] **Step 1: Rewrite notifier-visibility tests for server metadata**

Delete every `SMS_FORMS` assertion/import. Test:

```ts
expect(shouldShowNotifyToggle({
  notifiesEmployee: true,
  autosendEnabled: true,
  isRevision: false,
})).toBe(true)
```

Then assert false separately for metadata false, global auto-send false, and revision true. No test contains a template ID.

- [ ] **Step 2: Add failing saved-job extraction tests**

Create `savedGeneration.test.ts` with a completed fixture containing:

```ts
{
  job_id: 'job-1',
  status: 'done',
  submission_id: 'submission-1',
  book_id: 42,
  documents: [{
    role: 'primary',
    document_id: 9,
    template_id: 'Salary Deduction Form',
    ref_number: '1/5/GSSG/141',
    docx_url: '/api/v1/documents/9/download?format=docx',
    pdf_url: '/api/v1/documents/9/download?format=pdf',
  }],
  error_code: null,
  error_message: null,
}
```

Assert the helper returns `{ bookId: 42, docId: 9, ref: '1/5/GSSG/141' }`. Assert null for preview ref `DRAFT`, null `book_id`, absent primary, and absent `document_id`.

- [ ] **Step 3: Add failing disabled-switch test**

Render `NotifyEmployeeToggle` with `disabled` and assert its `role="switch"` button is disabled, does not call `onChange`, retains `aria-checked`, and has an Arabic accessible label.

- [ ] **Step 4: Run the helper/component tests and confirm RED**

Run:

```powershell
pnpm -C frontend test -- notifyToggle.test.ts savedGeneration.test.ts NotifyEmployeeToggle.test.tsx
```

Expected: failures for the old function signature, missing saved-job module, and missing `disabled` prop.

- [ ] **Step 5: Implement the minimal helpers and disabled state**

`notifyToggle.ts` becomes:

```ts
export interface NotifyToggleContext {
  notifiesEmployee: boolean
  autosendEnabled: boolean
  isRevision: boolean
}

export function shouldShowNotifyToggle({
  notifiesEmployee,
  autosendEnabled,
  isRevision,
}: NotifyToggleContext): boolean {
  return notifiesEmployee && autosendEnabled && !isRevision
}
```

`savedGeneration.ts` validates all required values rather than coercing malformed results:

```ts
export function savedGenerationFromJob(job: JobStatusResponse): SavedGeneration | null {
  const primary = job.documents?.find((document) => document.role === 'primary')
  if (
    job.status !== 'done' ||
    job.book_id == null ||
    primary?.document_id == null ||
    !primary.ref_number ||
    primary.ref_number === 'DRAFT'
  ) return null
  return { bookId: job.book_id, docId: primary.document_id, ref: primary.ref_number }
}
```

Add `disabled = false` to `NotifyEmployeeToggle`, pass it to the button, block click changes through the native disabled state, and add the existing disabled-opacity/cursor styling without changing leave-approval callers.

Migrate the existing `ApplicationPage` callsite in the same task so the branch
stays type-safe:

```ts
const showNotifyEmployee = shouldShowNotifyToggle({
  notifiesEmployee: selectedMeta?.notifies_employee ?? false,
  autosendEnabled: settingsQuery.data?.sms_autosend_enabled ?? false,
  isRevision: reviseBookId !== null,
})
```

Use `showNotifyEmployee` at the existing switch condition; Task 5 will move
that already-correct condition into the new top handoff.

- [ ] **Step 6: Run helper/component tests and typecheck**

Run:

```powershell
pnpm -C frontend test -- notifyToggle.test.ts savedGeneration.test.ts NotifyEmployeeToggle.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: all tests and the full TypeScript typecheck pass; no `SMS_FORMS` export, import, or old positional `shouldShowNotifyToggle` call remains.

- [ ] **Step 7: Commit the clean frontend model**

```powershell
git add frontend/src/pages/application/notifyToggle.ts frontend/src/pages/application/notifyToggle.test.ts frontend/src/pages/application/savedGeneration.ts frontend/src/pages/application/savedGeneration.test.ts frontend/src/components/notify/NotifyEmployeeToggle.tsx frontend/src/components/notify/NotifyEmployeeToggle.test.tsx frontend/src/pages/application/ApplicationPage.tsx
git commit -m "refactor: derive notification controls from API metadata"
```

---

### Task 5: Integrate the Two-state Generated-form Handoff

**Files:**
- Create: `frontend/src/pages/application/GeneratedSaveActions.tsx`
- Create: `frontend/src/pages/application/GeneratedSaveActions.test.tsx`
- Modify: `frontend/src/pages/application/ApplicationPage.tsx:160-204,249-265,450-485,568-629,1122-1236`
- Modify: `frontend/src/locales/en.json` under `application.actions` and `application.notify`
- Modify: `frontend/src/locales/ar.json` under `application.actions` and `application.notify`

**Interfaces:**
- Consumes: `SavedRecordActions`, `NotificationChoice`, `shouldShowNotifyToggle`, and `savedGenerationFromJob`.
- Produces:

```ts
export interface GeneratedSaveActionsProps {
  showNotify: boolean
  notifyEmployee: boolean
  notifyDisabled: boolean
  saveDisabled: boolean
  saving: boolean
  hint: string
  onNotifyChange: (checked: boolean) => void
  onSave: () => void
}
```

- `ApplicationPage.lastSaved` becomes `SavedGeneration & { notification?: NotificationChoice }`.

- [ ] **Step 1: Write failing pre-save handoff tests**

Create `GeneratedSaveActions.test.tsx` and cover:

- Arabic Ready to save to Records title.
- Notification row appears only when `showNotify=true`.
- On hint names WhatsApp then SMS fallback.
- Off state uses the saved-without-notifying hint.
- Save button invokes `onSave` once.
- `saving` disables both switch and save button.
- `saveDisabled` leaves the switch available but disables Save.

- [ ] **Step 2: Run the pre-save component test and confirm RED**

Run:

```powershell
pnpm -C frontend test -- GeneratedSaveActions.test.tsx
```

Expected: module-not-found failure.

- [ ] **Step 3: Add exact generated-handoff translations**

English additions:

```json
{
  "readyToSave": "Ready to save to Records",
  "saveToRecords": "Save to Records",
  "notificationChannel": "WhatsApp, then SMS fallback"
}
```

Arabic additions:

```json
{
  "readyToSave": "جاهز للحفظ في السجلات",
  "saveToRecords": "حفظ في السجلات",
  "notificationChannel": "واتساب، ثم الرسائل النصية كخيار بديل"
}
```

Keep the existing `application.notify.label`. Change `hintOn` to the channel-accurate fallback explanation only if `GeneratedSaveActions` does not render `notificationChannel` separately; never say SMS alone.

- [ ] **Step 4: Implement `GeneratedSaveActions`**

Render a bordered, rounded top handoff bar matching the approved HTML hierarchy:

- status/title and supplied hint;
- existing `NotifyEmployeeToggle` when requested;
- primary Save to Records button;
- single-column phone layout and right-aligned desktop action using logical classes;
- no duplicate switch implementation.

The component owns no async state and performs no API calls.

- [ ] **Step 5: Migrate `ApplicationPage` saved state and capture the submitted choice**

Reuse the metadata-derived `showNotifyEmployee` value introduced in Task 4.

Add:

```ts
const pendingNotificationRef = useRef<NotificationChoice | undefined>(undefined)
const [lastSaved, setLastSaved] = useState<
  (SavedGeneration & { notification?: NotificationChoice }) | null
>(null)
```

Immediately before a committed `generateMutation.mutate(payload)`, capture the choice that actually went into the request:

```ts
pendingNotificationRef.current = showNotifyEmployee
  ? notifyEmployee ? 'enabled' : 'skipped'
  : undefined
```

Preview submissions leave `pendingNotificationRef` unchanged. Disable the switch while the commit mutation is pending so the visible choice cannot diverge from the submitted payload.

- [ ] **Step 6: Convert completed jobs without a reference lookup**

In `handleJobDone()`:

```ts
const saved = savedGenerationFromJob(job)
if (pendingCommitRef.current && selectedTemplate && saved) {
  setLastSaved({ ...saved, notification: pendingNotificationRef.current })
  toast.success(t('application.toast.saved', { ref: saved.ref }))
}
```

Retain draft clearing, attachment clearing, query invalidation, and one-shot revision reset. Clear `pendingNotificationRef.current` after terminal committed handling.

Remove the basket's `api.getBookByRef(lastSaved.ref)` call and use `lastSaved.bookId` directly. Keep Add to email basket as a separate secondary action below the preview; do not add it to the shared action row.

- [ ] **Step 7: Replace the bottom save footer with top pre/post states**

Inside the Preview tab, render in this DOM order:

```tsx
{previewJobStatus === 'done' && !lastSaved && (
  <GeneratedSaveActions
    showNotify={showNotifyEmployee}
    notifyEmployee={notifyEmployee}
    notifyDisabled={generateMutation.isPending}
    saveDisabled={
      (!isAdminCategory && !selectedEmployee) ||
      generateMutation.isPending ||
      missingSlotKeys.length > 0
    }
    saving={generateMutation.isPending && pendingCommitRef.current}
    hint={
      missingSlotKeys.length > 0
        ? t('application.attachments.requiredHint', { slot: firstMissingSlotLabel })
        : t('application.saveReadyHint')
    }
    onNotifyChange={setNotifyEmployee}
    onSave={() => void handleSave()}
  />
)}
{lastSaved && (
  <SavedRecordActions
    bookId={lastSaved.bookId}
    refNumber={lastSaved.ref}
    notification={lastSaved.notification}
  />
)}
<JobStatus key={activeJobId} jobId={activeJobId} onDone={handleJobDone} />
```
Pass existing attachment/employee gating into `saveDisabled` and existing hint text into `hint`. Remove the old notification row, Save/Saved button, and footer border after the preview. Keep Edit fields/New form controls unchanged. Keep the existing reset-to-On calls for template selection and gallery reset.

- [ ] **Step 8: Run generated-flow tests and typecheck**

Run:

```powershell
pnpm -C frontend test -- GeneratedSaveActions.test.tsx notifyToggle.test.ts savedGeneration.test.ts NotifyEmployeeToggle.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: tests and typecheck pass; no import or callsite remains for `SMS_FORMS` or `getBookByRef` in `ApplicationPage`.

- [ ] **Step 9: Commit generated-form integration**

```powershell
git add frontend/src/pages/application/GeneratedSaveActions.tsx frontend/src/pages/application/GeneratedSaveActions.test.tsx frontend/src/pages/application/ApplicationPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat: add generated form completion handoff"
```

---

### Task 6: Integrate Finished Word Sessions and Remove Report’s Dead Action

**Files:**
- Modify: `frontend/src/pages/books/WordHandoffDialog.tsx:124-228`
- Modify: `frontend/src/pages/books/WordHandoffDialog.test.tsx:201-384`

**Interfaces:**
- Consumes: `SavedRecordActionsProps` from Task 3.
- Authoritative eligibility: `latest?.template_id === 'General Book'`.

- [ ] **Step 1: Add failing finished-Word action tests**

Mock `SavedRecordActions` with a sentinel that exposes `bookId` and `refNumber`. Extend the finished General Book fixture so its latest version includes:

```ts
template_id: 'General Book'
```

After Finish, assert the sentinel is above the PDF and receives the finished book ID/reference. Add a Report fixture whose latest version has `template_id: 'Report'`; assert:

```tsx
expect(screen.getByTestId('saved-record-actions')).toBeTruthy()
expect(screen.queryByText('حفظ كقالب')).toBeNull()
```

Retain the existing General Book save-as-template mutation test and assert the action remains available there.

- [ ] **Step 2: Run Word tests and confirm RED**

Run:

```powershell
pnpm -C frontend test -- WordHandoffDialog.test.tsx
```

Expected: missing shared action sentinel and Report still exposes Save as template.

- [ ] **Step 3: Render shared actions above the finished PDF**

In the `finishedBook` branch, after `DialogHeader` and before the PDF container, render:

```tsx
<SavedRecordActions
  bookId={finishedBook.id}
  refNumber={session.ref_number}
  detail={finishedBook.subject ?? undefined}
  className="mb-4"
/>
```

Do not add a notification summary: General Book and Report are not notifier-backed.

- [ ] **Step 4: Guard Save as template by the finished version**

Define:

```ts
const canSaveAsTemplate = latest?.template_id === 'General Book'
```

Render both the Save as template trigger and its name dialog only when `canSaveAsTemplate`. Do not infer eligibility from page route, subject, session ref format, or the presence of a template name.

- [ ] **Step 5: Run Word tests and typecheck**

Run:

```powershell
pnpm -C frontend test -- WordHandoffDialog.test.tsx SavedRecordActions.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: General Book keeps Save as template; Report lacks it; both show shared record actions; all tests pass.

- [ ] **Step 6: Commit Word integration**

```powershell
git add frontend/src/pages/books/WordHandoffDialog.tsx frontend/src/pages/books/WordHandoffDialog.test.tsx
git commit -m "feat: add Word completion actions"
```

---

### Task 7: Persist Duty Transfer Completion Actions

**Files:**
- Modify: `frontend/src/pages/dutyLocations/TransferDialog.tsx:15-105`
- Modify: `frontend/src/pages/dutyLocations/DutyLocationsPage.tsx:15-56,147-163,278-287`
- Create: `frontend/src/pages/dutyLocations/DutyLocationsPage.completion.test.tsx`
- Modify: `frontend/src/locales/en.json` under `dutyLocations`
- Modify: `frontend/src/locales/ar.json` under `dutyLocations`

**Interfaces:**
- Consumes: `DutyTransferResult` and `SavedRecordActions`.
- Changes: `TransferDialogProps.onTransferred: (result: DutyTransferResult) => void`.
- Produces: page state `DutyTransferResult | null`; only results with non-null `book_id` and `ref` render actions.

- [ ] **Step 1: Write the failing parent-wiring test**

Create `DutyLocationsPage.completion.test.tsx`. Mock `api.listEmployees`, roster/unit child components, and `TransferDialog` so the test can select an employee and complete with either:

```ts
{ book_id: 42, ref: '1/12/GSSG/106', document_id: 9, moved: ['G3309'] }
```

or:

```ts
{ book_id: null, ref: null, document_id: null, moved: ['G3309'] }
```

Mock `SavedRecordActions` with a sentinel. Assert the first result clears selection and renders the sentinel with ID/reference under the page header. Assert the no-book result clears selection but renders no sentinel.

- [ ] **Step 2: Run the Duty page test and confirm RED**

Run:

```powershell
pnpm -C frontend test -- DutyLocationsPage.completion.test.tsx
```

Expected: callback type/result is not propagated and no completion surface exists.

- [ ] **Step 3: Pass the complete transfer result to the parent**

In `TransferDialog`:

- import `DutyTransferResult`;
- change `onTransferred` to receive it;
- call `onTransferred(result)` before closing;
- remove `useNavigate` and the toast action that was the only durable route;
- retain a short success toast for both document and no-book outcomes.

The success branch becomes structurally:

```ts
if (result.book_id == null) {
  toast.success(t('dutyLocations.transfer.movedNoBook', { count: result.moved.length }))
} else {
  toast.success(t('dutyLocations.transfer.success', { ref: result.ref }))
}
onTransferred(result)
onOpenChange(false)
```

- [ ] **Step 4: Store and render the latest document-producing result**

In `DutyLocationsPage`, add:

```ts
const [completedTransfer, setCompletedTransfer] = useState<DutyTransferResult | null>(null)
```

Handle completion:

```ts
onTransferred={(result) => {
  setSelected(new Set())
  setCompletedTransfer(result.book_id != null && result.ref ? result : null)
}}
```

Immediately below the page header, render:

```tsx
{completedTransfer?.book_id != null && completedTransfer.ref && (
  <SavedRecordActions
    bookId={completedTransfer.book_id}
    refNumber={completedTransfer.ref}
    detail={t('dutyLocations.completion.detail', {
      count: completedTransfer.moved.length,
    })}
    className="mb-5"
  />
)}
```

A later transfer replaces the prior result. Closing/cancelling a dialog does not erase it. Navigating away naturally unmounts it.

- [ ] **Step 5: Add bilingual Duty completion detail**

English:

```json
"completion": {
  "detail_one": "1 employee transferred",
  "detail_other": "{{count}} employees transferred"
}
```

Arabic:

```json
"completion": {
  "detail_one": "تم نقل موظف واحد",
  "detail_other": "تم نقل {{count}} من الموظفين"
}
```

Use i18next count pluralization by passing `count`.

- [ ] **Step 6: Run Duty tests and typecheck**

Run:

```powershell
pnpm -C frontend test -- DutyLocationsPage.completion.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: book-producing result renders persistent actions; no-book result does not; typecheck passes.

- [ ] **Step 7: Commit Duty integration**

```powershell
git add frontend/src/pages/dutyLocations/TransferDialog.tsx frontend/src/pages/dutyLocations/DutyLocationsPage.tsx frontend/src/pages/dutyLocations/DutyLocationsPage.completion.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat: add duty transfer completion actions"
```

---

### Task 8: Verify the Complete Workflow

**Files:**
- Review: all files changed in Tasks 1–7
- No production deployment in this task

**Interfaces:**
- Verifies the approved design end to end; introduces no compatibility shims or duplicate action implementations.

- [ ] **Step 1: Run the complete focused backend verification**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_templates_catalog.py backend/tests/test_documents_autosend.py backend/tests/test_job_registry_prune.py backend/tests/test_notify_dispatch.py -q
venv\Scripts\ruff.exe check backend/app/services/notify_format.py backend/app/services/notify_dispatch.py backend/app/services/template_service.py backend/app/services/job_registry.py backend/app/api/v1/documents.py backend/tests/test_templates_catalog.py backend/tests/test_documents_autosend.py backend/tests/test_job_registry_prune.py
venv\Scripts\mypy.exe backend/app/services/notify_format.py backend/app/services/notify_dispatch.py backend/app/services/template_service.py backend/app/services/job_registry.py backend/app/api/v1/documents.py
```

Expected: all commands exit 0.

- [ ] **Step 2: Run the complete focused frontend verification**

```powershell
pnpm -C frontend test -- SavedRecordActions.test.tsx useRecordPrintMode.test.tsx DocPdfCanvas.ready.test.tsx notifyToggle.test.ts savedGeneration.test.ts NotifyEmployeeToggle.test.tsx GeneratedSaveActions.test.tsx WordHandoffDialog.test.tsx DutyLocationsPage.completion.test.tsx
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
pnpm -C frontend run build
```

Run these sequentially on this workstation to avoid exhausting memory. Expected: all commands exit 0; build emits the frontend bundle without changing committed generated assets.

- [ ] **Step 3: Confirm generated contract stability**

Re-run:

```powershell
venv\Scripts\python.exe -X utf8 scripts\dump_openapi.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm run gen:api"
```

Expected: `backend/openapi.json` and `frontend/src/lib/api.types.ts` remain unchanged from Task 1. If regeneration changes them, commit both together only after resolving the source/schema mismatch.

- [ ] **Step 4: Drive the actual frontend in Chromium with deterministic API fixtures**

Start the worktree Vite server through the harness process manager, open Chromium, and intercept `/api/v1/*` with deterministic fixture responses so no live production data or gateway is touched. Exercise these rendered paths:

1. Notifier-backed generated form: metadata true + global auto-send true shows the default-on switch above the preview; Off changes copy; committed job response includes `book_id` and changes the same area to Saved actions.
2. Non-notifying generated form and revision: no switch.
3. Shared actions: approval dialog opens; Open record navigates; Print opens `/books/{id}?print=1`, waits for the canvas fixture readiness, calls `window.print` once, and removes the query parameter.
4. Finished General Book: shared actions plus Save as template.
5. Finished Report: shared actions and no Save as template.
6. Duty transfer: dialog closes and persistent actions remain under the page heading.

Use a stubbed outbound-message fixture; do not configure or call office WhatsApp/SMS endpoints.

- [ ] **Step 5: Verify bilingual responsive presentation**

For generated, Word, and Duty completion surfaces, inspect:

- 1440×1000 English/LTR light;
- 1440×1000 Arabic/RTL dark;
- 390×844 English/LTR light;
- 390×844 Arabic/RTL dark.

At every state assert in the browser:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

Confirm status/reference remain readable, the switch thumb mirrors in RTL, phone primary approval spans the row, Print/Open share the next row, and focus order matches visual order. Capture screenshots as verification evidence; do not commit them unless the user requests visual artifacts.

- [ ] **Step 6: Run required reviews**

Run the project `i18n-rtl-reviewer` against the changed components/locales and the `notification-template-reviewer` against notification control/copy changes. Apply concrete findings, rerun the affected focused test, then rerun TypeScript typecheck. Confirm reviewers report no outbound notification-template wording changes.

- [ ] **Step 7: Review affected callsites and remove obsolete paths**

Confirm:

- no `SMS_FORMS` export/import remains;
- `ApplicationPage` no longer calls `getBookByRef` for the just-saved record;
- Report cannot render Save as template;
- Duty transfer success no longer depends on a toast action;
- no second print stylesheet or second approval dialog implementation was introduced;
- every `set_done()` call passes `book_id`;
- English and Arabic keys are paired.

- [ ] **Step 8: Commit review fixes if any**

If Steps 1–7 required code corrections, commit only the verified corrections:

```powershell
git add backend/app/services/notify_format.py backend/app/services/notify_dispatch.py backend/app/services/template_service.py backend/app/services/job_registry.py backend/app/api/v1/documents.py backend/tests/test_templates_catalog.py backend/tests/test_documents_autosend.py backend/tests/test_job_registry_prune.py backend/tests/test_notify_dispatch.py backend/openapi.json frontend/src/lib/api.types.ts frontend/src/components/books/SavedRecordActions.tsx frontend/src/components/books/SavedRecordActions.test.tsx frontend/src/components/notify/NotifyEmployeeToggle.tsx frontend/src/components/notify/NotifyEmployeeToggle.test.tsx frontend/src/pages/application/ApplicationPage.tsx frontend/src/pages/application/DocPdfCanvas.tsx frontend/src/pages/application/DocPdfCanvas.ready.test.tsx frontend/src/pages/application/GeneratedSaveActions.tsx frontend/src/pages/application/GeneratedSaveActions.test.tsx frontend/src/pages/application/notifyToggle.ts frontend/src/pages/application/notifyToggle.test.ts frontend/src/pages/application/savedGeneration.ts frontend/src/pages/application/savedGeneration.test.ts frontend/src/pages/books/BookRecordPage.tsx frontend/src/pages/books/WordHandoffDialog.tsx frontend/src/pages/books/WordHandoffDialog.test.tsx frontend/src/pages/books/useRecordPrintMode.ts frontend/src/pages/books/useRecordPrintMode.test.tsx frontend/src/pages/dutyLocations/TransferDialog.tsx frontend/src/pages/dutyLocations/DutyLocationsPage.tsx frontend/src/pages/dutyLocations/DutyLocationsPage.completion.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "fix: polish service completion workflow"
```

If no files changed, do not create an empty commit.
