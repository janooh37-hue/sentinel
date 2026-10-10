# GSSG Manager

Local/LAN HR and document console: FastAPI/Python 3.12 backend, React/Vite/TypeScript frontend, SQLite, and Microsoft Word COM. The frontend builds into the backend and is served same-origin.

## Production safety

- On the production server (`GSSGAPP`), the main checkout is live production. Do not switch branches there; use a Git worktree for feature work.
- On every host, cut feature worktrees from a freshly fetched `origin/main` (`git fetch origin && git worktree add -b feat/x .worktrees/x origin/main`). Local `main` lags, and a stale base reuses migration and ADR numbers already taken on `origin/main`.
- The laptop `GSSGLT` is the dev channel: a production-backup snapshot restored to a dev data directory. Its `.env` sets `GSSG_DISABLE_SCHEDULER=1` and has no SMS, WhatsApp, or BioTime settings. Never copy `.email_key` or `.vapid_key` to it. Share it only via tailnet-only `tailscale serve`, never Funnel. See issue #160 and `docs/adr/0004-dev-channel-on-laptop-with-production-snapshot.md`.
- Never deploy changes that are not committed and pushed to `origin/main`; a later `mng update` would overwrite them.
- Do not commit secrets, `data/`, local PII, generated static assets, or accidental Word resaves of `backend/templates/*.docx`.
- Do not expose Codex app-server transports directly to the LAN or internet. Use Codex Remote Control's authenticated relay, or SSH/VPN for remote hosts.
- Before moving production to another Windows host, read and follow `SERVER-MIGRATION.md`. Never start the destination backend, scheduler, notification senders, or Cloudflare connector against a copied production database while the source application is still writable.

## Commands

Run Python through `venv/Scripts/` and frontend commands through pnpm. Use forward slashes: they work in PowerShell and in bash, which strips backslashes.

```powershell
venv/Scripts/python.exe -m pytest
venv/Scripts/ruff.exe check .
venv/Scripts/ruff.exe format <files you changed>
venv/Scripts/mypy.exe
venv/Scripts/python.exe scripts/check_numbering.py
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
pnpm -C frontend run e2e
```

Use the narrowest relevant check while iterating. The full backend suite takes about 25 minutes on `GSSGLT`: run it once, in the background, with no timeout. Combined frontend checks can exhaust memory on this host. `main` is not format-clean, so format only the files you change; `ruff format .` rewrites about 190 unrelated files. CI (`.github/workflows/checks.yml`) runs `ruff check`, `scripts/check_numbering.py`, and a format check of changed files on every pull request.

Service operations:

```powershell
scripts/mng.ps1 status
scripts/mng.ps1 deploy
scripts/mng.ps1 update
scripts/mng.ps1 logs
```

## Architecture

- Backend request flow: `backend/app/main.py` -> `backend/app/api/v1/` -> `backend/app/services/` -> `backend/app/core/` and `backend/app/db/repos/`.
- Generated API contract: FastAPI -> `backend/openapi.json` -> `frontend/src/lib/api.types.ts`. After route or Pydantic schema changes, use the `sync-api-types` skill and commit the generated TypeScript types.
- Frontend server state uses React Query; forms use react-hook-form and Zod.
- Record actions often have desktop and mobile surfaces. Update and verify both.
- DOCX rendering uses templates in `backend/templates/`; PDF conversion depends on Word COM running as the interactive `Admin` user.

## Required reviews

- Arabic and English are peers. After UI strings, layouts, documents, or notifications change, run the `i18n-rtl-reviewer`; use logical CSS properties and verify both directions.
- After SMS, WhatsApp, push, or notification formatting changes, run the `notification-template-reviewer`.
- After migrations or schema changes, run the `alembic-migration-reviewer` and confirm exactly one Alembic head.
- Reviewer definitions live in `.codex/agents/<name>.toml`; outside Codex, give a read-only reviewer that file's `developer_instructions` plus the diff against `origin/main`.
- SQLite schema changes use `batch_alter_table`; populated NOT NULL columns need a default or backfill. Revision IDs are sequential `NNNN_slug` values.

## Project skills

- `deploy`: commit, push, build, restart, and verify the live service.
- `sync-api-types`: regenerate and validate the frontend API contract.
- `new-migration`: create one reversible, SQLite-safe migration on the current head.

## Planning artifacts

Keep plans in `mockups/plan/`. New planning documents belong there instead of a top-level `Plans/` directory.

For Sentinel quality-campaign work, first read `mockups/plan/sentinel-quality-campaign.md` and its linked issue/PR progress. Follow the current priority phase and approved TDD checks; append related evidence, blockers, and handoff updates to that plan. Keep unrelated notes out. Work in isolated branches; only the user approves merges and deployments. If the plan is missing, stop and retrieve the canonical plan from campaign issue #203 before proceeding.

Read `PRODUCT.md` for product voice and accessibility requirements, and `DESIGN.md` for UI tokens and interaction conventions when those files are present.
