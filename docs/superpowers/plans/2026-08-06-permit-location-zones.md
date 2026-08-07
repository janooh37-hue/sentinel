# Permit Location–Zone Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record exact Al Wathba 1/2 Green/Red access pairings on each permit and carry them unchanged into the UI, detailed print, and generated Arabic DOCX/PDF.

**Architecture:** Add nullable structured `access_areas` JSON to `permits` while retaining `zones` as a service-derived union for existing filters, summaries, and honest legacy display. FastAPI/Pydantic owns normalization and validation; the permit service persists both representations transactionally. React uses the structured object for the approved location-card form and all exact-pairing displays, while the letter renderer produces one Arabic line per selected location and an explicit fallback for legacy records.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic/SQLite, React 19, TypeScript 5.9, React Query, Vitest/Testing Library, i18next, Tailwind CSS, Microsoft Word document rendering.

## Global Constraints

- Work only in `C:\Users\Admin\sentinel\.claude\worktrees\permit-locations` on branch `feat/permit-locations`; never modify the live production checkout.
- Use the shared backend environment at `C:\Users\Admin\sentinel\venv\Scripts\`; use `pnpm -C frontend` for frontend commands.
- New permits start with no access selected; at least one exact location-zone pairing or Work residence is required.
- Al Wathba 1 and Al Wathba 2 each allow only `green` and `red`; Work residence remains independent.
- Never infer a location for legacy permits whose `access_areas` is `NULL`.
- Keep `permits.zones` as a derived union, never a client-writeable second source of truth.
- Arabic and English are peers. Use logical CSS properties, written labels plus checkmarks, visible focus states, and verify LTR/RTL at desktop and mobile widths.
- Do not add dependencies, generic location configuration, a location filter, or per-person access.
- Schema changes use `batch_alter_table`; the revision is `0066` over the single current head `0065`.
- After Pydantic changes, regenerate and commit `backend/openapi.json` and `frontend/src/lib/api.types.ts` through `sync-api-types`.
- Run `alembic-migration-reviewer` and `i18n-rtl-reviewer` before final verification.

## File Structure

### Create

- `backend/app/db/migrations/versions/0066_permit_access_areas.py` — add/drop the nullable structured JSON column.
- `frontend/src/pages/permits/PermitAccessBadge.tsx` — render canonical and legacy access labels on screen and print.
- `frontend/src/pages/permits/PermitAccessBadge.test.tsx` — behavior tests for exact pairings, order, Work residence, and legacy fallback.

### Modify

- `backend/app/db/models.py` — map `Permit.access_areas`.
- `backend/app/schemas/permit.py` — define and validate `PermitAccessAreas`; cut create/update writes over from `zones`.
- `backend/app/services/permit_service.py` — derive `zones`, persist structured access, and pass it to document generation.
- `backend/app/core/permit_letter.py` — render exact location-zone lines and legacy fallback.
- `backend/tests/test_permit_schemas.py` — structured-access validation tests.
- `backend/tests/test_permits_service.py` — persistence, derived-union, filtering, summary, update, and legacy tests.
- `backend/tests/test_permit_letter.py` — exact Arabic document scenarios.
- `backend/tests/test_permit_book_generation.py` — generated-book input and helper payload cutover.
- `backend/tests/test_permit_approval_flow.py` — helper payload cutover.
- `backend/tests/test_permit_manager_signature.py` — helper payload cutover.
- `backend/openapi.json` — generated API contract.
- `frontend/src/lib/api.types.ts` — generated TypeScript contract.
- `frontend/src/lib/api.ts` — hand-declared permit types and write payloads.
- `frontend/src/pages/permits/PermitFormDialog.tsx` — approved location cards, state, validation, payload, and legacy edit handling.
- `frontend/src/pages/permits/PermitFormDialog.test.tsx` — create/edit/legacy interaction contracts.
- `frontend/src/pages/permits/PermitDetailDialog.tsx` — full access labels.
- `frontend/src/pages/permits/PermitDetailDialog.test.tsx` — detail exact-pairing assertion.
- `frontend/src/pages/permits/PermitsPage.tsx` — register and detailed-print exact pairings.
- `frontend/src/pages/permits/PermitsPage.test.tsx` — register, legacy, and print-data assertions.
- `frontend/src/locales/en.json` — English access/location copy.
- `frontend/src/locales/ar.json` — Arabic peer copy.
- `frontend/src/locales/permits.i18n.test.ts` — key parity and no-English-leak coverage.

### Delete

- `frontend/src/pages/permits/ZoneBadge.tsx` — superseded by `PermitAccessBadge`; no alias or compatibility wrapper remains.

---

### Task 1: Persist and Validate Canonical Permit Access

**Files:**
- Create: `backend/app/db/migrations/versions/0066_permit_access_areas.py`
- Modify: `backend/app/db/models.py:430-466`
- Modify: `backend/app/schemas/permit.py:14-23,119-175,213-260`
- Modify: `backend/app/services/permit_service.py:35-48,108-148,245-272,370-382,441-459`
- Test: `backend/tests/test_permit_schemas.py`
- Test: `backend/tests/test_permits_service.py`
- Test helpers: `backend/tests/test_permit_book_generation.py:40-50`
- Test helpers: `backend/tests/test_permit_approval_flow.py:61-71`
- Test helpers: `backend/tests/test_permit_manager_signature.py:88-98`

**Interfaces:**
- Produces: `PermitLocationZone = Literal["green", "red"]`.
- Produces: `PermitAccessAreas(al_wathba_1: list[PermitLocationZone], al_wathba_2: list[PermitLocationZone], work_residence: bool)`.
- Produces: `Permit.access_areas: dict[str, object] | None`.
- Produces: `_zones_from_access(access: PermitAccessAreas) -> list[PermitZone]` in `permit_service.py`.
- Produces: `PermitRead.access_areas` and `PermitListItem.access_areas`, consumed by Tasks 2–4.
- Preserves: `Permit.zones` and read-response `zones` as the derived union or legacy flat value.

- [ ] **Step 1: Add failing schema tests for normalization and empty-access rejection**

Add imports for `ValidationError`, `PermitAccessAreas`, and `PermitUpdate`, then add:

```python
def test_access_areas_normalize_location_zone_order_and_duplicates():
    access = PermitAccessAreas(
        al_wathba_1=["red", "green", "red"],
        al_wathba_2=["red"],
        work_residence=False,
    )
    assert access.al_wathba_1 == ["green", "red"]
    assert access.al_wathba_2 == ["red"]


