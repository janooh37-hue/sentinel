# Sick-leave OCR Merge + G-number Export Naming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a sick-leave form merge its OCR'd medical scan into the form PDF (reusing Salary Transfer's slot/merge pipeline), and rename exported documents by employee G-number (sick leave = G-number only; all others = G-number + Arabic form name).

**Architecture:** Part 1 is almost pure reuse — declaring one attachment slot on the shared `"Leave Application Form"` template lights up the existing stage→merge→re-merge-on-sign pipeline; the frontend gates the slot to Sick Leave and auto-carries the intake scan into it. Part 2 replaces the single filename line in the document download handler with a small, unit-tested naming helper.

**Tech Stack:** Backend — FastAPI, SQLAlchemy, PyMuPDF (existing merge), pytest. Frontend — React, react-hook-form, react-router, react-query, vitest.

## Global Constraints

- Sick-leave export filename = **G-number only** (`G3082.pdf`), no date/ref — explicit management requirement.
- All other documents export as `{G-number}_{Arabic form name}.pdf`; documents with **no linked employee** (admin forms) fall back to `{ref}_{Arabic form name}.pdf`; blank Arabic name falls back to the English `template_id`.
- The medical-certificate slot is **optional** (`required=False`) — the `"Leave Application Form"` template serves all leave types, so it must never block non-sick generation.
- The slot is shown in the UI **only when `leave_type == "Sick Leave"`**.
- Filenames must keep Arabic letters; only strip filesystem-unsafe / bidi / control chars.
- Live-main repo: commit each task; do not push unless the user asks (see repo memory).
- Backend tests run from `backend/` via `python -m pytest`; frontend tests via `npx vitest run` from `frontend/`.

---

### Task 1: Backend — declare the `medical_certificate` attachment slot

**Files:**
- Modify: `backend/app/core/form_policy.py` (add to `ATTACHMENT_SLOTS`, ~line 46-63)
- Test: `backend/tests/test_form_policy_leave_slot.py` (create)

**Interfaces:**
- Consumes: existing `AttachmentSlot` dataclass and `attachment_slots_of(template_id)` in `form_policy.py`.
- Produces: `attachment_slots_of("Leave Application Form")` returns a one-element list whose slot `.key == "medical_certificate"` and `.required is False`. Frontend and `generate_document` read this via existing plumbing — no other backend change needed for the merge.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_form_policy_leave_slot.py`:

```python
from app.core.form_policy import attachment_slots_of


def test_leave_application_form_has_optional_medical_certificate_slot():
    slots = attachment_slots_of("Leave Application Form")
    keys = [s.key for s in slots]
    assert "medical_certificate" in keys
    slot = next(s for s in slots if s.key == "medical_certificate")
    assert slot.required is False
    assert slot.label_en
    assert slot.label_ar


