# General Book — solid Word paste + A4 page-view editor

**Date:** 2026-07-16
**Status:** approved (mockup: `docs/general-book-pageview-mockup.html`)
**Scope decision:** Full paste fidelity + real page view (user picked the largest of three offered scopes).

## Problem

The General Book is the weakest surface in the service. Operators compose the
body in the HugeRTE editor (`arabic_rich_full`, `TemplateForm.tsx`) and the
backend renders it into the DOCX via `app/core/arabic_rtl.html_to_docx`
(`_pp_general_book` in `docx_engine.py`). Two reported defects, both confirmed:

1. **Pasted Word tables render ~3× too tall** in the preview/saved PDF (the
   editor itself looks fine). Proven root cause with the operator's real
   template (`التصاريح الأمنية.docx`): Word wraps every cell's text in `<p>`,
   and `_render_table`'s cell walk starts with `first_used: True`, so the
   cell's built-in paragraph stays empty, the text lands in a second
   paragraph, and `_walk_inline`'s block branch appends a third speculative
   paragraph. Raw inter-tag whitespace (`'\n  '`) is also emitted as run text
   instead of collapsed, so the junk paragraphs aren't even empty. Row-height
   fiddling can't fix it — content forces the height. Existing tests only
   cover `<td>text</td>` (bare text, 1 paragraph), which is why this shipped
   green.
2. **No usable page control.** A `pagebreak` toolbar button exists (row 2,
   unlabeled) and the backend already honors `mce-pagebreak` — but the editor
   shows no page boundaries (the `pageHeightPx` guide feature was never wired
   into the General Book form), so operators can't know where page 1 ends or
   that the button exists. Long tables split mid-row across pages.

Additional confirmed gaps for "any Word template pastes solid":
`colspan`/`rowspan` ignored (merged cells misalign), explicit `<tr>` heights
ignored, table `width` forced to full content width.

## Design

### Part 1 — Backend table fidelity (`backend/app/core/arabic_rtl.py`)

**1a. Tall-row fix (root cause).**
- `_render_table` cell sub-state: `first_used: False` so the first block child
  reuses the cell's built-in paragraph.
- HTML whitespace collapse in text emission: runs of ASCII whitespace
  (space/tab/CR/LF/FF — **not** `\xa0`) → single space; whitespace-only text
  into a still-empty paragraph is dropped.
- Post-walk per cell: remove whitespace-only paragraphs (always keep ≥1).
- The zero-spacing hug (space_before/after 0, line 1.0 unless an explicit
  cascaded line-height) applies to **every** paragraph in the cell, not just
  the first.

Result: `<td><p>text</p></td>` renders exactly like `<td>text</td>` — one
paragraph, hugged, same as the GSSG insert-table button.

**1b. Row heights honored.** `<tr>`/`<td>` `height` (style or attr; pt×20,
px×15 twips) → `w:trHeight` with `hRule="atLeast"`. Content can still grow.

**1c. Page-edge behavior.** `w:cantSplit` on every row (a row never breaks
across two pages). When the source has `<thead>`, its row gets `w:tblHeader`
(header repeats when a table spans pages).

**1d. Table width honored.** Table `width` (px / pt / %) → `w:tblW`, capped at
content width; column fractions unchanged (relative). No width → full content
width (current behavior). RTL tables keep `jc=right`.

**1e. Merged cells.** `colspan` → `gridSpan`, `rowspan` → `vMerge`, via
python-docx `cell.merge()` over a grid-occupancy map. Column fractions come
from `colgroup` or the first span-free row; else spanned widths split evenly.

**Page-break correction (found during planning):** the editor's pagebreak
plugin serializes breaks as the HTML comment `<!-- pagebreak -->` (its
default separator) — the backend only detects `<div class="mce-pagebreak">`,
and the walker renders comment text as literal content. So the button today
inserts junk text, not a break. Fix in the walker: comment nodes are never
rendered; comments containing `pagebreak` emit a real `w:br type="page"`.

### Part 2 — Frontend A4 page view

Files: `rich-editor-config.ts` (content CSS + toolbar rows),
`rich-editor.tsx` (page-view options), `TemplateForm.tsx` (enable for
`arabic_rich_full`). All inside the editor iframe's content CSS — no new
components; the `minimal` variant and other consumers untouched.

- **Page canvas:** iframe `html` = gray desk; `body` = white A4 page — width
  ≈ A4 content width at 96dpi (~700px; calibrated to the real template's side
  margins), centered, page shadow, padding = template margins.
- **Page-end guides:** dashed line labeled `≈ نهاية الصفحة / page end` at
  page-1's usable body height (shorter — letterhead + subject block live in
  the template), then repeating every pages-2+ usable height. CSS background
  gradients only. Heights calibrated once during implementation by measuring
  the rendered template (letterhead/footer regions); explicitly approximate.
- **Page-break made obvious:** button moves to toolbar row 1 beside the GSSG
  table button; `mce-pagebreak` styled as a full-width labeled bar
  (`⸻ فاصل صفحة · PAGE BREAK ⸻`) instead of faint dashes.
- **Editor tables match output:** `table p { margin: 0 }` and
  `table { line-height: 1.15 }` in the content CSS (inline styles from pasted
  content still win), so composing matches printing.

### Part 3 — Testing

- Backend unit tests with **Word-paste-shaped fixtures** (derived from the
  real template's filtered-HTML export): cell paragraph count == 1,
  whitespace collapsed, junk paragraphs trimmed, trHeight set, cantSplit
  present, tblHeader from thead, colspan/rowspan grid shapes, table width
  honored + capped, pagebreak → `w:br type="page"`, narrative spacing
  untouched (existing `test_narrative_paragraph_spacing_untouched` must keep
  passing).
- Frontend: vitest for toolbar/config; manual page-canvas check.
- End-to-end: regenerate a General Book from the التصاريح الأمنية content and
  compare the PDF against the Word original; run `i18n-rtl-reviewer` on the
  bilingual surface.

### Not doing (deliberate)

- No new dependencies / no HTML→DOCX library swap (none handle the Arabic
  complex-script stamping this renderer does).
- No true WYSIWYG pagination (live reflow like Word) — guides are calibrated
  approximations; exactness comes from the preview.
- No HugeRTE paste-config surgery — the backend digests Word markup directly.
- No changes to other `_FORM_REGISTRY` forms; `html_to_docx` improvements are
  shared but their templates don't take pasted tables today.

## Risks / notes

- `arabic_rtl.py` is shared by every `html_to_docx` caller (General Book body,
  editor templates). Whitespace collapse must not alter narrative text runs
  beyond HTML semantics (assert via existing tests).
- Guide calibration is per-template (General Book letterhead); if the template
  is re-laid-out in Word, the constants need re-measuring. Keep them as named
  constants with a comment saying how they were measured.
- Word clipboard HTML ≈ filtered-HTML export (mso markup); fixtures use the
  export since the clipboard can't be read in the dev session.
