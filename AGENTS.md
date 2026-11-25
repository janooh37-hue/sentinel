# GSSG Manager

Local/LAN HR and document console: FastAPI (Python 3.12) backend, React/Vite/TypeScript frontend (built into the backend and served same-origin), SQLite, and Microsoft Word COM.

## Hosts & git workflow

- **One branch per change (`dev-cycle` skill):** cut every feature worktree from a freshly fetched `origin/main` (`git fetch origin && git worktree add -b <branch> .worktrees/<name> origin/main`) so migration and ADR numbers never collide with a lagging local `main`. Commit all edits on the feature branch; treat `dev` as a script-managed preview only.
- **Production (`GSSGIT`):** the main checkout is live production. Use a Git worktree for feature work, and ship only changes merged to `origin/main` (`deploy` skill) so `mng update` never overwrites them.
- **Heavy work (`dtop-writers` skill):** run parallel agents and full test suites on `dtop` (Linux), not on the laptop `GSSGLT`, which OOMs on combined frontend checks and takes ~25 min for full backend pytest.
- **Dev channel (`GSSGLT`):** read `docs/adr/0004-dev-channel-on-laptop-with-production-snapshot.md` before changing dev-channel setup (scheduler disabled, no `.email_key`/`.vapid_key`, tailnet-only).
- **Server migration:** read and follow `SERVER-MIGRATION.md` before starting any service, scheduler, sender, or connector against a copied production DB.
- **Remote Codex transports:** reach remotely only through Codex Remote Control's authenticated relay or SSH/VPN.
- **Working tree hygiene:** revert accidental Word resaves of `backend/templates/*.docx` before committing (commit only intentional template edits); keep `data/`, local PII, and generated static assets untracked.

## Commands & checks

- **Python venv:** `venv/bin/` on Linux (`dtop`); `venv/Scripts/` on Windows (`GSSGIT`/`GSSGLT`, use forward slashes). Frontend uses `pnpm -C frontend`; Windows service operations use `scripts/mng.ps1`.
- **Iteration & CI gotchas:** run the narrowest relevant test while iterating. `main` is not format-clean, so format only changed files (`ruff format <files>`). `mypy` is strict and `pytest` runs with `filterwarnings=error`. See `.github/workflows/checks.yml` for the PR gate list.

## Architecture & invariants

- **Backend flow:** `backend/app/main.py` -> `api/v1/` -> `services/` -> `core/` and `db/repos/`.
- **API contract:** `FastAPI -> backend/openapi.json -> frontend/src/lib/api.types.ts`. Builds use the committed types without regenerating; after route or Pydantic schema changes, run the `sync-api-types` skill and commit both files.
- **Frontend:** React Query for server state, react-hook-form + Zod for forms. Many record types have both desktop inline and mobile modal surfaces — wire per-record actions into both.
- **Permissions:** users without a capability never see the feature (no disabled or locked copies). Use the `permissions` skill before adding gated features, capabilities, role presets, or visibility changes.
- **DOCX/PDF:** tokenized `.docx` templates in `backend/templates/` convert to PDF via Word COM running as interactive `.\Admin` (not LocalSystem).
- **Brand:** use `frontend/public/brand/gssg-wordmark.png` (light) or `gssg-wordmark-on-dark.png` (dark). The globe emblem (`docs/brand/retired/`) is retired unless the user explicitly asks for the old logo.

## Required reviews

Reviewer prompts live in `.codex/agents/<name>.toml` (outside Codex, pass `developer_instructions` plus the diff against `origin/main` to a read-only reviewer):

- **UI strings, layouts, documents, or notifications** -> `i18n-rtl-reviewer` (Arabic and English are peers; `frontend/src/locales/{en,ar}.json`).
- **SMS, WhatsApp, push, or notification copy** -> `notification-template-reviewer` (`backend/app/services/notify_format.py`, `backend/app/services/sms_templates.py`).
- **Migrations or schema changes** -> `alembic-migration-reviewer`, the `new-migration` skill, and `backend/app/db/migrations/CLAUDE.md`.

## Pointers

- **Skills:** author in `.agents/skills/<name>/SKILL.md`, then run `scripts/sync_claude_skills.py` to keep `.claude/skills/` in sync (CI checks `--check`).
- **Plans:** keep planning docs in `mockups/plan/`.
- **Sentinel quality campaign:** read `mockups/plan/sentinel-quality-campaign.md` (or issue #203 if missing) before campaign work.
- **Product & UI tokens:** read `PRODUCT.md` and `DESIGN.md` when present.