def test_non_leave_template_unaffected():
    assert attachment_slots_of("General Book") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_form_policy_leave_slot.py -v`
Expected: FAIL on `test_leave_application_form_has_optional_medical_certificate_slot` — `"medical_certificate" in keys` is False (no slots for that template yet).

- [ ] **Step 3: Add the slot**

In `backend/app/core/form_policy.py`, add a new entry to the `ATTACHMENT_SLOTS` dict (keep the existing `"Salary Transfer Request"` entry unchanged):

```python
    "Leave Application Form": [
        AttachmentSlot(
            key="medical_certificate",
            label_en="Medical certificate / sick-leave report",
            label_ar="التقرير الطبي / تقرير الإجازة المرضية",
            required=False,
            hint_en="Attach the scanned sick-leave report; it is appended to the form PDF.",
            hint_ar="أرفق تقرير الإجازة المرضية الممسوح؛ يُلحق بنموذج النموذج.",
        ),
    ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_form_policy_leave_slot.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/form_policy.py backend/tests/test_form_policy_leave_slot.py
git commit -m "feat(forms): add optional medical-certificate slot to Leave Application Form"
```

---

### Task 2: Backend — G-number export filename

**Files:**
- Create: `backend/app/core/export_naming.py`
- Modify: `backend/app/services/document_service.py` (add `download_filename_for`)
- Modify: `backend/app/api/v1/documents.py:441` (use the new helper)
- Test: `backend/tests/test_export_naming.py` (create)

**Interfaces:**
- Produces `export_filename(*, employee_id: str | None, ref_number: str, template_id: str, arabic_name: str, is_sick_leave: bool, ext: str) -> str` (pure).
- Produces `document_service.download_filename_for(row: Document, ext: str) -> str` — resolves the Arabic name from `load_fields_meta()` and sick-leave status from `row.leave`, then calls `export_filename`.
- Consumes: `document_service.load_fields_meta()` (existing), `Document.leave` relationship, `Document.employee_id`, `.ref_number`, `.template_id`.

- [ ] **Step 1: Write the failing test (pure helper)**

Create `backend/tests/test_export_naming.py`:

```python
from app.core.export_naming import export_filename


def test_sick_leave_is_gnumber_only():
    assert export_filename(
        employee_id="G3082", ref_number="HR-0042",
        template_id="Leave Application Form", arabic_name="طلب إجازة مرضية",
        is_sick_leave=True, ext=".pdf",
    ) == "G3082.pdf"


def test_other_form_is_gnumber_plus_arabic():
    assert export_filename(
        employee_id="G3082", ref_number="HR-0042",
        template_id="Leave Application Form", arabic_name="طلب إجازة سنوية",
        is_sick_leave=False, ext=".pdf",
    ) == "G3082_طلب إجازة سنوية.pdf"


def test_no_employee_falls_back_to_ref():
    assert export_filename(
        employee_id=None, ref_number="GS-0333",
        template_id="General Book", arabic_name="",
        is_sick_leave=False, ext=".pdf",
    ) == "GS-0333_General Book.pdf"


def test_blank_arabic_falls_back_to_template_id():
    assert export_filename(
        employee_id="G3082", ref_number="HR-0042",
        template_id="Material Request Form", arabic_name="",
        is_sick_leave=False, ext=".pdf",
    ) == "G3082_Material Request Form.pdf"


def test_sanitizes_unsafe_chars_but_keeps_arabic():
    out = export_filename(
        employee_id="G3082", ref_number="HR-0042",
        template_id="X", arabic_name="طلب/إجازة",
        is_sick_leave=False, ext=".pdf",
    )
    assert out == "G3082_طلب_إجازة.pdf"
    assert "/" not in out


def test_docx_extension():
    assert export_filename(
        employee_id="G3082", ref_number="HR-0042",
        template_id="Leave Application Form", arabic_name="طلب إجازة مرضية",
        is_sick_leave=True, ext=".docx",
    ) == "G3082.docx"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_export_naming.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core.export_naming'`.

- [ ] **Step 3: Write the pure helper**

Create `backend/app/core/export_naming.py`:

```python
"""Export-download filename rules (spec 2026-07-01).

Sick-leave PDFs are named by the employee's G-number ONLY (a management
request); every other document is ``<G-number>_<Arabic form name>``. Documents
with no linked employee (admin-category forms) fall back to
``<ref>_<Arabic form name>``. A blank Arabic name falls back to the English
``template_id``.
"""
from __future__ import annotations

import re

# Path separators / control chars PLUS unicode bidi-control, zero-width and BOM
# codepoints that pass ``isalnum`` but enable filename spoofing. Arabic letters
# are NOT in this class, so they survive. Mirrors leave_service._UNSAFE_CHARS.
_UNSAFE_CHARS = re.compile(
    # NOTE: copy this pattern verbatim from leave_service._UNSAFE_CHARS
    # (backend/app/services/leave_service.py) to stay in sync.
    "[\\/:*?\"<>|\x00-\x1f"
    "\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]"
)


def _sanitize(part: str) -> str:
    return _UNSAFE_CHARS.sub("_", part).strip().strip(".")


def export_filename(
    *,
    employee_id: str | None,
    ref_number: str,
    template_id: str,
    arabic_name: str,
    is_sick_leave: bool,
    ext: str,
) -> str:
    """Compose the download filename (including ``ext``, e.g. ``".pdf"``)."""
    name = _sanitize(arabic_name) or _sanitize(template_id)
    if is_sick_leave and employee_id:
        stem = _sanitize(employee_id)
    elif employee_id:
        stem = f"{_sanitize(employee_id)}_{name}"
    else:
        stem = f"{_sanitize(ref_number)}_{name}"
    return f"{stem}{ext}"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_export_naming.py -v`
Expected: PASS (all six).

- [ ] **Step 5: Add the DB-aware wrapper + its test**

Append to `backend/app/services/document_service.py` (near other module-level helpers; `load_fields_meta` and `Document` are already in scope in this module):

```python
def download_filename_for(row: "Document", ext: str) -> str:
    """Filename for a document download, per export-naming rules (spec 2026-07-01)."""
    from app.core.export_naming import export_filename

    meta = load_fields_meta().get(row.template_id) or {}
    arabic_name = meta.get("name_ar", "")
    is_sick = row.leave is not None and row.leave.leave_type == "Sick Leave"
    return export_filename(
        employee_id=row.employee_id,
        ref_number=row.ref_number,
        template_id=row.template_id,
        arabic_name=arabic_name,
        is_sick_leave=is_sick,
        ext=ext,
    )
```

If `Document` is not imported at module top, add `from app.db.models import Document` to the existing model imports (check the top of the file — it already imports `Leave`/`Book`; add `Document` if missing).

Create `backend/tests/test_download_filename.py`:

```python
from datetime import date

import pytest

from app.db.models import Document, Employee, Leave
from app.services import document_service


@pytest.fixture
def emp(db_session):
    e = Employee(id="G3082", name_en="Test Emp", name_ar="موظف")
    db_session.add(e)
    db_session.flush()
    return e


def _doc(db_session, **kw):
    row = Document(
        employee_id=kw.get("employee_id", "G3082"),
        template_id=kw.get("template_id", "Leave Application Form"),
        ref_number=kw.get("ref_number", "HR-0042"),
        docx_path="x.docx",
        pdf_path="x.pdf",
        submission_id="s-1",
        leave_id=kw.get("leave_id"),
    )
    db_session.add(row)
    db_session.flush()
    return row


def test_sick_leave_document_is_gnumber_only(db_session, emp):
    leave = Leave(
        employee_id="G3082", leave_type="Sick Leave",
        start_date=date(2026, 7, 1), end_date=date(2026, 7, 3), days=3,
        status="Pending",
    )
    db_session.add(leave)
    db_session.flush()
    row = _doc(db_session, leave_id=leave.id)
    assert document_service.download_filename_for(row, ".pdf") == "G3082.pdf"


def test_annual_leave_document_uses_gnumber_plus_arabic(db_session, emp):
    leave = Leave(
        employee_id="G3082", leave_type="Annual Leave",
        start_date=date(2026, 7, 1), end_date=date(2026, 7, 3), days=3,
        status="Pending",
    )
    db_session.add(leave)
    db_session.flush()
    row = _doc(db_session, leave_id=leave.id)
    name = document_service.download_filename_for(row, ".pdf")
    assert name.startswith("G3082_")
    assert name.endswith(".pdf")


def test_document_without_employee_falls_back_to_ref(db_session):
    row = _doc(db_session, employee_id=None, template_id="General Book", ref_number="GS-0333")
    name = document_service.download_filename_for(row, ".pdf")
    assert name.startswith("GS-0333_")
```

Run: `python -m pytest tests/test_download_filename.py -v`
Expected: PASS. (If the `Leave`/`Document` constructors need extra non-null fields in this schema, add them minimally — check `backend/app/db/models.py` `Leave`/`Document` for `nullable=False` columns without defaults.)

- [ ] **Step 6: Wire the helper into the download endpoint**

In `backend/app/api/v1/documents.py`, replace line 441:

```python
    filename = f"{row.ref_number}_{row.template_id.replace(' ', '_')}{ext}"
```

with:

```python
    filename = document_service.download_filename_for(row, ext)
```

Ensure `document_service` is imported in `documents.py` (it imports `book_service`, `perm_service` already — add `from app.services import document_service` if not present; check the import block near the top).

- [ ] **Step 7: Run the full affected suites**

Run: `python -m pytest tests/test_export_naming.py tests/test_download_filename.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/core/export_naming.py backend/app/services/document_service.py backend/app/api/v1/documents.py backend/tests/test_export_naming.py backend/tests/test_download_filename.py
git commit -m "feat(documents): name exports by G-number (sick leave = G-number only)"
```

---

### Task 3: Frontend — gate the medical-certificate slot to Sick Leave

**Files:**
- Modify: `frontend/src/components/application/attachmentsState.ts` (add two pure helpers)
- Modify: `frontend/src/pages/application/ApplicationPage.tsx` (compute visible slots; use for render + payload)
- Test: `frontend/src/components/application/attachmentsState.test.ts` (create)

**Interfaces:**
- Produces `SICK_ONLY_SLOT_KEY = 'medical_certificate'`.
- Produces `visibleAttachmentSlots(slots: AttachmentSlotRead[], leaveType: string | undefined): AttachmentSlotRead[]`.
- Produces `filterStateToSlots(state: AttachmentsState, slots: AttachmentSlotRead[]): AttachmentsState`.
- Consumes in the page: `form.watch('leave_type')`, `attachmentSlots` (line 217), `attachmentsState` (line 221), `toGenerateSpecs` (line 368).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/application/attachmentsState.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { AttachmentSlotRead } from '@/lib/api'
import {
  visibleAttachmentSlots,
  filterStateToSlots,
  emptyAttachmentsState,
  SICK_ONLY_SLOT_KEY,
} from './attachmentsState'

const slot = (key: string): AttachmentSlotRead => ({
  key, label_en: key, label_ar: key, required: false, hint_en: '', hint_ar: '',
})

const staged = { kind: 'staged' as const, token: 't', filename: 'f', size: 1 }

describe('visibleAttachmentSlots', () => {
  it('hides medical_certificate for non-sick leave', () => {
    const slots = [slot(SICK_ONLY_SLOT_KEY), slot('other')]
    expect(visibleAttachmentSlots(slots, 'Annual Leave').map((s) => s.key)).toEqual(['other'])
  })
  it('shows medical_certificate for Sick Leave', () => {
    expect(
      visibleAttachmentSlots([slot(SICK_ONLY_SLOT_KEY)], 'Sick Leave').map((s) => s.key),
    ).toEqual([SICK_ONLY_SLOT_KEY])
  })
  it('hides it when leaveType is undefined', () => {
    expect(visibleAttachmentSlots([slot(SICK_ONLY_SLOT_KEY)], undefined)).toEqual([])
  })
})

describe('filterStateToSlots', () => {
  it('drops values whose slot is not visible', () => {
    const state = {
      ...emptyAttachmentsState(),
      slots: { [SICK_ONLY_SLOT_KEY]: staged, keep: staged },
    }
    const out = filterStateToSlots(state, [slot('keep')])
    expect(Object.keys(out.slots)).toEqual(['keep'])
    expect(out.extras).toEqual(state.extras)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/application/attachmentsState.test.ts`
Expected: FAIL — `visibleAttachmentSlots`/`filterStateToSlots`/`SICK_ONLY_SLOT_KEY` are not exported.

- [ ] **Step 3: Add the helpers**

In `frontend/src/components/application/attachmentsState.ts`, add the `AttachmentSlotRead` import if missing and append:

```ts
import type { AttachmentSlotRead } from '@/lib/api'

/** The medical-certificate slot rides the shared "Leave Application Form"
 * template but is only meaningful for Sick Leave. */
export const SICK_ONLY_SLOT_KEY = 'medical_certificate'

/** Slots to render for the current leave type: the sick-only slot is dropped
 * unless leaveType is exactly "Sick Leave". */
export function visibleAttachmentSlots(
  slots: AttachmentSlotRead[],
  leaveType: string | undefined,
): AttachmentSlotRead[] {
  if (leaveType === 'Sick Leave') return slots
  return slots.filter((s) => s.key !== SICK_ONLY_SLOT_KEY)
}

/** Strip slot values whose slot is not in `slots` (e.g. a hidden
 * medical_certificate) so they never ride the generate payload. */
export function filterStateToSlots(
  state: AttachmentsState,
  slots: AttachmentSlotRead[],
): AttachmentsState {
  const allowed = new Set(slots.map((s) => s.key))
  const kept: AttachmentsState['slots'] = {}
  for (const [k, v] of Object.entries(state.slots)) {
    if (allowed.has(k)) kept[k] = v
  }
  return { ...state, slots: kept }
}
```

(If `AttachmentsState['slots']` is not indexable as shown, mirror the existing type — check the `AttachmentsState` interface near line 25 and match its `slots` field type.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/application/attachmentsState.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into ApplicationPage**

In `frontend/src/pages/application/ApplicationPage.tsx`:

1. Extend the import at line 50 to include the new helpers:

```ts
import {
  // ...existing imports...
  visibleAttachmentSlots,
  filterStateToSlots,
} from '@/components/application/attachmentsState'
```

2. After `attachmentSlots` is defined (line 217-219), add:

```ts
  const leaveType = form.watch('leave_type') as string | undefined
  const visibleSlots = useMemo(
    () => visibleAttachmentSlots(attachmentSlots, leaveType),
    [attachmentSlots, leaveType],
  )
```

(`form` is defined at line 251 — move these two lines to just **after** the `form = useForm(...)` block so `form.watch` is in scope; keep them before `buildPayload`.)

3. In `buildPayload` (line 368), change:

```ts
    const attachmentSpecs = toGenerateSpecs(attachmentsState)
```

to:

```ts
    const attachmentSpecs = toGenerateSpecs(filterStateToSlots(attachmentsState, visibleSlots))
```

and add `visibleSlots` to that callback's dependency array.

4. At the `<AttachmentsBlock>` usage (line ~803-805), change `slots={attachmentSlots}` to `slots={visibleSlots}`. Also update the required-slot check at line 234 to use `visibleSlots`:

```ts
  const missingSlotKeys = missingRequired(visibleSlots, attachmentsState)
```

(so a hidden required slot — none today, but future-proof — can't block Save).

- [ ] **Step 6: Typecheck + run all frontend tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Manual verification**

Start the app (see repo `run`/deploy skill). On the Services form page:
- Select **Leave Application Form**, set leave type = **Annual Leave** → the "Medical certificate" slot is **absent**.
- Set leave type = **Sick Leave** → the slot **appears** (optional).
Confirm before committing.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/application/attachmentsState.ts frontend/src/components/application/attachmentsState.test.ts frontend/src/pages/application/ApplicationPage.tsx
git commit -m "feat(application): show medical-certificate slot only for Sick Leave"
```

---

### Task 4: Frontend — auto-carry the OCR scan into the slot

**Files:**
- Modify: `frontend/src/components/application/attachmentsState.ts` (add `seedStagedSlot`)
- Modify: `frontend/src/components/intake/IntakePanel.tsx` (`ExternalCard`: stage the file, pass token in nav state)
- Modify: `frontend/src/pages/application/ApplicationPage.tsx` (consume `injectedAttachment`, seed state)
- Test: `frontend/src/components/application/attachmentsState.test.ts` (extend)

**Interfaces:**
- Produces `seedStagedSlot(state, slotKey, staged): AttachmentsState` where `staged` is `{ token: string; filename: string; size: number }`.
- Router state shape extended: `{ injectedExtraction, injectedAttachment?: { slotKey: string; staged: StagedAttachmentRead } }`.
- Consumes: existing `api.stageAttachment(file)` (returns `StagedAttachmentRead`), `Dropzone.onResult(file, result)` (the intake already retains `file`).

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/application/attachmentsState.test.ts`:

```ts
import { seedStagedSlot } from './attachmentsState'

describe('seedStagedSlot', () => {
  it('sets a staged value on the given slot', () => {
    const out = seedStagedSlot(emptyAttachmentsState(), SICK_ONLY_SLOT_KEY, {
      token: 'tok', filename: 'scan.pdf', size: 42,
    })
    expect(out.slots[SICK_ONLY_SLOT_KEY]).toEqual({
      kind: 'staged', token: 'tok', filename: 'scan.pdf', size: 42,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/application/attachmentsState.test.ts`
Expected: FAIL — `seedStagedSlot` is not exported.

- [ ] **Step 3: Add `seedStagedSlot`**

In `frontend/src/components/application/attachmentsState.ts`, append:

```ts
/** Pre-fill one slot with a staged upload (used to auto-carry an intake scan). */
export function seedStagedSlot(
  state: AttachmentsState,
  slotKey: string,
  staged: { token: string; filename: string; size: number },
): AttachmentsState {
  return {
    ...state,
    slots: {
      ...state.slots,
      [slotKey]: {
        kind: 'staged',
        token: staged.token,
        filename: staged.filename,
        size: staged.size,
      },
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/application/attachmentsState.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage the scan in IntakePanel and pass it in nav state**

In `frontend/src/components/intake/IntakePanel.tsx`:

1. Ensure `StagedAttachmentRead` is importable — add to the `@/lib/api` type import:

```ts
import type { StagedAttachmentRead } from '@/lib/api'
```

2. Add `file` to `ExternalCardProps` (line 316):

```ts
interface ExternalCardProps {
  result: ExternalOut
  file: File
  onDismiss: () => void
}
```

and destructure it: `function ExternalCard({ result, file, onDismiss }: ExternalCardProps)`.

3. Make `handleRoute` async and stage the scan on the `leave` route (lines 341-363). Replace the `leave` branch with:

```ts
    } else if (route_kind === 'leave') {
      const q = matched && id ? `&employee_id=${id}` : ''
      let injectedAttachment:
        | { slotKey: string; staged: StagedAttachmentRead }
        | undefined
      try {
        const stagedRes = await api.stageAttachment(file)
        injectedAttachment = { slotKey: 'medical_certificate', staged: stagedRes }
      } catch {
        // Non-fatal: fall back to manual attach on the form.
      }
      navigate(
        `/application?form=${result.route_form_slug ?? 'leave_application'}${q}`,
        { state: { injectedExtraction: injection, injectedAttachment } },
      )
    }
```

Change the signature line to `async function handleRoute(): Promise<void> {` and update the button `onClick` that calls it to `onClick={() => void handleRoute()}`.

4. At the `<ExternalCard ... />` render (line 503), pass the file:

```tsx
        <ExternalCard result={resultState.result} file={resultState.file} onDismiss={handleDismiss} />
```

(Confirm the state variable name holding the intake result at line ~495-503 — it carries both `file` and `result` from `Dropzone.onResult`; use its `.file`.)

- [ ] **Step 6: Consume `injectedAttachment` in ApplicationPage and seed the slot**

In `frontend/src/pages/application/ApplicationPage.tsx`:

1. Add the `seedStagedSlot` import to the `@/components/application/attachmentsState` import block, and the `StagedAttachmentRead` type import from `@/lib/api`.

2. Next to the `pendingInjection` state (line 104-107), add:

```ts
  const [pendingAttachment, setPendingAttachment] = useState<
    { slotKey: string; staged: StagedAttachmentRead } | undefined
  >(() => {
    const s = location.state as {
      injectedAttachment?: { slotKey: string; staged: StagedAttachmentRead }
    } | null
    return s?.injectedAttachment
  })
```

3. Include it in the history-clear effect condition (line 117):

```ts
    if (pendingInjection || reviseBookId !== null || pendingAttachment) {
```

4. After `schemaReady` is defined (line 467), add an effect that seeds the slot once the schema (and thus the slot) exists:

```ts
  useEffect(() => {
    if (!pendingAttachment || !schemaReady) return
    const hasSlot = (schemaQuery.data?.attachment_slots ?? []).some(
      (s) => s.key === pendingAttachment.slotKey,
    )
    if (!hasSlot) return
    setAttachmentsState((prev) =>
      seedStagedSlot(prev, pendingAttachment.slotKey, pendingAttachment.staged),
    )
    setPendingAttachment(undefined)
  }, [pendingAttachment, schemaReady, schemaQuery.data])
```

Note: the slot only renders when leave type is Sick Leave (Task 3). An OCR-classified sick-leave scan pre-fills `leave_type = "Sick Leave"` via `injectedExtraction`, so the seeded slot is visible. If a user later flips leave type away from Sick Leave, `filterStateToSlots` (Task 3) drops the value from the payload — no annual leave merges a medical cert.

- [ ] **Step 7: Typecheck + all frontend tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Manual E2E verification**

Start the app. In the Scan Inbox / intake dropzone, scan a sick-leave report:
- It classifies as sick leave and routes to the Leave Application Form, pre-filled with leave type **Sick Leave**.
- The **Medical certificate** slot shows the scan already attached (staged filename).
- Generate → download the resulting PDF and confirm the medical scan page is appended, and the file is named `G<number>.pdf`.
Confirm before committing.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/application/attachmentsState.ts frontend/src/components/application/attachmentsState.test.ts frontend/src/components/intake/IntakePanel.tsx frontend/src/pages/application/ApplicationPage.tsx
git commit -m "feat(intake): auto-carry OCR sick-leave scan into the form's medical slot"
```

---

## Self-Review

**Spec coverage:**
- Merge OCR scan into sick-leave form at generation → Task 1 (slot) + existing pipeline; auto-carry → Task 4. ✓
- Slot shown only for Sick Leave → Task 3. ✓
- Export sick leave = G-number only → Task 2. ✓
- Every other document = G-number + Arabic name; no-employee fallback to ref; blank-Arabic fallback to template → Task 2 helper + tests. ✓
- Keep Arabic, strip unsafe chars → Task 2 `_sanitize` + test. ✓
- DOCX mirrors base name → Task 2 (`ext` param) + test. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Two "confirm the exact name/type" notes point at specific lines the implementer must read (`AttachmentsState['slots']` type; the intake result state variable) — these are verification cues, not missing content.

**Type consistency:** `SICK_ONLY_SLOT_KEY`, `visibleAttachmentSlots`, `filterStateToSlots`, `seedStagedSlot`, `export_filename`, `download_filename_for` are used with identical signatures across tasks. Router state shape `{ injectedExtraction, injectedAttachment }` matches between producer (Task 4 IntakePanel) and consumer (Task 4 ApplicationPage). Backend `export_filename` keyword args match between `test_export_naming.py`, `download_filename_for`, and the module.

## Notes / risks for the implementer
- Confirm `Leave`/`Document`/`Employee` constructors in `test_download_filename.py` satisfy all non-nullable columns for the current schema (check `backend/app/db/models.py`); add minimal required fields if a NOT NULL constraint fails.
- Arabic in `Content-Disposition` is handled by Starlette's `FileResponse` via RFC 5987 `filename*`; verify the downloaded name renders correctly in Chrome/Edge during Task 2 manual check.
- Do not push to `origin/main` unless the user asks (live-main repo).
