# Permit Validity, Visitor Job, and Word Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required job/trade to every new permit visitor, replace user-entered permit end dates with preset or custom validity periods, and expose safe versioned Word editing while retaining the current PDF-generation behavior.

**Architecture:** Keep `permits.end_date` as an internal, indexed expiry boundary, but never ask operators to enter it. Persist the operator's validity value/unit, calculate the inclusive end date in one backend helper, and expose a structured `validity` object in the API. Reuse the existing `PermitPerson.role` field for job/trade and the existing `BookVersion`/`Document`/WebDAV Word-session system for editable DOCX copies; do not create parallel visitor or document stores.

**Tech Stack:** FastAPI, Pydantic 2, SQLAlchemy 2, Alembic/SQLite, React 19, TypeScript, React Query, Vitest, pytest, Microsoft Word WebDAV/COM.

## Global Constraints

- Work only in an isolated Git worktree; never modify or deploy from the live production checkout.
- Approved duration choices are exactly: `1 day`, `1 week`, `1 month`, `6 months`, `1 year`, then `Custom period`. There is no `3 months` preset.
- Custom period supports a positive integer plus one unit: `day`, `week`, `month`, or `year`.
- `work_residence` remains one global boolean access option, visually separate from the per-location Al Wathba 1/2 Green/Red cards. Never assign or duplicate Work residence by location.
- Preserve every existing permit capability not explicitly replaced by this plan: vehicle rows and all vehicle fields, vehicle-licence scanning, visitor ID scanning, permit-paper upload/replace/remove, purpose, notes, signing manager, send-for-approval/draft routing, access-area behavior, lifecycle actions, filters, register selection, and print.
- `end_date` remains stored and returned for lifecycle calculations, expiry indexes, and compatibility, but is removed from create/update/renew request bodies and from operator-facing permit layouts.
- Permit validity is inclusive: `1 day` starting on 2026-08-06 ends internally on 2026-08-06; `1 week` ends on 2026-08-12; `1 month` uses a calendar-month boundary and stores the prior day as the inclusive end.
- Renewal starts a new current validity window: the day after the current end when still active, or today when already expired. The prior window remains recoverable from audit/document versions.
- New visitors require full name, UAE ID, and job/trade. Existing rows with a null `role` remain readable and render a blank job cell until amended/replaced.
- Continue using the API/storage name `role`; UI and document copy call it `Job / trade` / `المهنة`. Do not add a duplicate `job` column.
- Every finished Word edit creates a new `BookVersion` and `Document`; prior DOCX/PDF files remain unchanged and downloadable.
- Structured permit changes after a finished Word edit must append a generated version rather than overwrite the Word-authored version.
- PDF conversion remains the existing lenient Word COM flow: store the DOCX even when PDF conversion returns `None`; expose the latest PDF when available.
- Word editing is desktop-only and uses the existing `books.manage` capability and authenticated WebDAV handoff. Mobile shows the existing “requires a PC with Word” hint.
- Arabic and English are peers; use logical CSS properties and verify desktop EN plus 375–390 px AR/RTL.
- Do not add dependencies. Use Python standard-library calendar/date operations.
- After schema changes, run the `new-migration`, `sync-api-types`, `alembic-migration-reviewer`, and `i18n-rtl-reviewer` project workflows as applicable.

## Design Decisions and Rejected Alternatives

1. **Persist value/unit and derive end date — selected.** It preserves whether an operator chose “2 months” instead of an equivalent day count and keeps existing expiry queries unchanged.
2. **UI-only duration with only `end_date` persisted — rejected.** Custom periods could not round-trip reliably into edit/renew forms or document wording.
3. **Remove `end_date` from the database — rejected.** Expired/expiring status and `ix_permits_status_end` already depend on it; calculating it in every query adds risk without user value.
4. **Reuse `PermitPerson.role` — selected.** The field, API contract, print surface, and detail summary already exist; only data entry and generated-letter rendering are missing.
5. **Reuse Book Word versions — selected.** `BookVersion`, `Document`, `BookEditSession`, WebDAV, DOCX download, and PDF conversion already satisfy copy/version requirements.
6. **Store a separate editable permit DOCX — rejected.** It would duplicate version history, permissions, Word handoff, and PDF conversion.

## File Map

### Create

- `backend/app/core/permit_validity.py` — single source of truth for value/unit validation, inclusive end-date calculation, and Arabic/English period labels.
- `backend/app/db/migrations/versions/0067_permit_validity_period.py` — SQLite-safe backfill of validity value/unit.
- `backend/tests/test_permit_validity.py` — date arithmetic and label boundary tests.
- `backend/tests/test_migration_permit_validity_period.py` — upgrade/downgrade and populated-row preservation.
- `frontend/src/pages/permits/PermitDocumentVersions.tsx` — compact permit document actions/version list using existing Book APIs and `BookWordActions`.
- `frontend/src/pages/permits/PermitDocumentVersions.test.tsx` — version/history/Word action behavior.