def test_access_areas_require_at_least_one_selection():
    with pytest.raises(ValidationError):
        PermitAccessAreas()


def test_permit_update_rejects_explicit_null_access():
    with pytest.raises(ValidationError):
        PermitUpdate(access_areas=None)
```

Update `test_permit_create_accepts_manager_id` to pass:

```python
access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False}
```

- [ ] **Step 2: Run the schema tests and confirm the contract does not exist yet**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_permit_schemas.py -q
```

Expected: collection failure because `PermitAccessAreas` is not defined.

- [ ] **Step 3: Implement the Pydantic contract and write-model cutover**

In `backend/app/schemas/permit.py`, import `model_validator` and add:

```python
PermitLocationZone = Literal["green", "red"]
_LOCATION_ZONE_ORDER: tuple[PermitLocationZone, ...] = ("green", "red")


class PermitAccessAreas(BaseModel):
    al_wathba_1: list[PermitLocationZone] = Field(default_factory=list)
    al_wathba_2: list[PermitLocationZone] = Field(default_factory=list)
    work_residence: bool = False

    @field_validator("al_wathba_1", "al_wathba_2")
    @classmethod
    def _normalize_location_zones(
        cls, value: list[PermitLocationZone]
    ) -> list[PermitLocationZone]:
        return [zone for zone in _LOCATION_ZONE_ORDER if zone in value]

    @model_validator(mode="after")
    def _require_access(self) -> "PermitAccessAreas":
        if not self.al_wathba_1 and not self.al_wathba_2 and not self.work_residence:
            raise ValueError("at least one access area is required")
        return self
```

Then:

- Replace `PermitCreate.zones` with required `access_areas: PermitAccessAreas`.
- Replace `PermitUpdate.zones` with `access_areas: PermitAccessAreas | None = None` and add:

```python
@model_validator(mode="after")
def _reject_explicit_null_access(self) -> "PermitUpdate":
    if "access_areas" in self.model_fields_set and self.access_areas is None:
        raise ValueError("access_areas must not be null when supplied")
    return self
```

- Remove the create/update `_clean_zones` validators; `PermitZone` remains for derived read responses and filters.
- Add `access_areas: PermitAccessAreas | None = None` beside `zones` on `PermitRead` and `PermitListItem`.

- [ ] **Step 4: Run schema tests and verify the new contract passes**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Add failing service tests for persistence, union derivation, and legacy reads**

Change `_mk` to default to:

```python
access_areas=over.pop(
    "access_areas",
    {"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
)
```

Replace zone-write test data with access objects and add:

