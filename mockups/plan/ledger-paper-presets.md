# Ledger Book paper presets, bottom block and editor

Branch `feat/ledger-html-books` (PR #268), on top of `9d1ca9ec` (the Phase 2b
work: To/CC addressees, signing manager, return, Outlook draft). Status:
**approved 2026-11-06**: General book = the Word General Book layout (so it
is the Normal preset), Report as described, copy-to-folder prints and files,
preview shows real PDF pages.

## What already exists (do not rebuild)

| Area | State at `9d1ca9ec` |
|---|---|
| To / CC | `book_addressees` (role `to`/`cc`, app user or address-book contact), `LedgerAddresseesPicker` |
| Delivery | `ledger_book_service.sign()`: when the signing manager signs, internal To/CC users receive the book through `book_send_service.prepare_delivery` + push, atomically with the lock. External books go out as an Outlook draft. Matches ADR 0007 "To/CC receive the book after the final approval". |
| Paper order | ref/date/barcode → «السيد \ … المحترم» per To + greeting → subject (left, bold, underlined) → body → signature block → «نسخة إلى:» |
| Barcode | Code 39 bars only; the number under it is gone (the «الرقم:» line still shows the ref) |
| References | `book_links` (`kind='reference'`) and `book_link_service` with `require_grade_floor` |
| Folders | `book_folders` / `book_folder_items`; a book is filed only into folders of a desk box it is in |

## Presets

A Draft picks one preset; the issued Revision stores it. **Normal** is the
default and is the Word General Book layout. `paper_preset` ∈ `normal`, `report`.

| Block | Normal (default, = Word General Book) | Report (تقرير) |
|---|---|---|
| Letterhead, ref, date, barcode | yes | yes |
| Opening | «السيد \ name المحترم» per To, «تحية طيبة وبعد،» | none |
| Subject | inline end (left), bold, underlined, 16pt | «تقرير» line, then the subject as a centred bold 20pt title |
| Body | as written | as written; heading presets numbered (1, 1.1) |
| Sign-off | signing manager block | two blocks side by side: «إعداد» (writer name, G-number) and «اعتماد» (signing manager, signature once signed) |
| Bottom block | yes | yes |

## Bottom block

Printed after the sign-off, in this order, each label once and one entry per line:

1. **«نسخة إلى:»**: CC names (app users and contacts). App users receive the book at signing, as above.
2. **«إشارة إلى:»**: each referenced book as «كتاب رقم {ref} بتاريخ {DD/MM/YYYY}». In the app the ref links to the book; a viewer who cannot open it sees the text without a link and gets no 404 leak. Stored as `book_links` `kind='reference'` at Save & Send; a Secret target raises the floor (`require_grade_floor`), checked on the draft before Save & Send.
3. **«نسخة إلى الملف:»**: chosen folder names. At Save & Send the issued book is also **filed** into each chosen folder (the writer's own folders, plus team folders shared with them, in the **outgoing** box), through the existing folder service and its box rule.

Grade rules: Addressee Only has no CC (picker hides CC). Secret CC users must hold `books.secret`; the picker greys them out with the reason.

## Editor (HugeRTE, ledger body)

- Menubar `edit view insert format table tools`; plugins: lists, advlist, table, link-free (no external URLs), charmap, searchreplace, visualblocks, fullscreen, wordcount, pagebreak, image (server upload only).
- Taller editing area (fills the composer column, minimum 600px), with a fullscreen toggle.
- Heading presets (`style_formats`): العنوان الرئيسي (H2, 18pt, bold, centred), عنوان فرعي (H3, 16pt, bold), عنوان قسم (H4, 14pt, bold, underlined), فقرة (16pt), ملاحظة (12pt).
- Font list: **Sakkal Majalla**, **Calibri**, **Univers Next Arabic**, Noto Naskh Arabic. Default body: `Calibri, "Sakkal Majalla"` at 16pt (Latin in Calibri, Arabic in Sakkal Majalla, the same Latin/Arabic split Word makes).
- Sizes: 10, 11, 12, 14, 16, 18, 20, 24pt.
- `content_style` = the paper's body CSS, so the editor looks like the print.
- Sanitizer (`ledger_html.py`): allow `font-family` only when every family is one of the four names above (or generic fallbacks); allow `table-layout`, `break-before`, `break-after`, `break-inside`, `page-break-*`.

## Fonts and licences (measured)

| Font | fsType | Licence | Delivery |
|---|---|---|---|
| Calibri | 8 | Microsoft-supplied, within Microsoft products | `local()` only |
| Sakkal Majalla | 8 | same | `local()` only |
| Univers Next Arabic | 4 | Linotype desktop licence | `local()` only |
| Noto Naskh Arabic | n/a | OFL, already bundled | served `@font-face` fallback |

None of the three is served as a web font. Office PCs and the server have them
installed; the server-rendered PDF embeds them (both fsType values allow
embedding in documents). **Phones show Noto Naskh** in the HTML view; the PDF
is exact. Univers Next Arabic must be installed on GSSGIT for PDFs to carry
it (user-only step at promotion).

## Tables

`.body table`: `inline-size: 100%`, `table-layout: fixed`, `margin-inline: auto`;
cells `overflow-wrap: anywhere`; `thead` repeats per page; `tr { break-inside: avoid }`.
HugeRTE `table_default_styles` match, so a new table is centred and never wider than the text.
Pasted Word tables with fixed pixel widths are clamped by `max-inline-size: 100%`.

## Preview

Today the preview scales one A4 page and clips the rest. The composer shows
the **real pages** of the server PDF (headless Edge, already used for the
Outlook draft) with pdf.js, the same viewer as `WordHandoffDialog`: scrollable
pages, page count, fit-width and zoom, refreshed after each autosave while the
preview is open.

## Issued books do not change

Each Revision stores `paper_preset` and `paper_layout` (integer, this work = 1).
The renderer branches on `paper_layout`; a later layout change bumps the number
and keeps the old branch. No Ledger Books exist in production yet (PR #268 is
unmerged), so no backfill is needed beyond defaulting dev rows to `normal`/1.

## Proof

- TDD on the sanitizer: every toolbar output (fonts, sizes, headings, tables, page breaks) survives `sanitize_body`; unknown font families are dropped.
- Backend tests (written first): references print and link by access; grade floor; folder filing at Save & Send; preset stored on the Revision; `paper_layout` pins rendering.
- Playwright screenshots of each preset in Arabic and English with a wide table, a Word-pasted table and a full bottom block; a Chromium PDF of each.
- Reviews: `i18n-rtl-reviewer`, `notification-template-reviewer`, `alembic-migration-reviewer` (one head).
