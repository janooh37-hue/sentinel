# Duty Transfer — Letter Spacing, Tight Tables & No-Book Bulk Move

**Date:** 2026-06-29
**Status:** Approved design — pending spec review
**Area:** `backend/app/services/duty_service.py`, `backend/app/core/arabic_rtl.py`, `backend/app/schemas/duty.py`, `frontend/src/pages/dutyLocations/TransferDialog.tsx`
**Builds on:** `2026-06-29-duty-transfer-official-letter-design.md` (already shipped to `main`).

## Problem

Three refinements after seeing the live transfer letter:

1. **Crowded body** — the intro paragraph sits flush against the table, and the table flush against the closing. The letter needs one blank line above and below the table to breathe.
2. **Tall table rows** — table rows render taller than the text needs. The inline `padding` CSS in the body HTML is **ignored** by the DOCX renderer (`arabic_rtl.html_to_docx`); the extra height comes from the default paragraph **space-before/after** inherited inside each cell paragraph (`_apply_block_fmt` sets line-spacing but never zeroes paragraph spacing).
3. **Book always minted** — every bulk transfer mints a General Book letter. But most employees currently have **no** duty place, so assigning them is initial placement, not a transfer that needs a formal letter. A single-employee no-book assign already exists (`AssignPopover` → `PATCH /employees`); the bulk flow has no equivalent.

## Goal

Make the transfer letter less crowded, give every General Book table rows that hug their text, and let a bulk move skip the letter when it is pure initial placement.

---

## Design

### A. Blank line around the table — `duty_service._build_body_html`

The body is currently `intro<p> + table + closing<p><p>`. Insert a spacer paragraph on each side of the table:

```
intro  →  <p>&nbsp;</p>  →  table  →  <p>&nbsp;</p>  →  closing
```

Use `<p>&nbsp;</p>` (non-breaking space) so the renderer emits a real blank line rather than collapsing an empty paragraph. Localized to the transfer letter; no other form changes.

### B. Tight table rows — `arabic_rtl._render_table`

For every rendered table **cell** paragraph, after `_apply_block_fmt(para, cblk)`:

- set `para.paragraph_format.space_before = Pt(0)` and `space_after = Pt(0)`;
- set `para.paragraph_format.line_spacing = 1.0` **only when** the cascaded cell style did not specify a line height (i.e. `cblk.line_height` is falsy) — so an explicit CSS `line-height` still wins.

This zeroes the inter-paragraph spacing that inflated row height. It applies to **all** General Book tables rendered via `html_to_docx` (intended — consistent, less crowded everywhere) and touches **only table cells** — narrative body paragraphs keep their spacing.

`Pt` is imported from `docx.shared` (already a dependency).

### C. Auto no-book bulk move — `duty_service.transfer` + schema + dialog

**Rule:** after loading the selected employees (validated, de-duped, in order) and **before** building the body or staging the move, compute `all_unassigned = all(not (e.duty_unit or "").strip() for e in employees)`.

- **`all_unassigned` is true → no-book path:** set each employee's `duty_unit`/`duty_post` to the destination, `db.commit()`, and return a `DutyTransferResult` with `book_id=None`, `ref=None`, `document_id=None`, `moved=[…]`. `recipient_id`/`manager_id`/`cc` are ignored on this path.
- **otherwise → existing path:** build the from→to body, stage the moves, call `document_service.generate_document` (which owns the commit) exactly as today.

"Unassigned" is defined by `duty_unit` only — a blank `duty_unit` means "not in a place" regardless of `duty_post`.

**Schema — `DutyTransferResult`:** `book_id`, `ref`, and `document_id` become optional (`int | None` / `str | None`), defaulting to `None`. `moved` is unchanged. (Request schema `DutyTransferRequest` is unchanged — the dialog still sends recipient/manager/cc; they're simply unused when no book is made.)

**Frontend — `TransferDialog` `onSuccess`:** branch on the result:
- `book_id == null` → toast `dutyLocations.transfer.movedNoBook` (e.g. *"Moved {count} employees"*) with **no** "View record" action; still `saveTransferDefaults`, invalidate `['employees']`/`['books']`, `onTransferred`, close.
- otherwise → the existing letter toast with the "View record" link.

Add the `movedNoBook` string to `ar.json`/`en.json`.

---

## Testing

- **Backend (`duty_service`):**
  - `_build_body_html` output contains exactly two `<p>&nbsp;</p>` spacers, one immediately before `<table` and one immediately after `</table>`.
  - `transfer()` with all-unassigned employees (blank `duty_unit`) makes **no** `generate_document` call (monkeypatch asserts it's never invoked), moves every employee, commits, and returns `book_id is None` / `document_id is None` / correct `moved`.
  - `transfer()` with a mixed selection (≥1 already-placed) **does** call `generate_document` and returns the book id (existing behavior preserved).
- **Backend (renderer):** render a small `<table>` through `html_to_docx` and assert a body cell paragraph has `space_after == Pt(0)` (and `space_before == Pt(0)`); assert a narrative paragraph outside the table is unaffected.
- **Frontend:** light — the `onSuccess` toast branch keys off `book_id == null`; no request-shape change.

## Out of scope

- Per-table opt-out of the tighter rows (global tightening was chosen).
- Changing the mixed-selection behavior (selecting one placed + many unplaced still mints a full letter — the accepted trade-off of the "all unassigned" rule).
- The email builder, recipient/manager/CC plumbing (unchanged from the shipped feature).