### Modify

- `backend/app/db/models.py` — add `Permit.validity_value` and `Permit.validity_unit`; keep internal `end_date` and its index.
- `backend/app/schemas/permit.py` — add `PermitValidityPeriod`; replace write-side `end_date`/`new_end_date` with `validity`; require visitor `role` on create.
- `backend/app/services/permit_service.py` — calculate/persist validity, renew current windows, enrich read responses, and preserve finished Word versions during structured regeneration.
- `backend/app/core/permit_letter.py` — show period + start date without an end date and add job/trade to the visitor table.
- `backend/app/api/v1/permits.py` — route updated renew schema through the service; no new document store or raw file route.
- `backend/tests/test_permit_schemas.py` — request validation and obsolete end-date rejection.
- `backend/tests/test_permits_service.py` — create/update/renew persistence and expiry behavior.
- `backend/tests/test_permit_letter.py` — period wording and five-column visitor table.
- `backend/tests/test_permit_book_generation.py` — Word-authored version preservation and PDF/version continuity.
- `backend/openapi.json` — regenerated FastAPI contract.
- `frontend/src/lib/api.types.ts` — regenerated TypeScript contract.
- `frontend/src/lib/api.ts` — only aliases/helpers required by the generated validity contract; continue using existing Book/Word methods.
- `frontend/src/pages/permits/PermitFormDialog.tsx` — preset/custom validity selector and required visitor job input; remove end-date input.
- `frontend/src/pages/permits/PermitFormDialog.test.tsx` — exact payloads, custom control, job validation, edit round-trip.
- `frontend/src/pages/permits/PermitDetailDialog.tsx` — validity facts, duration-based renewal, job add field, and document-version component.
- `frontend/src/pages/permits/PermitDetailDialog.test.tsx` — renewal payload, job payload, Word/version surface.
- `frontend/src/pages/permits/PermitsPage.tsx` — replace visible start→end ranges with start + period while retaining remaining-day/expired status.
- `frontend/src/pages/permits/PermitsPage.test.tsx` — register and print wording without visible end date.
- `frontend/src/locales/en.json` — validity, custom unit, job, Word-copy, and renewal labels.
- `frontend/src/locales/ar.json` — exact Arabic peers.
- `frontend/src/locales/permits.i18n.test.ts` — EN/AR parity for every new key.

---

### Task 1: Validity Domain, Persistence, and Migration

**Files:**
- Create: `backend/app/core/permit_validity.py`
- Create: `backend/app/db/migrations/versions/0067_permit_validity_period.py`
- Create: `backend/tests/test_permit_validity.py`
- Create: `backend/tests/test_migration_permit_validity_period.py`
- Modify: `backend/app/db/models.py:430-493`
- Modify: `backend/app/schemas/permit.py:1-193`
- Test: `backend/tests/test_permit_schemas.py`

**Interfaces:**
- Produces: `PermitValidityUnit = Literal["day", "week", "month", "year"]`.
- Produces: `PermitValidityPeriod(value: int, unit: PermitValidityUnit)`.
- Produces: `period_end(start: date, value: int, unit: str) -> date`.
- Produces: `period_label(value: int, unit: str, lang: Literal["en", "ar"]) -> str`.
- Persists: `Permit.validity_value: int` and `Permit.validity_unit: str`.

- [ ] **Step 1: Add failing validity arithmetic tests**

```python
from datetime import date

from app.core.permit_validity import period_end, period_label


def test_period_end_is_inclusive() -> None:
    start = date(2026, 8, 6)
    assert period_end(start, 1, "day") == date(2026, 8, 6)
    assert period_end(start, 1, "week") == date(2026, 8, 12)
    assert period_end(start, 1, "month") == date(2026, 9, 5)
    assert period_end(start, 6, "month") == date(2027, 2, 5)
    assert period_end(start, 1, "year") == date(2027, 8, 5)


def test_period_labels_preserve_custom_unit() -> None:
    assert period_label(2, "month", "en") == "2 months"
    assert period_label(2, "month", "ar") == "شهران"
```

- [ ] **Step 2: Run validity tests and confirm RED**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_permit_validity.py -q
```

Expected: collection fails because `app.core.permit_validity` does not exist.

- [ ] **Step 3: Implement standard-library period calculation**

```python
from calendar import monthrange
from datetime import date, timedelta
from typing import Literal

PermitValidityUnit = Literal["day", "week", "month", "year"]
_MAX_BY_UNIT = {"day": 3650, "week": 520, "month": 120, "year": 10}


