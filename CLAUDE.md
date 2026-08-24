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

All Python runs through the repo venv (`venv\Scripts\...`); frontend uses pnpm.

```bash
# Backend
venv\Scripts\python.exe -m pytest                      # all backend tests
venv\Scripts\python.exe -m pytest backend/tests/test_x.py::test_name   # one test
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check . # lint/format
venv\Scripts\mypy.exe                                  # strict typecheck (config in pyproject)
venv\Scripts\alembic.exe upgrade head                  # apply migrations

# Frontend (from repo root)
pnpm -C frontend test                                  # vitest (all)
pnpm -C frontend exec vitest run src/path/foo.test.tsx # one test file
pnpm -C frontend run lint                              # eslint
pnpm -C frontend exec tsc -b --noEmit                  # typecheck
pnpm -C frontend run build                             # tsc + vite build -> backend static dir
pnpm -C frontend run e2e                               # playwright

# Run / operate the service (scripts/mng.ps1; deploy/update auto-elevate via UAC)
scripts\mng.ps1 status        # service state, health, version, RAM, URL
scripts\mng.ps1 deploy        # build + restart (apply local code changes)
scripts\mng.ps1 update        # git pull; if changed -> build + restart
scripts\mng.ps1 logs          # tail service log (-Stderr for the error log)
```

## Architecture

**Request flow (backend):** `app/main.py` is the app factory — it mounts each
`app/api/v1/<domain>.py` router, installs error handlers, a body-size-limit
middleware, and the SSE/scheduler lifespan. Routers are thin: they depend on
`app/api/deps.py` (auth via `get_current_user`, permission gates) and delegate
all logic to `app/services/*_service.py`. Services orchestrate; reusable
pure/domain logic lives in `app/core/` (document rendering, PDF chain, leave
calc, permissions, Arabic/RTL, signatures). Persistence is SQLAlchemy models in
`app/db/models.py` with `app/db/repos/` for queries. **DB is SQLite** — this
shapes the schema (see Migrations).

**Frontend↔backend contract is generated, not hand-written.** The chain is
`backend FastAPI app → backend/openapi.json → frontend/src/lib/api.types.ts`.
`mng build`/`deploy` use the **committed** `api.types.ts` and do NOT regenerate.
So after any backend Pydantic schema / route change you MUST resync the types
(the `/sync-api-types` skill: dump openapi, run `pnpm gen:api`, typecheck) and
commit `openapi.json` + `api.types.ts` together, or the frontend drifts silently.

**Frontend** is React Query for server state, Radix + Tailwind 4 for UI,
react-hook-form + Zod for forms. Pages in `src/pages/`, shared UI in
`src/components/`. Many record types have **two detail surfaces** — desktop
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

Revision IDs are hand-numbered `NNNN_<slug>` (not Alembic hashes). Keep a
**single linear head** — a split history once forced an emergency merge revision.
SQLite can't `ALTER` most constraints in place: wrap alters in
`op.batch_alter_table`, omit named FKs to existing tables (enforce integrity
app-side), and give NOT-NULL-on-populated-table columns a `server_default`. Use
the `/new-migration` skill to scaffold safely and the `alembic-migration-reviewer`
agent to review; the `alembic-heads-guard` hook warns on a split head.

## Gotchas

- **Template churn:** `backend/templates/*.docx` get re-saved by the live service
  / Word during operation. Revert that churn before committing — it can break
  Jinja tokens. Only commit intentional template edits.
- **Local `.claude/` tooling** (hooks: ruff/mypy-on-edit, heads-guard; reviewer
  agents; `/deploy`, `/sync-api-types`, `/new-migration` skills) is local-only /
  gitignored. Hooks load at session start — reload after editing them.
- Strict gates are real: mypy is `strict`, pytest runs with `filterwarnings=error`.
