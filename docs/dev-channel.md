# Laptop dev channel (GSSGLT)

One feature worktree at a time uses the shared, throwaway `C:\Users\GSSG\gssg-dev-data` snapshot. Never run this on GSSGAPP or point `GSSG_DATA_DIR` at production. See [ADR 0004](adr/0004-dev-channel-on-laptop-with-production-snapshot.md).

## Daily channel

The worktree `.worktrees\160-laptop-dev` holds branch `dev`, whose upstream is `origin/main`, so `git status -sb` shows unpromoted work (ahead) and new main commits (behind). `scripts\dev-channel.ps1` drives it:

| Verb | Effect |
| --- | --- |
| `open` (default) | Sync if behind and clean, start the server if down, launch the agent (`-Agent omp`, `claude`, or `codex`) in the worktree. |
| `sync` | Rebase `dev` on `origin/main`; reinstall deps if `requirements.txt`/lockfile changed; rebuild the frontend if `frontend/` changed; `alembic upgrade head`; restart. Refuses on uncommitted changes and aborts on conflicts. |
| `publish` | Build the frontend, migrate, restart. Use after local edits. |
| `restart` / `status` | Restart the detached `backend\serve.py` on 8765 / show branch and server health. |
| `promote` | Push `dev` commits to `origin/main` after confirmation. Refuses if main moved since the last sync. Then run `scripts\mng.ps1 update` on GSSGAPP. |

The server log is `.tmp\dev-server.log.err`. The `tailscale serve` proxy below should point at `http://127.0.0.1:8765`.

## Restore a backup

1. On GSSGLT, confirm **C:** is protected with BitLocker in an **elevated** PowerShell window: `manage-bde -status C:`. Require `Protection Status: Protection On` and `Percentage Encrypted: 100.0%`. Stop if this cannot be confirmed. Do not transfer HR data before this check.
2. Copy a completed `gssg-backup-YYYYMMDD-HHMMSS` directory made by `app.services.backup_service` from GSSGAPP to GSSGLT using a protected channel. Never copy the live `gssg.db`, its WAL sidecars, the production `.env`, `.email_key`, or `.vapid_key`. The backup contains a consistent SQLite snapshot and the record file trees.
3. Stop the dev backend. For a refresh, first move aside or remove the *old dev data directory* after checking its path; a changed branch may have advanced its Alembic revision. The command below refuses to overwrite any existing directory, including an empty one. In PowerShell on GSSGLT (replace only `$backup` with the actual copied backup path):

   ```powershell
   $backup = 'C:\path\to\gssg-backup-YYYYMMDD-HHMMSS'
   $devData = 'C:\Users\GSSG\gssg-dev-data'
   if (!(Test-Path -LiteralPath (Join-Path $backup 'gssg.db') -PathType Leaf)) { throw 'Backup is missing gssg.db' }
   if (Test-Path -LiteralPath $devData) { throw "Destination already exists: $devData" }
   New-Item -ItemType Directory -Path $devData -ErrorAction Stop | Out-Null
   try {
       Copy-Item -LiteralPath (Join-Path $backup 'gssg.db') -Destination $devData -ErrorAction Stop
       foreach ($name in 'vault', 'book_attachments', 'ledger_attachments', 'signatures', 'output', 'leave_certificates') {
           $source = Join-Path $backup $name
           if (Test-Path -LiteralPath $source -PathType Container) {
               Copy-Item -LiteralPath $source -Destination $devData -Recurse -ErrorAction Stop
           }
       }
   } catch {
       Write-Error "Incomplete restore at $devData; remove it before retrying. $_"
       throw
   }
   ```

   This allowlist excludes keys, logs, backups, and cache even if present in the source. Verify `gssg.db` and the expected file folders under `$devData` before starting. Keep the source backup until validation is complete.
   Keep the folder list in sync with `backend/app/services/backup_service.py`'s `_FILE_SUBDIRS`; a missing record tree makes a snapshot incomplete.

## Start a worktree

1. In the feature worktree, copy `.env.dev.example` to `.env`. Verify that `GSSG_DATA_DIR` points to the shared dev directory, `GSSG_DISABLE_SCHEDULER=1`, and there are **no** sender or BioTime environment variables inherited from the shell. Never copy secrets from production. Install Python dependencies into the worktree's `venv` and `pnpm -C frontend install` if needed.
   To test a scheduled feature briefly, set `GSSG_DISABLE_SCHEDULER=0` in the dev `.env`, restart uvicorn, then restore `1` and restart immediately afterward. Never enable senders or copy keys for this test.
2. Run `venv\Scripts\python.exe -m alembic upgrade head` in the worktree, then note the revision (`venv\Scripts\python.exe -m alembic current`). If switching back to a branch with an older revision, restore the snapshot again; do not downgrade production-shaped data to switch branches.
3. Start uvicorn on loopback: `venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765 --app-dir backend`. In a second worktree terminal set `$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = 'gssglt.<your-tailnet>.ts.net'` (use the exact DNS name from `tailscale status --json`; omit the trailing dot), then run `pnpm -C frontend dev --host 127.0.0.1`. Check `http://127.0.0.1:8765/api/v1/system/health` returns HTTP 200 and `status: ok`. The Vite frontend is at `http://127.0.0.1:5173`; its `/api` requests proxy to 8765. Stop any other worktree's dev processes before switching.
4. For a production-like UI check use `.\scripts\mng.ps1 build` in the worktree, then stop Vite and serve the built app via `venv\Scripts\python.exe backend\serve.py` on loopback instead.

## Tailnet-only HTTPS

On GSSGLT, with the backend and Vite running, run `tailscale serve --bg --https=443 http://127.0.0.1:5173`. Check `tailscale serve status` shows **Serve**, not Funnel, and no public URL. From another tailnet device open the HTTPS URL reported there, log in with an authorized dev account, and inspect the browser's Application > Service Workers panel to verify `/sw.js` is registered with scope `/` (HTTPS is required). A login check is not complete just because the page loads. Stop exposure with `tailscale serve --https=443 off` when done. The dev channel is reachable only while the laptop is awake; never use `tailscale funnel`.

## Promotion and rollback rehearsal

Before a real release, rehearse in a disposable worktree/branch: merge the feature branch into a temporary branch based on `main`, build and exercise the changed behavior against **dev data only**; record the Alembic revision before and after. Revert the merge in that temporary branch (or revert the feature commit), restore a fresh dev snapshot if migrations moved ahead, build and check health again. Do not run `mng update` on GSSGAPP as a dry run. A real promotion is admin-only: merge to `main`, push `origin/main`, then `scripts\mng.ps1 update` on GSSGAPP outside working hours. Real rollback is a revert on `main`, push, then `update`; record the applied revision for each release. The pre-migration backup from `mng.ps1` is the last resort.
