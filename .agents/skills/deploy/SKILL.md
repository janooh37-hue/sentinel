---
name: "deploy"
description: "Deploy GSSG Manager safely after the user explicitly asks: inspect changes, commit and push origin/main, build, restart, and verify health."
---

# /deploy — ship local changes to the live GSSG Manager service

**This working copy is the production server.** `mng update` does `git pull
--ff-only` then rebuilds — so any local change that is not committed and pushed
to `origin/main` is at risk of being blown away on the next update. Never deploy
work that only exists in the working tree.

Run these steps in order. Stop and report if any step fails; do not paper over
a failure.

## 1. Show what will ship
```
git status
git --no-pager diff --stat
```
Summarise the pending changes for the user. If the tree is clean and `HEAD` is
already on `origin/main`, skip to step 4 (nothing to commit — just a rebuild).

## 2. Commit (only if there are changes)
- Confirm the changes are intended to go live now. If anything looks like
  churn (e.g. `backend/templates/*.docx` re-saved by the running service /
  Word — a known gotcha), revert that noise before committing.
- Commit with a clear message following the repo's footer convention.
- Do **not** commit secrets or `data/` (already gitignored) — sanity-check the
  staged list.

## 3. Push to origin/main (the invariant)
```
git push origin main
```
This must succeed before the deploy is considered durable. If the push is
rejected (remote ahead), stop and resolve — do not force-push a production
branch.

## 4. Build + restart the live service
Local code changes are applied by `mng deploy` (build frontend → copy into
`backend/app/static` → restart the `GSSGManager` service). It auto-elevates via
UAC when needed.
```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\mng.ps1 deploy
```
- `mng deploy` uses the **committed** `api.types.ts` and does **not** regenerate
  OpenAPI types. If this change altered backend request/response schemas, run
  `/sync-api-types` FIRST (or `scripts\build.ps1`), commit the regenerated
  `api.types.ts`, then deploy — otherwise the frontend ships against stale types.

## 5. Verify it came back healthy
```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\mng.ps1 status
```
Confirm: service **Running**, health **ok**, and the version bumped as expected.
Report the final status to the user. If health is not `ok` within the wait
window, tail the log to diagnose:
```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\mng.ps1 logs -Stderr -Tail 60
```

## Notes
- `mng deploy` applies LOCAL code; `mng update` pulls first. On this box you
  normally use `deploy` (you already have the code) — the git push in step 3 is
  what protects that local code from being overwritten later, it is not what
  ships it.
- Never skip the push. A deployed-but-unpushed production is a landmine.

