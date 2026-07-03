# Form people-pickers: passport table + clearance manager/submitter

**Date:** 2026-07-03
**Branch:** feat/passport-ocr-impl
**Status:** Approved (design)

## Problem

Two form-editing gaps surfaced during the passport work:

1. **Passport Release List** (`Passport Release List` in `_fields.json`, form 300-004b,
   `admin` category — shown to users as "Passport Release" / استلام جواز السفر) uses
   `EmployeesTableField`, which makes the operator type an **exact G-number** into a plain
   text input and press *Add*. A typo just errors. Every other form selects an employee
   through the shared `EmployeePicker` combobox (type a number **or** name → live-filtered
   dropdown backed by `GET /employees?q=`, which ILIKE-matches `Employee.id`, `name_en`,
   `name_ar`).

2. **Employee Clearance Form** (form 300-009, `personnel`) has no way to record the line
   manager or the submitter. It should offer the same `manager_picker` + `submitter_picker`
   the Duty Resumption form already uses.

## Scope

### Part 1 — Passport Release List: searchable employee picker (frontend only)

Replace the manual G-number `<Input>` + *Add* button in
`frontend/src/components/application/fields/EmployeesTableField.tsx` with the shared
`EmployeePicker` combobox (`frontend/src/pages/application/EmployeePicker.tsx`).

Behaviour:

- The picker is driven transient — `selectedId={null}` always; selecting a row from the
  dropdown **is** the "add" action.
- On select, run the *existing* resolve-and-append logic: `api.getEmployee(id)` → append
  `{ employee_id, name: name_ar || name_en, nationality, passport_no }`, then the picker
  resets (query clears) ready for the next add.
- Preserve everything else already in the field:
  - 15-row hard cap (`MAX_ROWS`; template has 15 data rows) — picker disabled at cap.
  - Duplicate guard (same `employee_id` already in the list → inline message, no append).
  - Editable Nationality + Passport No cells; read-only ID + Name; per-row remove button.
  - Output shape unchanged: `[{ employee_id, name, nationality, passport_no }]` feeding the
    `item(i, field)` DOCX tokens.
- Lookup-error handling for a not-found/failed `getEmployee` stays (though the picker only
  surfaces existing employees, the resolve call can still fail).

**No** backend, API, or DOCX-template change — the `item(i, field)` tokens already exist and
the emitted row shape is identical to today's.

### Part 2 — Employee Clearance Form: manager + submitter pickers (`_fields.json` only)

Add two fields to `"Employee Clearance Form"` in `backend/templates/_fields.json`, mirroring
the Duty Resumption form's entries:

```json
{ "key": "manager_id",   "type": "manager_picker",   "label_en": "Line Manager", "label_ar": "المدير المباشر", "required": false },
{ "key": "submitter_id", "type": "submitter_picker", "label_en": "Submitter",    "label_ar": "مقدم الطلب",     "required": false }
```

These auto-wire end-to-end by field **type**:

- `ApplicationPage` already finds `manager_picker` / `submitter_picker` by type, strips them
  from `fields`, and sends them as top-level `manager_id` / `submitter_id`.
- `document_service` already resolves `manager_id` → `manager_name` and `submitter_id` →
  `submitter_name` into the render context for any template.

No frontend component code is needed.

**Placement of the fields:** after `clearance_table`, before any signature fields (the
clearance form currently ends at `clearance_table`, so simply append the two pickers).

## Explicit decision: document rendering (Option B)

The clearance `.docx` today has **no** `{{ manager_name }}` / `{{ submitter_name }}` Jinja
tokens (only a static "Manager" label cell). **Per the user's choice (Option B), this spec does
NOT edit the binary Word template.** The pickers will appear in the app and their values will
be captured, stored, and resolved into the render context; the user will place
`{{ manager_name }}` / `{{ submitter_name }}` tokens in Word themselves where they want them on
the page. Adding those tokens is out of scope here.

## Testing

- **Part 1** (frontend component test, `EmployeesTableField`):
  - Selecting an employee from the picker appends a row filled with id / Arabic name /
    nationality / passport_no.
  - Duplicate selection is rejected (no second row).
  - At 15 rows the picker is disabled (cap holds).
  - Removing a row works; output array shape is `[{employee_id, name, nationality, passport_no}]`.
- **Part 2** (backend schema test):
  - The `Employee Clearance Form` schema exposes a `manager_picker` field keyed `manager_id`
    and a `submitter_picker` field keyed `submitter_id`.
  - (Manager/submitter → name resolution in `document_service` is already covered by existing
    tests; no new backend logic is introduced.)

## Out of scope

- Any change to the Passport Release **Form** (300-004) or the passport OCR pipeline.
- Editing any `.docx` template (clearance tokens are the user's follow-up — Option B).
- Manager/submitter signature embedding on the clearance form.
