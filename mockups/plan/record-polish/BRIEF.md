# Record page UX polish — shared brief

Goal: an audit that feeds one final prototype of a smarter, more convenient record page.
The coordinator (main agent) merges the three tab reports into that prototype. You are one tab lead.

## Surface in scope

- `/books/:id` → `frontend/src/pages/books/BookRecordPage.tsx` (header workflow bar, Tools dropdown, mobile dock, timeline, document desk)
- Inline record pane on the books list → `frontend/src/pages/books/RecordPane.tsx`, `frontend/src/components/books/BookDetailDrawer.tsx`
- List/table that opens records → `frontend/src/pages/books/BooksPage.tsx`, `RecordsList.tsx`, `BooksFilterBar.tsx`
- Preview/document pieces → `BookPreview.tsx`, `RecordPaperViewer.tsx`, `IncludedPapersDialog.tsx`, `ApprovalPreviewDialog.tsx`, `BookAnnotationLayer.tsx`, `DocPdfCanvas`
- Actions → `SavedRecordActions.tsx`, `BookWordActions.tsx`, `RecordStateOverrideDialog.tsx`, `HeaderBtn.tsx`
- Prior polish already shipped: commit `b5e7dbd5`, plan `mockups/plan/record-page-polish.md` (if present), mockup `mockups/record-page-polish-proposal.html`. Do not re-propose what already landed; build on it.

## User's complaints (ground truth, verbatim intent)

1. Phone view has no Delete option.
2. Mid-size screens (tablet / small laptop, "not fully wide or small enough to be desktop") look crowded and unresponsive; table views feel cramped.
3. Icons are fine but there is not enough indication of what they do.
4. Preview does not collapse/expand to give more room to the items in it.
5. For an approved record, the preview should show the signed version first, not the unsigned original.
6. General: "small things that make the app feel smart and convenient" — many are needed.

## Hard rules

- READ-ONLY on source. This is the live production checkout: never edit app code, never switch branches, never commit, never run deploy/mng, never start backend services against `data/`.
- The only file you write is your report: `mockups/plan/record-polish/<your-slug>.md`.
- Delegate investigation to subagents via the `task` tool with `model: "anthropic/claude-sonnet-5-5"` on every task item. You (Opus) design the slices, verify their claims against code, dedupe, and write the final report.
- Arabic and English are peers (RTL). Desktop and mobile are both first-class. Note i18n/RTL impact of every proposal.
- Read `DESIGN.md` and `PRODUCT.md` (repo root) for tokens, voice, accessibility when present.

## Report format (`mockups/plan/record-polish/<slug>.md`)

1. **Findings** — table: id, problem, evidence (`file:line`), affected widths (phone <640 / tablet 640–1024 / laptop 1024–1440 / desktop ≥1440), severity (high/med/low).
2. **Proposals** — per finding: the concrete change, component(s) touched, desktop + mobile + RTL behavior, risk, effort (S/M/L).
3. **Prototype spec** — what the final screen must show for your area, precise enough to build an HTML mock: layout per breakpoint, exact controls and labels (EN + AR), states to demo (e.g. approved+signed, draft, returned, Word session active, no document).
4. **Open questions** for the user, only if a real tradeoff exists.

Keep it evidence-first and terse. When done, end your final chat message with the line `REPORT READY: mockups/plan/record-polish/<slug>.md`.