def validate_period(value: int, unit: str) -> None:
    if unit not in _MAX_BY_UNIT or not 1 <= value <= _MAX_BY_UNIT[unit]:
        raise ValueError("invalid permit validity period")


def _shift_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    return date(year, month, min(value.day, monthrange(year, month)[1]))


def period_end(start: date, value: int, unit: str) -> date:
    validate_period(value, unit)
    if unit == "day":
        boundary = start + timedelta(days=value)
    elif unit == "week":
        boundary = start + timedelta(weeks=value)
    else:
        boundary = _shift_months(start, value * (12 if unit == "year" else 1))
    return max(start, boundary - timedelta(days=1))
```

Add explicit labels rather than composing Arabic grammar from translated fragments:

```python
_AR_PERIODS = {
    "day": ("يوم واحد", "يومان", "أيام", "يوماً"),
    "week": ("أسبوع واحد", "أسبوعان", "أسابيع", "أسبوعاً"),
    "month": ("شهر واحد", "شهران", "أشهر", "شهراً"),
    "year": ("سنة واحدة", "سنتان", "سنوات", "سنة"),
}


def period_label(value: int, unit: str, lang: Literal["en", "ar"]) -> str:
    validate_period(value, unit)
    if lang == "en":
        return f"{value} {unit if value == 1 else unit + 's'}"
    one, two, few, many = _AR_PERIODS[unit]
    if value == 1:
        return one
    if value == 2:
        return two
    return f"{value} {few if 3 <= value <= 10 else many}"
```

- [ ] **Step 4: Add failing schema contract tests**

```python
from pydantic import ValidationError


def test_create_requires_validity_and_rejects_end_date() -> None:
    with pytest.raises(ValidationError):
        PermitCreate.model_validate({**BASE_CREATE, "end_date": "2026-09-01"})


def test_custom_validity_bounds_are_unit_specific() -> None:
    assert PermitValidityPeriod(value=2, unit="month").value == 2
    with pytest.raises(ValidationError):
        PermitValidityPeriod(value=11, unit="year")
```

- [ ] **Step 5: Change Pydantic write/read contracts**

```python
class PermitValidityPeriod(BaseModel):
    value: int
    unit: PermitValidityUnit

    @model_validator(mode="after")
    def _validate_bounds(self) -> PermitValidityPeriod:
        validate_period(self.value, self.unit)
        return self


class PermitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_date: date
    validity: PermitValidityPeriod


class PermitUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_date: date | None = None
    validity: PermitValidityPeriod | None = None


class PermitRenew(BaseModel):
    model_config = ConfigDict(extra="forbid")
    validity: PermitValidityPeriod
    reason: str | None = None
```

Add required `validity: PermitValidityPeriod` to `PermitRead` and `PermitListItem`. Keep `end_date` read-only in both responses. Remove write-side `end_date` and `new_end_date` completely so stale clients receive HTTP 422 instead of a silent no-op.

- [ ] **Step 6: Add model columns and migration RED test**

Add:

```python
validity_value: Mapped[int] = mapped_column(Integer)
validity_unit: Mapped[str] = mapped_column(String(8))
```

The migration test must upgrade a database containing a permit with `start_date=2026-01-01`, `end_date=2026-01-05`, then assert `validity_value == 5`, `validity_unit == "day"`, and the original dates/zones/access areas remain unchanged.

- [ ] **Step 7: Implement SQLite-safe migration `0067`**

Use `down_revision = "0066"`. Inside `batch_alter_table("permits")`, add nullable columns; backfill with:

```sql
UPDATE permits
SET validity_value = CAST(julianday(end_date) - julianday(start_date) + 1 AS INTEGER),
    validity_unit = 'day'
```

Then use a second `batch_alter_table` to make both columns non-null and add a check constraint limiting `validity_unit` to `day|week|month|year`. Downgrade removes the constraint and both columns while preserving `start_date`/`end_date`.

- [ ] **Step 8: Run focused domain and migration tests**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_permit_validity.py backend/tests/test_permit_schemas.py backend/tests/test_migration_permit_validity_period.py -q
venv\Scripts\alembic.exe heads
```

Expected: all tests pass and exactly `0067 (head)`.

- [ ] **Step 9: Commit Task 1**

```powershell
git add backend/app/core/permit_validity.py backend/app/db/models.py backend/app/schemas/permit.py backend/app/db/migrations/versions/0067_permit_validity_period.py backend/tests/test_permit_validity.py backend/tests/test_permit_schemas.py backend/tests/test_migration_permit_validity_period.py
git commit -m "feat(permits): model preset and custom validity"
```

### Task 2: Permit Service Calculation, Update, and Renewal