```python
def test_create_persists_access_and_derives_zone_union(db_session):
    row = _mk(
        db_session,
        access_areas={
            "al_wathba_1": ["green", "red"],
            "al_wathba_2": ["green"],
            "work_residence": True,
        },
    )
    read = svc.to_read(row)
    assert read.access_areas is not None
    assert read.access_areas.al_wathba_1 == ["green", "red"]
    assert read.access_areas.al_wathba_2 == ["green"]
    assert read.zones == ["green", "red", "work_residence"]


def test_update_replaces_access_and_recomputes_union(db_session):
    row = _mk(db_session)
    updated = svc.update_permit(
        db_session,
        row.id,
        PermitUpdate(
            access_areas={
                "al_wathba_1": [],
                "al_wathba_2": ["red"],
                "work_residence": False,
            }
        ),
    )
    assert updated.access_areas == {
        "al_wathba_1": [],
        "al_wathba_2": ["red"],
        "work_residence": False,
    }
    assert updated.zones == ["red"]


def test_legacy_permit_keeps_flat_zones_and_null_access(db_session):
    row = Permit(
        company="Legacy",
        zones=["green", "work_residence"],
        access_areas=None,
        start_date=TODAY,
        end_date=TODAY + timedelta(days=10),
    )
    db_session.add(row)
    db_session.commit()
    read = svc.to_read(row)
    assert read.access_areas is None
    assert read.zones == ["green", "work_residence"]
```

Import `Permit` from `app.db.models`. Replace the summary test with a permit that selects Green at both sites and Red at W2, proving each person is counted once per derived zone:

```python
def test_summary_headcount_by_derived_zone_union(db_session):
    _mk(
        db_session,
        access_areas={
            "al_wathba_1": ["green"],
            "al_wathba_2": ["green", "red"],
            "work_residence": False,
        },
        people=[_person("A"), _person("B")],
    )
    _mk(
        db_session,
        access_areas={
            "al_wathba_1": [],
            "al_wathba_2": ["red"],
            "work_residence": False,
        },
        people=[_person("C")],
    )
    summary = svc.summary(db_session)
    assert summary["people_green"] == 2
    assert summary["people_red"] == 3
```

