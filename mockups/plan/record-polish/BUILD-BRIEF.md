# Record page v2 — build brief

You are the build lead (Opus). You delegate; Sonnet subagents write the code. You own integration, verification and the pull request.

## Source of truth

`mockups/plan/record-polish/IMPLEMENTATION-PLAN.md`. All three area reviewers confirmed it (`review-{layout,preview,clarity}.md`). Implement every phase and every item. Do not shrink scope; if something is truly blocked, finish all other work and state the exact blocker in the PR body.

User requirements that must be visibly true in the PR:
1. Everything shown in `mockups/record-page-v2-prototype.html`: the record page polish (Delete on phone and the record page, ≤2-row header, collapsible rail, list tiers, labels and tooltips, signed copy first, focus mode, smart touches).
2. Every record, of any form type, shows who created it.
3. "Created by me" lets users find and follow the records they created.
4. Newest first is the default ordering.

## Hard rules

- **Never modify the production checkout** `/home/amh/Projects/sentinel` (no edits, no branch switch, no commits, no deploy, no `mng`). Work only in the worktree from plan Phase 0, on a new branch from `origin/main`.
- The planning artifacts are untracked in the production checkout. Copy them into the worktree and commit them in the PR:
  - `mockups/plan/record-polish/` (all `.md` files);
  - `mockups/record-page-v2-prototype.html`.
- Never run anything against the production `data/`. Use a scratch `GSSG_DATA_DIR` under `/tmp`, as the plan says.
- **Delegation:** every implementation subagent is a `task` with `model: "anthropic/claude-sonnet-5-5"`. Follow the plan's delegation map (§4): Phase 1 → 2 → 3 run sequentially, then the Phase 4 slices run in parallel with the file ownership the map gives them. Give each subagent its full slice text and its shared contracts. Subagents skip full suites mid-flight; you run verification after each phase.
- Follow `AGENTS.md`:
  - sync API types after schema changes, and commit the generated types;
  - exactly one Alembic head; SQLite-safe migration;
  - run the `i18n-rtl-reviewer` and `alembic-migration-reviewer` reviews if those agents/skills exist, otherwise do the equivalent review yourself against the checklist in the plan;
  - EN and AR are peers.
- Commits: logical, conventional messages (`feat(books): …`). No secrets, no `data/`, no generated static assets, no Word resaves of `backend/templates/*.docx`.

## Verification (before the PR)

Run the plan's §7 checklist:
- narrow checks per phase, then backend pytest + ruff + mypy and frontend test / lint / tsc / build (run the frontend checks one at a time, because memory is limited);
- the browser smoke at phone 390 / tablet 834 / laptop 1180 / desktop 1440 in EN and AR, using the built frontend served from the worktree with a scratch DB.

Record the actual results.

## Pull request

- Push the branch to `origin` and open a PR against `main` with `gh pr create`.
- Body:
  - summary per user requirement (1–4);
  - claim verdicts from plan §1;
  - migration note;
  - verification results, with the commands and outcomes;
  - screenshots or their paths if you can attach them;
  - known follow-ups or blockers.
- Do not merge and do not deploy.
- End your final message with `PR READY: <url>`.