**Files:**
- Modify: `backend/app/services/permit_service.py`
- Modify: `backend/app/api/v1/permits.py:180-205`
- Test: `backend/tests/test_permits_service.py`
- Test: `backend/tests/test_permit_approval_flow.py`

**Interfaces:**
- Consumes: `PermitValidityPeriod`, `period_end`.
- Produces: every created/updated/renewed permit has synchronized `start_date`, `validity_value`, `validity_unit`, and internal `end_date`.

- [ ] **Step 1: Write failing create/update persistence tests**

```python
def test_create_persists_validity_and_derives_end(db_session) -> None:
    row = svc.create_permit(db_session, _payload(validity={"value": 1, "unit": "month"}))
    assert row.validity_value == 1
    assert row.validity_unit == "month"
    assert row.end_date == date(2026, 7, 31)  # start 2026-07-01, inclusive month


def test_update_start_or_validity_recomputes_end(db_session) -> None:
    row = svc.update_permit(
        db_session,
        permit_id,
        PermitUpdate(start_date=date(2026, 8, 6), validity={"value": 6, "unit": "month"}),
    )
    assert row.end_date == date(2027, 2, 5)
```

- [ ] **Step 2: Run service tests and confirm RED**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_permits_service.py -q
```

Expected: failures because the service still reads payload `end_date`.

- [ ] **Step 3: Implement one synchronization helper**

```python
def _set_validity(row: Permit, *, start: date, validity: PermitValidityPeriod) -> None:
    row.start_date = start
    row.validity_value = validity.value
    row.validity_unit = validity.unit
    row.end_date = period_end(start, validity.value, validity.unit)
```

Create calls it once before flush. Update merges the current start/validity with supplied fields and calls it only when `start_date` or `validity` was supplied. Audit fields list `validity` and/or `start_date`, never client-supplied `end_date`.

- [ ] **Step 4: Write failing renewal-window tests**

```python
def test_renew_active_starts_after_current_end(db_session, monkeypatch) -> None:
    row = _permit(start=date(2026, 8, 1), end=date(2026, 8, 31))
    renewed = svc.renew_permit(
        db_session, row.id, validity=PermitValidityPeriod(value=1, unit="month")
    )
    assert renewed.start_date == date(2026, 9, 1)
    assert renewed.end_date == date(2026, 9, 30)


def test_renew_expired_starts_today(db_session, monkeypatch) -> None:
    monkeypatch.setattr(permit_service, "_today", lambda: date(2026, 8, 6))
    row = _permit(start=date(2026, 1, 1), end=date(2026, 1, 31))
    renewed = svc.renew_permit(
        db_session, row.id, validity=PermitValidityPeriod(value=1, unit="week")
    )
    assert renewed.start_date == date(2026, 8, 6)
    assert renewed.end_date == date(2026, 8, 12)
```

- [ ] **Step 5: Implement duration-based renewal**

Use:

```python
renewal_start = max(_today(), row.end_date + timedelta(days=1))
_set_validity(row, start=renewal_start, validity=validity)
```

Keep revoked/deleted guards, audit reason, document regeneration, and approval invalidation behavior unchanged.

- [ ] **Step 6: Enrich read responses with structured validity**

Both detailed and list responses return:

```python
"validity": {"value": row.validity_value, "unit": row.validity_unit}
```

Continue deriving `duration_days`, `days_remaining`, `derived_status`, and expired/expiring filters from internal `end_date` exactly as before.

- [ ] **Step 7: Run service and approval tests**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_permits_service.py backend/tests/test_permit_approval_flow.py backend/tests/test_permit_manager_signature.py -q
```

Expected: all pass; renewal regenerates the Book and retains approval safety.

- [ ] **Step 8: Commit Task 2**

```powershell
git add backend/app/services/permit_service.py backend/app/api/v1/permits.py backend/tests/test_permits_service.py backend/tests/test_permit_approval_flow.py
git commit -m "feat(permits): calculate validity and renew by period"
```

### Task 3: Required Visitor Job and Permit Letter Output

**Files:**
- Modify: `backend/app/schemas/permit.py:48-78`
- Modify: `backend/app/core/permit_letter.py:93-208`
- Modify: `backend/app/services/permit_service.py:350-428`
- Test: `backend/tests/test_permit_schemas.py`
- Test: `backend/tests/test_permit_letter.py`
- Test: `backend/tests/test_permit_book_generation.py`

**Interfaces:**
- Consumes: existing `PermitPerson.role` storage/API name.
- Consumes: `period_label` and persisted permit validity.
- Produces: a five-column visitor table: number, name, UAE ID, nationality, job/trade.

- [ ] **Step 1: Add RED tests for required job and table output**

