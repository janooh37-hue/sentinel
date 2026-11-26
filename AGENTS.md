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

Use the narrowest relevant check while iterating. The full backend suite takes about 25 minutes on `GSSGLT`: run it once, in the background, with no timeout. Combined frontend checks can exhaust memory on this host. `main` is not format-clean, so format only the files you change; `ruff format .` rewrites about 190 unrelated files. CI (`.github/workflows/checks.yml`) runs `ruff check`, `scripts/check_numbering.py`, a format check of changed files, `mypy` (zero errors required), the full backend suite sharded over 4 runners (`backend-tests`: `pytest -n auto`), the frontend `tsc -b --noEmit` type check, eslint (errors fail, warnings pass) and `vite build` (`frontend-static`), and the full Vitest suite (`frontend-tests`: `pnpm test`) on every pull request. Its `api-contract` check regenerates `backend/openapi.json` and `frontend/src/lib/api.types.ts` (the `sync-api-types` skill) and fails if either differs from what is committed. A new push to a PR cancels that PR's older run.

`mypy` checks against SQLAlchemy 2.1 typing, which is what CI installs: 2.1's `Select[A, B]` is variadic, while 2.0's `Select[tuple[A, B]]` is not, and no spelling fits both without losing row types. Production stays on 2.0.x, and `requirements.txt` allows both. A venv still on 2.0.x reports `Select` errors that CI does not; to type-check there, run `venv/Scripts/python.exe -m pip install "sqlalchemy>=2.1"` in that dev venv only, never on `GSSGIT`. Issue #360 tracks this gap between CI and production.

`main` is protected by a ruleset (`.github/rulesets/main.json`). It refuses direct pushes, force-pushes and deletion, so every change reaches `main` through a PR, merged as a merge commit. A PR can merge only when `backend-static`, `frontend-static`, `backend-tests` (the job that rolls up the shards), `frontend-tests` and `api-contract` are green; when every review conversation is resolved (fix the finding or resolve the thread to dismiss it); and when it is up to date with `main` ("Update branch", or `git merge origin/main` and push). No approval is required. The repository admin can bypass these rules only through a PR, never by pushing to `main`: use it when a required check cannot report or in an emergency, and the bypass shows on the PR. `python scripts/apply_ruleset.py` creates or updates the ruleset by name and sets the merge options (update branch, auto-merge and delete-branch-on-merge on; merge commits only); roll it back with `gh api -X DELETE repos/janooh37-hue/sentinel/rulesets/<id>` (ids from `gh api repos/janooh37-hue/sentinel/rulesets`).

Service operations:

```powershell
scripts/mng.ps1 status
scripts/mng.ps1 deploy
scripts/mng.ps1 update
scripts/mng.ps1 logs
```

`update` ships `origin/main` only when its GitHub checks are green; `update -Force` skips that check with a warning, for a hotfix while CI or GitHub is down. Deploys stay manual (`docs/adr/0011-deploys-stay-manual-no-runner-on-production.md`).

## Architecture

- Backend request flow: `backend/app/main.py` -> `backend/app/api/v1/` -> `backend/app/services/` -> `backend/app/core/` and `backend/app/db/repos/`.
- Generated API contract: FastAPI -> `backend/openapi.json` -> `frontend/src/lib/api.types.ts`. After route or Pydantic schema changes, use the `sync-api-types` skill and commit the generated TypeScript types.
- Frontend server state uses React Query; forms use react-hook-form and Zod.
- Record actions often have desktop and mobile surfaces. Update and verify both.
- Permissions: a user without the capability never sees the feature; no disabled, read-only, or locked copies of things they cannot do. Read the `permissions` skill before adding a gated feature, a capability, or a role preset, or before changing record visibility.
- DOCX rendering uses templates in `backend/templates/`; PDF conversion depends on Word COM running as the interactive `Admin` user.

## Brand

- Use the GSSG wordmark: `frontend/public/brand/gssg-wordmark.png` for light surfaces, `frontend/public/brand/gssg-wordmark-on-dark.png` for dark surfaces.
- The globe emblem is retired (`docs/brand/retired/`). Use it only when the user says "use the old logo".

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
