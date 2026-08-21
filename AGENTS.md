# GSSG Manager

Local/LAN HR and document console: FastAPI/Python 3.12 backend, React/Vite/TypeScript frontend, SQLite, and Microsoft Word COM. The frontend builds into the backend and is served same-origin.

## Production safety

- This checkout is the live production checkout. Do not switch branches here; use a Git worktree for feature work.
- Never deploy changes that are not committed and pushed to `origin/main`; a later `mng update` would overwrite them.
- Do not commit secrets, `data/`, local PII, generated static assets, or accidental Word resaves of `backend/templates/*.docx`.
- Do not expose Codex app-server transports directly to the LAN or internet. Use Codex Remote Control's authenticated relay, or SSH/VPN for remote hosts.

## Commands

Run Python through `venv\Scripts\` and frontend commands through pnpm.

```powershell
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check .
venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
pnpm -C frontend run e2e
```

Use the narrowest relevant check while iterating. The full backend suite takes about 90 seconds; combined frontend checks can exhaust memory on this host.

Service operations:

```powershell
scripts\mng.ps1 status
scripts\mng.ps1 deploy
scripts\mng.ps1 update
scripts\mng.ps1 logs
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
- SQLite schema changes use `batch_alter_table`; populated NOT NULL columns need a default or backfill. Revision IDs are sequential `NNNN_slug` values.

## Project skills

- `deploy`: commit, push, build, restart, and verify the live service.
- `sync-api-types`: regenerate and validate the frontend API contract.
- `new-migration`: create one reversible, SQLite-safe migration on the current head.

Read `PRODUCT.md` for product voice and accessibility requirements, and `DESIGN.md` for UI tokens and interaction conventions when those files are present.
