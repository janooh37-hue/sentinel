# Employee Lookup Redesign — Design Spec

**Date:** 2026-07-08
**Prototype:** `docs/employee-page-prototype.html` (signed off by owner)
**Mockup lineage:** v1–v6 in `docs/employee-search-v*.html`; v6 chosen, elements of v1/v2/v3/v5 merged.

## Goal

Replace the `/employees` roster-list page with a **search-first lookup page**, and restructure
`/employees/:id` into a **file-browsing profile** that surfaces missing personal data
(nationality, DOB, passport, IBAN, …) and drives operators to complete it.

## Why

- Operators almost always arrive knowing *who* they want; the 300-row roster is noise.
- Employee status (active / on leave / resigned) must never hide a file from search.
- Missing personal data currently only shows as `—` in the profile; nobody notices until a
  document generation fails. The new page makes gaps a first-class, actionable object.

## UX Specification

### State A — search (`/employees`)

- Full-width navy band (`--hero-grad`) with centered heading **«عن مَن تبحث؟»** and a large
  white pill search box with red **بحث** accent button.
- Typing (debounced 250 ms) queries `GET /employees?q=…&limit=30` — **no status filter**;
  every status appears, each row shows: avatar (photo or initials), localized name, mono
  G-number, position, status pill (on-leave tint via the dashboard `on_leave_today` set,
  same as the old list). No roster totals anywhere.
- No-results state offers **«+ إنشاء ملف موظف جديد»**.
- Under the search box: ghost button **«موظف جديد — إنشاء ملف»** → shows the existing
  `EmployeeForm` (create mode) in a surface card replacing the content below the band;
  on success navigate to the new employee's profile (same behavior as old page).
- Below, three glass info cards (white 7 % on navy):
  1. **آخر الملفات المفتوحة** — last 3 opened profiles (localStorage), click → profile.
  2. **وثائق تنتهي قريباً** — count badge + 2 most-urgent items from `/expiry?within=90`,
     footer link → `/expiry` page.
  3. **ملفات ناقصة البيانات** — count + top-3 missing field names from the new
     `GET /employees/completeness`; CTA opens the most-incomplete employee's profile.
- Preserved handoffs: intake navigation state (`openCreate` + `injectedExtraction`) opens
  the create form pre-filled; Ledger smart-link `localStorage['gssg.employees.openId']`
  redirects to the profile; the `newItem` keyboard shortcut opens the create form.

### State B — profile (`/employees/:id`)

- **Compact navy band**: eyebrow «العمليات», title «ملف موظف», and a *usable* translucent
  search input («بحث جديد — …», `Ctrl K` hint). One press clears it and navigates to
  `/employees` (State A) with the search focused; browser Back returns to the profile.
- **Sticky sidebar** (350 px, start side; stacks above content < 920 px):
  - **Employee ID card** (navy, physical-card look): photo tile, bilingual name, mono
    G-number, facts grid (position, status pill, department, duty unit), actions
    **إنشاء مستند / إضافة إجازة / تعديل** (same handlers as today's hero). Status pill
    opens the existing `StatusDialog` when the user has `employees.edit`.
  - **Missing-data card** (warning-soft): «N بيانات ناقصة — اكتمال F/T», vertical
    checklist of missing fields (from the API, see Completeness), each item and the
    **أكمل البيانات الآن** button open the edit form.
- **Main column**: pill **tab chips** (replacing the underline tabs):
  «البيانات الشخصية (بادج النواقص) · المستندات · الإجازات · الرسائل · النشاط · المخالفات».
  Default tab: **profile** (was documents). Counts come from the existing
  `GET /employees/{id}/detail` aggregate. Tab bodies reuse the existing tab components
  (`DocumentsTab`, `LeavesTab`, `MessagesTab`, `ActivityTab`, `ViolationsTab`) unchanged.
- **ProfileTab rebuilt** as four section cards, each with a completeness pill
  («ناقص ٢» warning / «مكتملة» success) and label/value rows where missing values render
  as amber «غير مسجّل + أضف الآن» rows that open the edit form:
  - البيانات الشخصية: name_ar, name_en, nationality, dob, contact, msg_language
  - وثائق الهوية: uae_id_no, uae_id_expiry (with ⚠ ≤ 90-day chip), passport_no, passport_expiry
  - بيانات العمل: position, department, duty_unit, duty_post, doj, doj_company
  - البيانات المالية: iban
  The identity-document tiles + signature pad sections of the current ProfileTab remain
  below the cards, unchanged.
- `EmployeeQuickStats` is removed from the page (tab-chip badges carry the counts).

## Completeness Model (single source of truth)

`backend/app/core/employee_completeness.py` defines the **14 tracked fields**:

```
name_en, name_ar, dob, nationality, contact,
passport_no, passport_expiry, uae_id_no, uae_id_expiry, iban,
position, department, duty_unit, doj
```

- `position` counts as filled if **either** `position` or `position_ar` is set.
- A field is missing when `None` or blank/whitespace.
- `missing_fields(emp) -> list[str]` (stable order above) and
  `completeness(emp) -> tuple[filled, tracked]`.

**API surface (backend computes, frontend renders — no duplicated field list in TS):**

1. `EmployeeDetailRead` gains `missing_fields: list[str]` and
   `completeness: {filled: int, tracked: int}`.
2. New `GET /employees/completeness` (capability `employees.view`) →
   `{ incomplete: int, tracked: int, top_missing: [{field, count}×3], first_incomplete_id: str|null }`
   computed over **Active** employees only; `first_incomplete_id` = most missing fields,
   ties by id.

Field display names come from i18n keys `employee.field.<name>` (en + ar).

## Routing & Removal

- `/employees` → new `EmployeeLookupPage` (State A). The old `EmployeesPage`
  (virtualized roster, filter chips, count line) is **deleted**.
- `/employees/:id` → restructured `EmployeeDetailPage` (State B).
- `EmployeeList`, `EmployeeQuickStats` components are deleted if no other consumer remains.

## Non-goals (v1)

- Status filter inside the search dropdown (footer link is a stub for later).
- Per-field inline editing (the full `EmployeeForm` remains the edit surface).
- Pagination / browse-all view; search + recents replace roster browsing.
- WhatsApp column in Messages tab (unchanged from today).

## i18n / RTL

All new strings live in `frontend/src/locales/{en,ar}.json` with full key parity
(`employees.lookup.*`, `employee.gaps.*`, `employee.field.*`, `employee.card.*`).
Logical CSS only (`ms-/me-`, `text-start`, `inset-inline-*`). Run the
`i18n-rtl-reviewer` agent before merge.

## Testing

- Backend: pytest for the completeness core (blank/whitespace/position-ar cases),
  the `/employees/completeness` endpoint, and the extended detail payload.
- Frontend: vitest for search debounce + dropdown + create CTA, recents storage util,
  sidebar gaps card, ProfileTab missing rows; update `EmployeeDetailPage.test.tsx` and
  `ProfileTab.test.tsx` for the new structure.
- Existing suites must stay green; `filterwarnings=error` and mypy strict apply.

## Rollout

Work on branch `feat/employee-lookup`; after each backend schema change run
`/sync-api-types` and commit `openapi.json` + `api.types.ts` together; merge to `main`
when green (this checkout is production — unpushed work is overwritten by `mng update`),
then `scripts\mng.ps1 deploy`.