- [ ] **Step 6: Run the service tests and verify persistence is still missing**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_permits_service.py -q
```

Expected: failures for missing `Permit.access_areas` and old `payload.zones` usage.

- [ ] **Step 7: Add migration `0066` and model mapping**

Create `0066_permit_access_areas.py`:

```python
"""security permits: exact Al Wathba location-zone access

Revision ID: 0066
Revises: 0065
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0066"
down_revision: str | Sequence[str] | None = "0065"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.add_column(sa.Column("access_areas", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.drop_column("access_areas")
```

Map it in `Permit` directly after `zones`:

```python
access_areas: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
```

Do not backfill legacy rows.

- [ ] **Step 8: Derive the flat union and persist both values transactionally**

In `permit_service.py`, import `PermitAccessAreas` and add:

```python
def _zones_from_access(access: PermitAccessAreas) -> list[str]:
    zones: list[str] = []
    for zone in ("green", "red"):
        if zone in access.al_wathba_1 or zone in access.al_wathba_2:
            zones.append(zone)
    if access.work_residence:
        zones.append("work_residence")
    return zones
```

On create, store `payload.access_areas.model_dump(mode="json")` in `row.access_areas` and `_zones_from_access(payload.access_areas)` in `row.zones`.

On update, exclude `access_areas` from the generic `setattr` loop. When the field was supplied, store its JSON object and recompute `row.zones`; never accept or set zones from the payload.

Include both `access_areas` and the derived `zones` in the create audit detail. `to_read` and `to_list_item` continue to use `model_validate`, which parses the stored JSON object into `PermitAccessAreas` and preserves `None` for legacy rows.

- [ ] **Step 9: Cut every backend test payload over to `access_areas`**

Update the helper factories in the three listed book/approval/signature test files and every `PermitCreate(...)` in `test_permits_service.py`. Use this canonical default:

```python
access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False}
```

Keep the direct ORM construction in `test_permit_mulkiya_model.py` unchanged; it intentionally demonstrates nullable legacy access.

- [ ] **Step 10: Exercise migration upgrade and downgrade on a temporary SQLite database**

Run in PowerShell from the worktree:

```powershell
$db = Join-Path $env:TEMP "gssg-permit-access-0066.db"
Remove-Item $db -ErrorAction SilentlyContinue
$uri = "sqlite:///" + ($db -replace "\\", "/")
& C:\Users\Admin\sentinel\venv\Scripts\alembic.exe -x "url=$uri" upgrade 0065
& C:\Users\Admin\sentinel\venv\Scripts\alembic.exe -x "url=$uri" upgrade 0066
& C:\Users\Admin\sentinel\venv\Scripts\python.exe -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); cols={r[1] for r in c.execute('pragma table_info(permits)')}; assert 'access_areas' in cols and 'zones' in cols" $db
& C:\Users\Admin\sentinel\venv\Scripts\alembic.exe -x "url=$uri" downgrade 0065
& C:\Users\Admin\sentinel\venv\Scripts\python.exe -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); cols={r[1] for r in c.execute('pragma table_info(permits)')}; assert 'access_areas' not in cols and 'zones' in cols" $db
Remove-Item $db
```

Expected: both assertions succeed; upgrade adds only `access_areas`, and downgrade removes only it.

- [ ] **Step 11: Run the backend persistence and dependent permit suites**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_permit_schemas.py backend/tests/test_permits_service.py backend/tests/test_permit_book_generation.py backend/tests/test_permit_approval_flow.py backend/tests/test_permit_manager_signature.py -q
C:\Users\Admin\sentinel\venv\Scripts\alembic.exe heads
```

Expected: all tests PASS and exactly `0066 (head)`.

- [ ] **Step 12: Commit the canonical backend access contract**

```powershell
git add backend/app/db/migrations/versions/0066_permit_access_areas.py backend/app/db/models.py backend/app/schemas/permit.py backend/app/services/permit_service.py backend/tests/test_permit_schemas.py backend/tests/test_permits_service.py backend/tests/test_permit_book_generation.py backend/tests/test_permit_approval_flow.py backend/tests/test_permit_manager_signature.py
git commit -m "feat(permits): store exact location-zone access"
```

---

### Task 2: Render Exact Access in the Arabic Permit Document

**Files:**
- Modify: `backend/app/core/permit_letter.py:1-190`
- Modify: `backend/app/services/permit_service.py:370-382`
- Test: `backend/tests/test_permit_letter.py`
- Test: `backend/tests/test_permit_book_generation.py`

**Interfaces:**
- Consumes: `Permit.access_areas` JSON and legacy `Permit.zones` from Task 1.
- Produces: `build_permit_letter_html(*, access_areas: dict[str, object] | None, zones: list[str], ...) -> str`.
- Produces: Arabic rows in stable Al Wathba 1, Al Wathba 2, Work residence order.
- Preserves: existing person/vehicle grammar, validity, purpose, table layout, and approval regeneration behavior.

- [ ] **Step 1: Replace flat-zone tests with failing exact-pairing scenarios**

Change `_sample` to pass both `access_areas` and derived `zones`. Remove the `zones_phrase` import and test. Add:

```python
def test_access_rows_preserve_location_zone_pairings():
    html = _sample(
        access_areas={
            "al_wathba_1": ["green"],
            "al_wathba_2": ["red"],
            "work_residence": False,
        },
        zones=["green", "red"],
    )
    assert "الوثبة 1" in html and "المنطقة الخضراء" in html
    assert "الوثبة 2" in html and "المنطقة الحمراء" in html
    assert "المواقع والمناطق الموضحة أدناه" in html
    assert "مواقع ومناطق الدخول المصرّح بها" in html


def test_one_location_keeps_both_zones_on_its_line():
    html = _sample(
        access_areas={
            "al_wathba_1": ["green", "red"],
            "al_wathba_2": [],
            "work_residence": False,
        },
        zones=["green", "red"],
    )
    assert html.count("الوثبة 1") == 1
    assert "الوثبة 2" not in html


def test_legacy_letter_labels_location_unspecified():
    html = _sample(
        access_areas=None,
        zones=["green", "red", "work_residence"],
    )
    assert "الموقع غير محدد" in html
    assert "المنطقة الخضراء" in html and "المنطقة الحمراء" in html
    assert "منطقة أخرى" in html and "سكن العمل" in html
```

Verify the pairing within each row fragment, not merely by global text presence:

```python
w1_start = html.index("الوثبة 1")
w2_start = html.index("الوثبة 2")
w1_fragment = html[w1_start:w2_start]
w2_fragment = html[w2_start:html.index("</td>", w2_start)]
assert "المنطقة الخضراء" in w1_fragment
assert "المنطقة الحمراء" not in w1_fragment
assert "المنطقة الحمراء" in w2_fragment
assert "المنطقة الخضراء" not in w2_fragment
```

- [ ] **Step 2: Run letter tests and confirm the current flat renderer fails**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_permit_letter.py -q
```

Expected: failures for the new argument and missing Arabic location labels.

- [ ] **Step 3: Implement the exact Arabic access formatter**

Replace `zones_phrase` and `_zone_chips` with small internal helpers that:

1. Iterate `al_wathba_1`, then `al_wathba_2` when `access_areas` is present.
2. Render only selected Green/Red chips beneath the matching Arabic site label.
3. Render `منطقة أخرى — سكن العمل` only when `work_residence` is true.
4. When `access_areas is None`, render legacy Green/Red under `الموقع غير محدد` and legacy Work residence separately.
5. Escape every dynamic fallback value before inserting it into HTML.

Change the narrative destination to:

```python
"بالدخول من البوابة الرئيسية إلى المواقع والمناطق الموضحة أدناه"
```

Change the info-row label to `مواقع ومناطق الدخول المصرّح بها:` and keep the current green/red/blue palettes.

- [ ] **Step 4: Thread structured and legacy data from the service**

Update the document call to:

```python
body = build_permit_letter_html(
    company=permit.company,
    access_areas=permit.access_areas,
    zones=list(permit.zones),
    start_date=permit.start_date,
    end_date=permit.end_date,
    people=people,
    vehicles=vehicles,
    purpose=permit.purpose,
)
```

Do not regenerate records during migration. Renewal or roster changes continue to call this function; null access takes the explicit legacy branch.

- [ ] **Step 5: Add a generated-book integration assertion**

In `test_permit_book_generation.py`, spy on `document_service.generate_document`, capture `kw["fields"]["body"]`, create a permit with W1 Green and W2 Red, and assert the captured body includes both Arabic location labels and the exact corresponding zone labels.

- [ ] **Step 6: Run document and regeneration suites**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_permit_letter.py backend/tests/test_permit_book_generation.py backend/tests/test_permit_approval_flow.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit document behavior**

```powershell
git add backend/app/core/permit_letter.py backend/app/services/permit_service.py backend/tests/test_permit_letter.py backend/tests/test_permit_book_generation.py
git commit -m "feat(permits): print exact location-zone pairings"
```

---

### Task 3: Build the Approved Permit Form and Sync the API Contract

**Files:**
- Modify: `frontend/src/lib/api.ts:162-315`
- Modify: `frontend/src/pages/permits/PermitFormDialog.tsx:8-178,260-336`
- Modify: `frontend/src/pages/permits/PermitFormDialog.test.tsx`
- Modify: `frontend/src/locales/en.json:398-405,515-544`
- Modify: `frontend/src/locales/ar.json:431-438,564-593`
- Modify: `frontend/src/locales/permits.i18n.test.ts`
- Generate: `backend/openapi.json`
- Generate: `frontend/src/lib/api.types.ts`

**Interfaces:**
- Consumes: backend `PermitAccessAreas` and nullable read field from Task 1.
- Produces: TypeScript `PermitLocationZone` and `PermitAccessAreas` with exact snake_case keys.
- Produces: `PermitCreate.access_areas` required and `PermitUpdate.access_areas` optional; removes write-side `zones`.
- Produces: localized location/access keys reused by Task 4.

- [ ] **Step 1: Add failing form tests for explicit access and exact payloads**

Make `renderForm` accept `permit?: PermitRead | null`. Mock `updatePermit`. Add:

```tsx
it('starts with no access and requires an explicit selection', async () => {
  renderForm()
  expect(screen.getByRole('button', { name: /issue permit/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /al wathba 1.*green/i })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

it('sends independent zones for both Al Wathba locations', async () => {
  const createSpy = vi.spyOn(api, 'createPermit').mockResolvedValue({ id: 7 } as never)
  renderForm()
  await userEvent.type(screen.getByLabelText(/company/i), 'ACME')
  await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
  await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')
  await userEvent.click(screen.getByRole('button', { name: /al wathba 1.*green/i }))
  await userEvent.click(screen.getByRole('button', { name: /al wathba 2.*red/i }))
  await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))
  await waitFor(() =>
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        access_areas: {
          al_wathba_1: ['green'],
          al_wathba_2: ['red'],
          work_residence: false,
        },
      }),
    ),
  )
})
```

Add an edit hydration test with canonical access and a legacy test where `access_areas: null`, `zones: ["green", "work_residence"]`: Work residence is selected, the amber location warning appears, and Save remains disabled until W1/W2 Green or Red is selected.

Update the existing send-for-approval test to select W1 Green before submitting.

- [ ] **Step 2: Run the form tests and verify the approved controls are absent**

Run:

```powershell
pnpm -C frontend exec vitest run src/pages/permits/PermitFormDialog.test.tsx
```

Expected: failures for missing location-zone controls and old flat payload.

- [ ] **Step 3: Update TypeScript permit contracts**

In `frontend/src/lib/api.ts`, add:

```typescript
export type PermitLocationZone = 'green' | 'red'

export interface PermitAccessAreas {
  al_wathba_1: PermitLocationZone[]
  al_wathba_2: PermitLocationZone[]
  work_residence: boolean
}
```

Add `access_areas: PermitAccessAreas | null` to `PermitListItem`. Replace write-side `zones` with `access_areas` in `PermitCreate` and `PermitUpdate`; keep read-side `zones` for filters, summaries, and legacy fallback.

- [ ] **Step 4: Implement access-area state, validation, and payloads**

In `PermitFormDialog.tsx`:

- Replace `zones` state with `PermitAccessAreas` state initialized to empty W1/W2 arrays and `work_residence: false`.
- Clone `permit.access_areas` on canonical edit.
- On legacy edit, leave W1/W2 empty and seed Work residence from `permit.zones.includes('work_residence')`.
- Add `toggleLocationZone(location, zone)` and `setWorkResidence` updates without mutating arrays.
- Compute `hasAnyAccess`, `hasLocationAccess`, and `legacyNeedsLocation`.
- Require `hasAnyAccess`; additionally require `hasLocationAccess` when a legacy permit contains Green or Red.
- Submit `access_areas` from both create and edit branches; remove every write of `zones`.

Render the approved panel directly after Company:

- Label `Access areas` and required help.
- Two cards, fixed order W1 then W2.
- Two `aria-pressed` Green/Red buttons per card with color dot and selected checkmark.
- Separate Work residence button below the cards.
- `grid-cols-1 sm:grid-cols-2`, logical text alignment, and existing focus-ring tokens.
- Amber legacy message that names the previously recorded zones and never assigns them to a site.

- [ ] **Step 5: Add exact English and Arabic copy and parity keys**

Add keys for:

```text
permits.location.al_wathba_1
permits.location.al_wathba_1Short
permits.location.al_wathba_2
permits.location.al_wathba_2Short
permits.location.unspecified
permits.location.unspecifiedShort
permits.access.pair
permits.access.other
permits.form.accessAreas
permits.form.accessAreasHelp
permits.form.accessRequired
permits.form.legacyAccessWarning
```

English uses `Al Wathba 1`, `Al Wathba 2`, `Location not specified`, and `{{location}} · {{zone}}`. Arabic uses `الوثبة 1`, `الوثبة 2`, `الموقع غير محدد`, and the same localized interpolation structure. Add all keys to `permits.i18n.test.ts`.

- [ ] **Step 6: Run form and translation tests**

Run:

```powershell
pnpm -C frontend exec vitest run src/pages/permits/PermitFormDialog.test.tsx src/locales/permits.i18n.test.ts
```

Expected: PASS.

- [ ] **Step 7: Regenerate the OpenAPI and TypeScript contracts**

Run the `sync-api-types` workflow from the worktree:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -X utf8 scripts\dump_openapi.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm run gen:api"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm exec tsc -b --noEmit"
```

Expected: OpenAPI exposes `PermitAccessAreas`; create/update write schemas have no `zones`; TypeScript check passes after the form/type cutover.

- [ ] **Step 8: Commit form and synchronized API contract**

```powershell
git add backend/openapi.json frontend/src/lib/api.types.ts frontend/src/lib/api.ts frontend/src/pages/permits/PermitFormDialog.tsx frontend/src/pages/permits/PermitFormDialog.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/locales/permits.i18n.test.ts
git commit -m "feat(permits): select access zones by location"
```

---

### Task 4: Show Exact Access Everywhere the Permit Is Read or Printed

**Files:**
- Create: `frontend/src/pages/permits/PermitAccessBadge.tsx`
- Create: `frontend/src/pages/permits/PermitAccessBadge.test.tsx`
- Modify: `frontend/src/pages/permits/PermitDetailDialog.tsx:16-32,320-335`
- Modify: `frontend/src/pages/permits/PermitDetailDialog.test.tsx`
- Modify: `frontend/src/pages/permits/PermitsPage.tsx:30-38,247-282,317-380,423-444`
- Modify: `frontend/src/pages/permits/PermitsPage.test.tsx`
- Modify: `frontend/src/locales/en.json:421-469`
- Modify: `frontend/src/locales/ar.json:454-519`
- Delete: `frontend/src/pages/permits/ZoneBadge.tsx`

**Interfaces:**
- Consumes: `PermitAccessAreas | null`, derived `PermitZone[]`, and location/access translations from Task 3.
- Produces: `PermitAccessBadge({ accessAreas, zones, square?, full? })`.
- Legacy rule: Green/Red render with explicit unspecified-location wording; Work residence remains independent.
- Canonical order: W1 Green, W1 Red, W2 Green, W2 Red, Work residence.

- [ ] **Step 1: Add failing component tests for canonical and legacy display**

Create `PermitAccessBadge.test.tsx`:

```tsx
it('renders exact pairings in stable order', () => {
  render(
    <PermitAccessBadge
      accessAreas={{ al_wathba_1: ['green'], al_wathba_2: ['red'], work_residence: true }}
      zones={['green', 'red', 'work_residence']}
    />,
  )
  expect(screen.getByText(/W1 · Green/i)).toBeInTheDocument()
  expect(screen.getByText(/W2 · Red/i)).toBeInTheDocument()
  expect(screen.getByText(/Work res/i)).toBeInTheDocument()
})

it('labels legacy zones without inventing a location', () => {
  render(<PermitAccessBadge accessAreas={null} zones={['green', 'work_residence']} full />)
  expect(screen.getByText(/Location not specified · Green/i)).toBeInTheDocument()
  expect(screen.getByText(/Work residence/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the component test and verify the component is missing**

Run:

```powershell
pnpm -C frontend exec vitest run src/pages/permits/PermitAccessBadge.test.tsx
```

Expected: collection failure because `PermitAccessBadge` does not exist.

- [ ] **Step 3: Implement `PermitAccessBadge` and remove `ZoneBadge`**

Implement a single small component that builds its entries in fixed order, maps Green/Red through existing `zoneTone`, renders Work residence with `info`, and uses the existing `Badge` component. Use `full` to choose full or short location/zone labels; use `square` for the dense register. For legacy access, combine the localized unspecified-location label with each legacy Green/Red zone and render legacy Work residence independently.

Delete `ZoneBadge.tsx`. Update all imports directly; leave no alias or deprecated export.

- [ ] **Step 4: Replace read and print surfaces**

- `PermitDetailDialog`: pass `permit.access_areas` and `permit.zones` with `full`.
- `PermitsPage` row: pass structured and legacy fields with `square`.
- `PermitPrintCard`: replace the flat `permit.zones.map(...).join(' + ')` text with `<PermitAccessBadge accessAreas={permit.access_areas} zones={permit.zones} square />`.
- Rename the visible column/detail label from singular Zone to `Access areas / مناطق الدخول`; keep the toolbar filter labeled Zone because it still filters the derived union.
- Ensure the table remains horizontally scrollable at narrow widths and the badge container wraps instead of clipping.

- [ ] **Step 5: Update fixtures and add surface assertions**

Add `access_areas` to every permit fixture. Make Acme canonical W1 Green + W2 Red; make Descon legacy with `access_areas: null`. Assert:

```tsx
expect(screen.getAllByText(/W1 · Green/i).length).toBeGreaterThan(0)
expect(screen.getAllByText(/W2 · Red/i).length).toBeGreaterThan(0)
expect(screen.getAllByText(/Unspecified · Green/i).length).toBeGreaterThan(0)
```

In `PermitDetailDialog.test.tsx`, assert full `Al Wathba 1 · Green zone` and `Al Wathba 2 · Red zone` labels after loading the permit.

- [ ] **Step 6: Run all permit frontend tests**

Run:

```powershell
pnpm -C frontend exec vitest run src/pages/permits/PermitAccessBadge.test.tsx src/pages/permits/PermitFormDialog.test.tsx src/pages/permits/PermitDetailDialog.test.tsx src/pages/permits/PermitsPage.test.tsx src/locales/permits.i18n.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit exact access displays**

```powershell
git add frontend/src/pages/permits/PermitAccessBadge.tsx frontend/src/pages/permits/PermitAccessBadge.test.tsx frontend/src/pages/permits/PermitDetailDialog.tsx frontend/src/pages/permits/PermitDetailDialog.test.tsx frontend/src/pages/permits/PermitsPage.tsx frontend/src/pages/permits/PermitsPage.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git rm frontend/src/pages/permits/ZoneBadge.tsx
git commit -m "feat(permits): show exact access pairings"
```

---

### Task 5: Required Reviews and End-to-End Verification

**Files:**
- Review all files changed in Tasks 1–4.
- Modify only the affected files when a required reviewer finds a concrete defect.
- Do not add new scope or documentation beyond the approved design and this plan.

**Interfaces:**
- Consumes: complete backend, document, API, and frontend implementation.
- Produces: one migration head, synchronized API artifacts, bilingual/RTL parity, passing focused suites, and browser evidence for the approved workflow.

- [ ] **Step 1: Run migration safety review**

Run `alembic-migration-reviewer` against `0066_permit_access_areas.py`. Verify:

- `down_revision == "0065"`.
- Both upgrade and downgrade use `batch_alter_table`.
- The column is nullable and no historical location is backfilled.
- `zones` is preserved.
- Exactly one head remains:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\alembic.exe heads
```

Expected: `0066 (head)` only.

- [ ] **Step 2: Run bilingual and RTL review**

Run `i18n-rtl-reviewer` against the form, access badges, register/detail/print labels, and Arabic/English locale changes. Verify:

- Arabic and English keys are peers.
- W1/W2 card order follows reading direction without changing semantic identity.
- Logical `ms`/`me`/`text-start` alignment is used.
- Selected state includes label and checkmark, not color alone.
- Mobile cards stack and all buttons remain keyboard reachable with focus rings.

Apply only evidence-backed corrections, then rerun the focused frontend tests.

- [ ] **Step 3: Run backend quality and behavior checks**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_permit_schemas.py backend/tests/test_permits_service.py backend/tests/test_permit_letter.py backend/tests/test_permit_book_generation.py backend/tests/test_permit_approval_flow.py backend/tests/test_permit_manager_signature.py -q
C:\Users\Admin\sentinel\venv\Scripts\ruff.exe check backend/app/schemas/permit.py backend/app/services/permit_service.py backend/app/core/permit_letter.py backend/app/db/models.py backend/app/db/migrations/versions/0066_permit_access_areas.py backend/tests/test_permit_schemas.py backend/tests/test_permits_service.py backend/tests/test_permit_letter.py backend/tests/test_permit_book_generation.py backend/tests/test_permit_approval_flow.py backend/tests/test_permit_manager_signature.py
C:\Users\Admin\sentinel\venv\Scripts\mypy.exe
```

Expected: all focused tests pass, Ruff reports no errors, and mypy passes.

- [ ] **Step 4: Run frontend quality and contract checks**

Run sequentially to avoid exhausting this workstation:

```powershell
pnpm -C frontend exec vitest run src/pages/permits/PermitAccessBadge.test.tsx src/pages/permits/PermitFormDialog.test.tsx src/pages/permits/PermitDetailDialog.test.tsx src/pages/permits/PermitsPage.test.tsx src/locales/permits.i18n.test.ts
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
```

Expected: focused tests, lint, typecheck, and production build pass.

The unrelated pre-existing `TemplateForm.bodyMode.test.tsx` failure observed before implementation is not part of this feature; do not suppress or modify it. If the full frontend suite is run, report it separately from permit results.

- [ ] **Step 5: Browser-smoke the approved form in English and Arabic**

Start the worktree Vite server through the supervised process manager and use browser request interception; never connect this smoke test to the live backend. Return these exact fixtures:

```text
GET /api/v1/auth/me
  → {"id":1,"email":"permit-smoke@gssg.test","employee_id":null,"name_en":"Permit Smoke","name_ar":"اختبار التصريح","position":null,"department":null,"photo_url":null,"role":"admin","status":"active","is_admin":true,"is_manager":false,"has_signature":false}
GET /api/v1/auth/me/capabilities
  → ["permits.view","permits.manage"]
GET /api/v1/system/migration-status
  → {"has_db":true,"has_data":true,"v3_data_dir_detected":null,"last_migration":null}
GET /api/v1/permits/summary
  → {"active":0,"expiring":0,"expired":0,"revoked":0,"people_active":0,"people_green":0,"people_red":0,"people_work_residence":0}
GET /api/v1/permits (including query strings)
  → {"items":[],"total":0,"limit":500,"offset":0}
GET /api/v1/managers
  → []
POST /api/v1/permits
  → capture and assert the JSON body, then respond 201 with the same canonical access fields and the required empty read arrays/counts.
```

Log and reject any unexpected `/api/v1/` request instead of silently returning a malformed catch-all response.

At desktop width:

1. Open New permit.
2. Confirm no access is selected and Issue permit is disabled.
3. Select Al Wathba 1 Green and Al Wathba 2 Red.
4. Fill Company and one person with UAE ID.
5. Confirm Issue permit becomes enabled.
6. Submit and assert the captured body contains exactly:

```json
{
  "access_areas": {
    "al_wathba_1": ["green"],
    "al_wathba_2": ["red"],
    "work_residence": false
  }
}
```

Repeat at mobile width and Arabic/RTL. Confirm cards stack, names remain tied to the correct controls, buttons wrap without clipping, and the selected checkmark/label remains visible.

- [ ] **Step 6: Smoke the generated document contract**

Run the real `test_create_permit_generates_1_5_book` path with PDF conversion stubbed as the existing fixture requires. Inspect the generated Book body or captured `fields["body"]` and confirm:

```text
الوثبة 1 — المنطقة الخضراء
الوثبة 2 — المنطقة الحمراء
```

Also run the legacy regeneration unit scenario and confirm it says `الموقع غير محدد` rather than assigning W1 or W2.

- [ ] **Step 7: Commit reviewer corrections, if any**

If reviews required changes:

```powershell
git add backend frontend
git commit -m "fix(permits): address location access reviews"
```

If no files changed, do not create an empty commit.

- [ ] **Step 8: Verify the worktree is ready for branch completion**

Run:

```powershell
git status --short
git log --oneline -5
```

Expected: clean worktree and the design, plan, backend contract, document, form/API, and display commits present. Then invoke `verification-before-completion`, followed by `finishing-a-development-branch` to choose merge/push/deploy handling. Do not modify or deploy from the live checkout directly.
