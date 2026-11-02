# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GSSG Manager — a local/LAN HR console: document generation from tokenized Word
templates, approval chains, leave tracking, per-user email mailboxes, and
multi-channel notifications. FastAPI (Python 3.12) backend + React 19 (Vite/TS)
frontend served **same-origin** (the frontend builds into the backend's static
dir). Runs as an always-on Windows service on the office LAN behind Caddy.

**This checkout is the live production build.** `mng update` pulls `origin/main`
onto the office server, so every fix must be committed **and pushed to
`origin/main`** or the next pull silently overwrites it. Test on a branch; merge
to `main` when ready.

## Commands

All Python runs through the repo venv (`venv/Scripts/...`, forward slashes: bash
strips backslashes); frontend uses pnpm. Cut feature worktrees from a freshly
fetched `origin/main`; a stale base reuses migration and ADR numbers.

```bash
# Backend
venv/Scripts/python.exe -m pytest                      # all backend tests (~25 min on GSSGLT: run once, in background)
venv/Scripts/python.exe -m pytest backend/tests/test_x.py::test_name   # one test
venv/Scripts/ruff.exe check . && venv/Scripts/ruff.exe format <changed files>  # main is not format-clean
venv/Scripts/mypy.exe                                  # strict typecheck (config in pyproject)
venv/Scripts/python.exe scripts/check_numbering.py     # single Alembic head, unique ADR numbers (CI runs it)
venv/Scripts/alembic.exe upgrade head                  # apply migrations

# Frontend (from repo root)
pnpm -C frontend test                                  # vitest (all)
pnpm -C frontend exec vitest run src/path/foo.test.tsx # one test file
pnpm -C frontend run lint                              # eslint
pnpm -C frontend exec tsc -b --noEmit                  # typecheck
pnpm -C frontend run build                             # tsc + vite build -> backend static dir
pnpm -C frontend run e2e                               # playwright

# Run / operate the service (scripts/mng.ps1; deploy/update auto-elevate via UAC)
scripts/mng.ps1 status        # service state, health, version, RAM, URL
scripts/mng.ps1 deploy        # build + restart (apply local code changes)
scripts/mng.ps1 update        # git pull; if changed -> build + restart
scripts/mng.ps1 logs          # tail service log (-Stderr for the error log)
```

## Architecture

**Frontend↔backend contract is generated, not hand-written.** The chain is
`backend FastAPI app → backend/openapi.json → frontend/src/lib/api.types.ts`.
`mng build`/`deploy` use the **committed** `api.types.ts` and do NOT regenerate.
So after any backend Pydantic schema / route change you MUST resync the types
(the `/sync-api-types` skill: dump openapi, run `pnpm gen:api`, typecheck) and
commit `openapi.json` + `api.types.ts` together, or the frontend drifts silently.

**Frontend:** many record types have **two detail surfaces** — desktop
inline (report/RecordExpansion) and a mobile modal (TabRecords) — per-record
actions must be wired into BOTH.

**Documents** render from tokenized `.docx` templates in `backend/templates/`
(docxtpl/Jinja) → PDF via `core/pdf_chain.py`. DOCX→PDF uses Word COM, so the
service must run as a real interactive user (`.\Admin`), not LocalSystem, or
`pdf_path` stays NULL. Signature images embed via `*_sig_path` → `{{ *_sig }}`
tokens (see `core/signature_render.py`).

**Notifications** are multi-channel: in-app SSE, Web Push (VAPID), WhatsApp (via
Infobip BSP), and SMS (via an on-site Android SMS-gateway). Wording flows through
`services/notify_format.py` + `services/sms_templates.py`; channels are gated by
`GSSG_*` env/settings and stay dormant until provisioned.

## Bilingual (Arabic/English) + RTL — the #1 recurring defect

Arabic is first-class. The classic bug is English leaking into Arabic
(untranslated enum/status values, EN→AR fallback rendering the English, missing
key parity). UI strings live in `frontend/src/locales/{en,ar}.json` (via
`lib/i18n.ts`); notification/document copy and canonical AR↔EN label maps live in
`services/notify_format.py` + `services/sms_templates.py`. Use logical CSS
(`ms-`/`me-`, `text-start`/`text-end`, `dir`) not hard left/right. After touching
any bilingual surface, run the `i18n-rtl-reviewer` and
`notification-template-reviewer` agents.

## Migrations (Alembic on SQLite)

Keep a **single linear head** (CI's `scripts/check_numbering.py` fails a split
one). SQLite-specific rules live in `backend/app/db/migrations/CLAUDE.md`.

## Gotchas

- **Template churn:** `backend/templates/*.docx` get re-saved by the live service
  / Word during operation. Revert that churn before committing — it can break
  Jinja tokens. Only commit intentional template edits.
- **Agent tooling** is committed: reviewer agents in `.codex/agents/`, skills in
  `.agents/skills/`, hook scripts in `.claude/hooks/` and `.codex/hooks/`.
  Hooks load at session start — reload after editing them.
- Strict gates are real: mypy is `strict`, pytest runs with `filterwarnings=error`.

## Planning artifacts

Keep plans in `mockups/plan/`. New planning documents belong there instead of a top-level `Plans/` directory.
