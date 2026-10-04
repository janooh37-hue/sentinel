# Record page v2 — implementation plan brief

You write `mockups/plan/record-polish/IMPLEMENTATION-PLAN.md`: an implementation plan a separate build agent will follow end to end. Plan only — do not edit app code.

## Inputs (read first)

- `mockups/plan/record-polish/{layout,preview,clarity}.md` — audit reports with file:line evidence.
- `mockups/record-page-v2-prototype.html` — the approved prototype (final target UX). Its notes panel lists the defaults chosen for the open questions; treat those defaults as decisions.
- `AGENTS.md`, `DESIGN.md`, `PRODUCT.md`.

## Scope (all required)

A. **Record page polish** — everything the prototype shows: Delete on every surface (with gating fix, deferred-commit Undo), phone dock + More sheet, ≤2-row header, collapsible progress rail, list responsive tiers + pane collapse/normal/wide, labelled actions + tooltips/Kbd + disabled reasons, one primary per state + status line, signed-copy-first `defaultPaper` shared by page/pane/approval dialog, paper switcher + fit/zoom/page counter + focus mode, Word-session banner, error/retry states, copy ref + document.title, context-preserving Back + J/K queue from any list, keyboard layer, missing i18n keys, removal of dead `BookDetailDrawer`.

B. **Creator on every record** (new user requirement). Every book/record, of any form/service type, must show who created it in its details (record page header meta, list pane, phone card). The user believes only "general" books carry the creator today. Verify in backend models/schemas/services which book kinds store and expose the creator, and plan the fix (backfill strategy for existing rows if the data exists elsewhere, e.g. versions/audit log; migration only if needed; regenerate API types via the `sync-api-types` skill).

C. **"My records" tracking** (new). A user currently has no way to find and follow the books they created. Plan a "Created by me" filter/view on `/books` (desktop spine/rail and phone filter bar; persisted in the URL) and, if cheap, a count/entry point from the user's account/dashboard. Server-side filtering preferred over client-side.

D. **Newest first** (new). The Approved list shows the oldest first. Make newest-first the default sort for every status filter (verify current ordering in API and frontend; fix at the source).

## Verification duty

Before planning B, C, D, confirm or refute each user claim with evidence (file:line, and a query against a scratch copy or test DB if needed — never the production `data/`). Record the verdicts at the top of the plan.

## Plan format

1. Verdicts on claims B/C/D.
2. Phases in dependency order (backend → API types → frontend), each with: files, concrete changes, tests to add/update (follow repo test rules: behavior-level, no wording pins), i18n EN+AR keys, desktop + mobile + RTL notes, required reviews (`i18n-rtl-reviewer`, `alembic-migration-reviewer` if schema changes, exactly one Alembic head).
3. Delegation map for the builder: slices that Sonnet subagents can implement in parallel without file conflicts, and the shared contracts between them.
4. Verification checklist: narrow commands per phase, then the full suites from AGENTS.md, plus a browser smoke script covering phone 390 / tablet 834 / laptop 1180 / desktop 1440 in EN and AR.
5. Risks and rollback.

## Rules

- Production checkout: read-only on source, no branch switching, no commits, no services against `data/`.
- Delegate exploration to `task` subagents with `model: "anthropic/claude-sonnet-5-5"` on every task item; you verify and write.
- When done, end your final message with `PLAN READY: mockups/plan/record-polish/IMPLEMENTATION-PLAN.md`.