```python
def test_new_visitor_requires_job() -> None:
    with pytest.raises(ValidationError):
        PermitPersonCreate(name="Ali", uae_id="784-1", nationality="UAE")


def test_letter_renders_job_and_no_end_date() -> None:
    html = build_permit_letter_html(
        company="ACME",
        start_date=date(2026, 8, 6),
        validity_value=2,
        validity_unit="month",
        people=[{"name": "Ali", "uae_id": "784-1", "nationality": "UAE", "role": "Electrician"}],
        vehicles=[],
        access_areas=ACCESS,
        zones=["green"],
    )
    assert "المهنة" in html
    assert "Electrician" in html
    assert "شهران" in html
    assert "06/10/2026" not in html
```

- [ ] **Step 2: Run schema/letter tests and confirm RED**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_permit_schemas.py backend/tests/test_permit_letter.py -q
```

- [ ] **Step 3: Require and normalize `role` for new visitors**

```python
role: str = Field(min_length=1, max_length=128)

@field_validator("role")
@classmethod
def _strip_role(cls, value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("role is required")
    return value
```

Keep `PermitPersonRead.role: str | None` because migration must not invent jobs for existing people.

- [ ] **Step 4: Add job/trade to generated table**

Change the person header to `colspan="5"` and columns to:

```html
<th>م</th><th>الاسم</th><th>رقم الهوية</th><th>الجنسية</th><th>المهنة</th>
```

Append escaped `p.get("role") or ""` to every row.

- [ ] **Step 5: Replace letter end-date wording with period wording**

Change `build_permit_letter_html` to accept `validity_value`/`validity_unit` instead of `end_date`. Render:

```python
validity_val = f"{period_label(validity_value, validity_unit, 'ar')} اعتباراً من {_fmt(start_date)}"
```

Update `regenerate_permit_book` to pass persisted validity fields. Keep the generated PDF call and Book reference behavior unchanged.

- [ ] **Step 6: Prove the generated Book body contains job and period**

Extend `test_generated_book_body_preserves_location_zone_pairings` or add a focused sibling asserting captured `fields["body"]` contains `Electrician`, `المهنة`, and the Arabic period label, and does not contain the calculated end date.

- [ ] **Step 7: Run document-focused tests**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_permit_schemas.py backend/tests/test_permit_letter.py backend/tests/test_permit_book_generation.py -q
```

- [ ] **Step 8: Commit Task 3**

```powershell
git add backend/app/schemas/permit.py backend/app/core/permit_letter.py backend/app/services/permit_service.py backend/tests/test_permit_schemas.py backend/tests/test_permit_letter.py backend/tests/test_permit_book_generation.py
git commit -m "feat(permits): add visitor job and validity to letter"
```

### Task 4: Generated Contract and Permit Form

**Files:**
- Modify: `backend/openapi.json`
- Modify: `frontend/src/lib/api.types.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/permits/PermitFormDialog.tsx`
- Modify: `frontend/src/pages/permits/PermitFormDialog.test.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`
- Modify: `frontend/src/locales/permits.i18n.test.ts`

**Interfaces:**
- Consumes generated `PermitValidityPeriod`.
- Produces exact form payload `{ start_date, validity: { value, unit }, people[].role }` with no `end_date`.

- [ ] **Step 1: Regenerate OpenAPI and TypeScript contracts**

Run the project `sync-api-types` workflow. Confirm generated create/update/renew request schemas do not accept `end_date`/`new_end_date`; read schemas still expose internal `end_date` plus `validity`.

- [ ] **Step 2: Add RED tests for preset and job payload**

```typescript
await userEvent.type(screen.getByLabelText(/job \/ trade/i), 'Electrician')
await userEvent.click(screen.getByRole('button', { name: /6 months/i }))
await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))

expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
  start_date: expect.any(String),
  validity: { value: 6, unit: 'month' },
  people: [expect.objectContaining({ uae_id: expect.any(String), role: 'Electrician' })],
}))
expect(createSpy.mock.calls[0][0]).not.toHaveProperty('end_date')
```

- [ ] **Step 3: Add RED custom-period interaction test**

```typescript
await userEvent.click(screen.getByRole('button', { name: /custom period/i }))
await userEvent.clear(screen.getByLabelText(/duration/i))
await userEvent.type(screen.getByLabelText(/duration/i), '2')
await userEvent.selectOptions(screen.getByLabelText(/unit/i), 'month')
expect(screen.getByRole('button', { name: /issue permit/i })).toBeEnabled()
```

Assert the preset order is exactly `1 day`, `1 week`, `1 month`, `6 months`, `1 year`, `Custom period`; assert no `3 months` button exists.

- [ ] **Step 4: Implement form state and controls**

Use one state object:

```typescript
type Validity = { value: number; unit: 'day' | 'week' | 'month' | 'year' }
const [validity, setValidity] = useState<Validity>({ value: 1, unit: 'month' })
const [customOpen, setCustomOpen] = useState(false)
```

Preset buttons write the exact value/unit and close custom fields. `Custom period` reveals a positive integer input and unit select after the `1 year` button. Remove `endDate`, `windowValid`, the end-date input, and all write payload properties named `end_date`.

- [ ] **Step 5: Add required job input to every new-person row**

Change desktop grid to include `role`; use visible labels on mobile rather than relying only on placeholders. `peopleComplete` requires nonblank name, UAE ID, and role. Submit `role: p.role.trim()`.

- [ ] **Step 6: Add exact EN/AR peer strings**

Add keys for `permitValidity`, every preset, `customPeriod`, `durationValue`, `durationUnit`, the four unit forms, `jobRequired`, and revised help text. Rename visible `permits.person.role` copy to `Job / trade` in English and `المهنة` in Arabic while retaining the key/API field.

- [ ] **Step 7: Run focused form and locale tests**

```powershell
pnpm -C frontend exec vitest run src/pages/permits/PermitFormDialog.test.tsx src/locales/permits.i18n.test.ts
pnpm -C frontend exec tsc -b --noEmit
```

- [ ] **Step 8: Commit Task 4**

```powershell
git add backend/openapi.json frontend/src/lib/api.types.ts frontend/src/lib/api.ts frontend/src/pages/permits/PermitFormDialog.tsx frontend/src/pages/permits/PermitFormDialog.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/locales/permits.i18n.test.ts
git commit -m "feat(permits): select preset or custom validity"
```

### Task 5: Detail, Renewal, Register, and Print Surfaces

**Files:**
- Modify: `frontend/src/pages/permits/PermitDetailDialog.tsx`
- Modify: `frontend/src/pages/permits/PermitDetailDialog.test.tsx`
- Modify: `frontend/src/pages/permits/PermitsPage.tsx`
- Modify: `frontend/src/pages/permits/PermitsPage.test.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: `PermitRead.validity` and duration-based `PermitRenew`.
- Produces: no visible editable or formatted end date; status still uses server-derived days remaining.

- [ ] **Step 1: Add RED detail/renew tests**

Assert detail renders `1 month` and `Starts 06 Aug 2026`, does not render `06 Sep 2026` as an end date, and renew submits:

```typescript
expect(renewSpy).toHaveBeenCalledWith(42, {
  validity: { value: 2, unit: 'month' },
  reason: 'Extended works',
})
```

- [ ] **Step 2: Add job to add-person panel**

Add `personRole` state/input, require it with name/UAE ID, submit it through the existing add-person endpoint, reset it on success, and keep legacy list rows rendering blank role safely.

- [ ] **Step 3: Replace renew end-date picker with the shared visual pattern**

Render the same five presets plus `Custom period`; do not duplicate date arithmetic in TypeScript. The backend response supplies the new internal end and derived status after renewal.

- [ ] **Step 4: Replace visible ranges in detail/register/print**

Use copy shaped as:

- Detail: `Starts 06 Aug 2026` + `Permit time: 1 month`.
- Register: `1 month from 06 Aug 2026` + existing `24 days left`/`Expired` text.
- Print header: start date and period; no visible end date.

Keep filtering/sorting/status calculations server-driven from internal `end_date`.

- [ ] **Step 5: Run focused surface tests**

```powershell
pnpm -C frontend exec vitest run src/pages/permits/PermitDetailDialog.test.tsx src/pages/permits/PermitsPage.test.tsx src/locales/permits.i18n.test.ts
```

- [ ] **Step 6: Commit Task 5**

```powershell
git add frontend/src/pages/permits/PermitDetailDialog.tsx frontend/src/pages/permits/PermitDetailDialog.test.tsx frontend/src/pages/permits/PermitsPage.tsx frontend/src/pages/permits/PermitsPage.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(permits): show validity periods across surfaces"
```

### Task 6: Versioned Word Editing from Permit Detail

**Files:**
- Create: `frontend/src/pages/permits/PermitDocumentVersions.tsx`
- Create: `frontend/src/pages/permits/PermitDocumentVersions.test.tsx`
- Modify: `frontend/src/pages/permits/PermitDetailDialog.tsx`
- Modify: `backend/app/services/permit_service.py:350-428`
- Modify: `backend/tests/test_permit_book_generation.py`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: `permit.book_id`, `api.getBook`, existing `BookWordActions`, `WordHandoffDialog`, `BookVersionRead.docx_url`, `pdf_url`, and `signed_pdf_url`.
- Produces: desktop “Edit in Word” and ordered DOCX/PDF version history; mobile read/download history with disabled Word-edit hint.

- [ ] **Step 1: Add RED component tests**

Cover:

1. Versions render newest first as `v3`, `v2`, `v1`.
2. Unsigned versions expose `docx_url` and `pdf_url`.
3. Signed versions prefer `signed_pdf_url` while retaining DOCX history according to existing Book policy.
4. A user with `books.manage` sees existing Word actions.
5. Mobile receives `isMobile=true`, so Word edit is disabled with the PC hint.
6. No Book query/action occurs when `permit.book_id` is null.

- [ ] **Step 2: Implement focused permit document component**

```tsx
export function PermitDocumentVersions({ bookId }: { bookId: number }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const isMobile = useIsMobile()
  const { data: book, isLoading } = useQuery({
    queryKey: ['books', 'permit', bookId],
    queryFn: () => api.getBook(bookId),
  })
  if (isLoading) return <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
  if (!book) return null

  const versions = [...(book.versions ?? [])].sort((a, b) => b.version_no - a.version_no)
  return (
    <section aria-label={t('permits.documentVersions.title')} className="flex flex-col gap-3">
      {has('books.manage') && <BookWordActions book={book} isMobile={isMobile} />}
      <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {versions.map((version) => {
          const pdfUrl = version.signed_pdf_url ?? version.pdf_url
          return (
            <li key={version.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="font-mono text-xs">v{version.version_no}</span>
              <span className="flex items-center gap-2">
                {version.docx_url && <a href={version.docx_url}>{t('permits.documentVersions.docx')}</a>}
                {pdfUrl && <a href={pdfUrl} target="_blank" rel="noopener noreferrer">{t('permits.documentVersions.pdf')}</a>}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
```

Use existing button/link tokens, `target="_blank"`, `rel="noopener noreferrer"`, logical margins, and visible focus rings. Do not implement a second Word handoff dialog.

- [ ] **Step 3: Mount it in permit detail**

Place the component in the generated permit-document section, separate from the optional uploaded paper scan. Keep `openBookPdf` behavior or route it through the already-fetched latest version without changing which PDF is canonical.

- [ ] **Step 4: Add RED backend preservation test**

Create a permit Book whose latest finished Word version has `fields == {}` and a stable DOCX/PDF `Document`. Trigger a structured visitor/header change. Assert the prior `BookVersion` and its `Document` paths remain unchanged and a later generated version is appended.

- [ ] **Step 5: Preserve Word-authored versions during regeneration**

Before `generate_document`, force the established append branch only for a completed Word-authored draft:

```python
if permit.book_id is not None:
    book = db.get(Book, permit.book_id)
    latest = book.versions[-1] if book is not None and book.versions else None
    if (
        book is not None
        and book.approval_state == "none"
        and latest is not None
        and latest.document_id is not None
        and latest.fields == {}
    ):
        book.approval_state = "returned"
        db.flush()
```

`document_service.generate_document` appends when approval state is not `none`, then resets the new version to draft. Do not copy or unlink files manually; the existing document service continues to own ref allocation, DOCX rendering, PDF conversion, `Document` persistence, and superseded-draft cleanup.

- [ ] **Step 6: Verify current PDF behavior**

Extend the test to stub `convert_docx_to_pdf` twice:

- success: latest version receives `pdf_url` and older version remains;
- failure returning `None`: latest DOCX/version commits with `pdf_url is None`, older PDF remains downloadable.

- [ ] **Step 7: Run Word/version checks**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_permit_book_generation.py -q
pnpm -C frontend exec vitest run src/pages/permits/PermitDocumentVersions.test.tsx src/pages/permits/PermitDetailDialog.test.tsx
```

- [ ] **Step 8: Commit Task 6**

```powershell
git add backend/app/services/permit_service.py backend/tests/test_permit_book_generation.py frontend/src/pages/permits/PermitDocumentVersions.tsx frontend/src/pages/permits/PermitDocumentVersions.test.tsx frontend/src/pages/permits/PermitDetailDialog.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(permits): expose versioned Word editing"
```

### Task 7: Cross-Stack Verification and Required Reviews

**Files:**
- Modify only files named by concrete reviewer findings.

**Interfaces:**
- Verifies all prior task contracts together.

- [ ] **Step 1: Run migration safety and one-head review**

```powershell
venv\Scripts\alembic.exe upgrade head
venv\Scripts\alembic.exe downgrade 0066
venv\Scripts\alembic.exe upgrade head
venv\Scripts\alembic.exe heads
```

Expected: reversible round trip; exactly `0067 (head)`; existing permit dates/access/zones retained and validity backfilled.

- [ ] **Step 2: Run focused backend suite**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_permit_validity.py backend/tests/test_migration_permit_validity_period.py backend/tests/test_permit_schemas.py backend/tests/test_permits_service.py backend/tests/test_permit_letter.py backend/tests/test_permit_book_generation.py backend/tests/test_permit_approval_flow.py backend/tests/test_permit_manager_signature.py -q
venv\Scripts\ruff.exe check backend/app/core/permit_validity.py backend/app/schemas/permit.py backend/app/services/permit_service.py backend/app/core/permit_letter.py backend/app/db/models.py backend/app/db/migrations/versions/0067_permit_validity_period.py backend/tests/test_permit_validity.py backend/tests/test_migration_permit_validity_period.py backend/tests/test_permit_schemas.py backend/tests/test_permits_service.py backend/tests/test_permit_letter.py backend/tests/test_permit_book_generation.py
venv\Scripts\mypy.exe backend/app/core/permit_validity.py backend/app/schemas/permit.py
```

- [ ] **Step 3: Run focused frontend suite**

```powershell
pnpm -C frontend exec vitest run src/pages/permits/PermitFormDialog.test.tsx src/pages/permits/PermitDetailDialog.test.tsx src/pages/permits/PermitDocumentVersions.test.tsx src/pages/permits/PermitsPage.test.tsx src/locales/permits.i18n.test.ts
pnpm -C frontend exec eslint src/lib/api.ts src/pages/permits/PermitFormDialog.tsx src/pages/permits/PermitDetailDialog.tsx src/pages/permits/PermitDocumentVersions.tsx src/pages/permits/PermitsPage.tsx src/locales/permits.i18n.test.ts
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
```

- [ ] **Step 4: Smoke the real UI in English desktop**

Issue a permit with Al Wathba 1 Green, Al Wathba 2 Red, `Custom period = 2 months`, and one visitor with UAE ID/job. Intercept POST and assert:

```json
{
  "start_date": "2026-08-06",
  "validity": { "value": 2, "unit": "month" },
  "people": [{ "uae_id": "784-1990-1234567-1", "role": "Electrician" }]
}
```

Assert no `end_date` key is sent.

- [ ] **Step 5: Smoke Arabic mobile/RTL**

At 375–390 px, verify the five presets plus Custom order, custom value/unit controls, visible per-visitor labels, no horizontal overflow, logical focus order, and desktop-only Word edit disabled with the existing PC hint.

- [ ] **Step 6: Smoke generated document and Word versioning**

Generate a permit document with PDF conversion stubbed as the existing suite requires. Inspect captured body for job and period wording with no visible end date. Reopen the latest DOCX in a Word session, finish it, and assert a new version exists while the prior DOCX/PDF paths remain.

- [ ] **Step 7: Run required project reviews**

Run `alembic-migration-reviewer` on `0067` and `i18n-rtl-reviewer` on every changed permit string/layout/document surface. Fix Critical/Important findings, rerun only affected checks, and record any baseline-only failures separately.

- [ ] **Step 8: Final whole-branch review and commit corrections**

Review from the permit-location branch base through HEAD. Confirm visitor job, fixed/custom periods, global Work residence, unchanged vehicle/scan/notes/manager/approval behavior, hidden write-side end date, expiry behavior, renewal semantics, Word copy/version retention, PDF continuity, EN/AR parity, and desktop/mobile behavior. Commit only concrete corrections:

```powershell
git add backend frontend
git commit -m "fix(permits): address validity and Word review findings"
```

Skip this commit when no files changed.

## Acceptance Checklist

- [ ] Visitor rows in create and add-person surfaces include Full name, UAE ID, Nationality, and required Job / trade.
- [ ] Generated visitor table contains UAE ID and Job / trade for every row.
- [ ] Work residence remains a single global option outside both Al Wathba location cards and persists through create/edit unchanged.
- [ ] Vehicles, every existing vehicle field, vehicle/person scans, permit-paper attachments, purpose, notes, signing manager, approval routing, lifecycle actions, filters, selection, and print remain available and behaviorally unchanged.
- [ ] Duration options are exactly 1 day, 1 week, 1 month, 6 months, 1 year, Custom period; 3 months is absent.
- [ ] Custom period accepts value + days/weeks/months/years and round-trips through edit/read.
- [ ] No create/edit/renew request accepts or silently ignores `end_date`/`new_end_date`.
- [ ] No operator-facing permit form, detail, register, print, or generated letter displays an end-date field/range.
- [ ] Internal end date, derived status, days remaining, and expiration indexes remain correct.
- [ ] Renewal creates a new current validity window without inventing or losing prior document history.
- [ ] Edit in Word opens a copy; Finish stores a new DOCX version; old DOCX/PDF versions stay available.
- [ ] Latest PDF behavior remains unchanged, including graceful PDF-conversion failure.
- [ ] English desktop and Arabic mobile/RTL pass with no horizontal overflow or unlabeled visitor inputs.
- [ ] Alembic has exactly one head and the migration is reversible on populated SQLite data.
