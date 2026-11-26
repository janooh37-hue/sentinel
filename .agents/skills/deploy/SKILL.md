---
name: "deploy"
description: "Deploy GSSG Manager to the production server (GSSGIT) after the user explicitly asks: confirm origin/main is merged and its checks are green, show what will ship, run mng update on the server, and verify health."
---

# /deploy

Production is the Windows server `GSSGIT`. Its checkout (`C:\Users\Admin\sentinel`) only ever moves by `mng update`, which fetches `origin/main`, refuses it unless its GitHub checks are green, then pulls it, syncs dependencies, builds the frontend if it changed, migrates, smoke-checks and restarts. So a change ships by being merged to `origin/main` and going green first. Nothing is edited, committed or built by hand on the server. Deploys stay manual; see `docs/adr/0011-deploys-stay-manual-no-runner-on-production.md`.

Deploy from the laptop (`GSSGLT`): `ssh gssgit` works there with a key, and the session is already administrator. The desktop (`dtop`) has no key for the server. Run the steps in order; stop and report on any failure.

## 1. Confirm it is merged and green

The PR is merged and `origin/main` contains it: `git fetch origin && git log --oneline -5 origin/main`. Unmerged work does not deploy; finish the `dev-cycle` first.

Then read the checks of the commit that will ship, the same check `mng update` makes on the server:

```
sha=$(git rev-parse origin/main)
gh api "repos/janooh37-hue/sentinel/commits/$sha/check-runs?per_page=100" --jq '"total_count \(.total_count)", (.check_runs[] | "\(.name) \(.status) \(.conclusion)")'
gh api "repos/janooh37-hue/sentinel/commits/$sha/status?per_page=100" --jq '"total_count \(.total_count)", (.statuses[] | "\(.context) \(.state)")'
```

The commit is **green** when at least one check run or status is listed, every check run is `completed` with `success`, `neutral` or `skipped`, and every status is `success`. Each call lists at most 100 entries after its `total_count` line: if it lists fewer than `total_count`, it is not green. A failure, a check still running, no checks yet, a partial listing, or GitHub not answering is not green: stop, and report the commit and the checks that are not green to the user. Continue only once it is green, or when the user explicitly asks to force this deploy (step 4).

## 2. Show what will ship

```
ssh gssgit "git -C C:/Users/Admin/sentinel rev-parse HEAD"
git log --oneline <that commit>..origin/main
git diff --stat <that commit>..origin/main -- backend/app/db/migrations frontend requirements.txt
```

Summarise it for the user: the commits, whether a migration runs, whether the frontend rebuilds.

If the server's checkout is already on `origin/main`, there is nothing to pull, but that does not prove the service runs that code: an aborted `mng update` moves the checkout and restarts nothing. Compare when the checkout last moved with when the service started:

```
ssh gssgit "git -C C:/Users/Admin/sentinel reflog -1 --date=iso --format=%gd"
ssh gssgit "mng status"
```

- Service **Running**, health **ok**, and started (now minus **Uptime**) after the checkout moved: the last deploy finished. Say there is nothing to deploy and stop.
- Service started before the checkout moved, or it is not healthy: the last update did not finish and the old build is still running. Tell the user, do step 3, then recover with `ssh gssgit "mng deploy"` in place of step 4, and verify (step 5).

## 3. Check the server's tree

```
ssh gssgit "git -C C:/Users/Admin/sentinel status --short"
```

Untracked files are fine. Modified tracked files are usually `backend/templates/*.docx` re-saved by Word; they can block the pull. Show them to the user and ask before reverting anything on the server.

## 4. Deploy

```
ssh gssgit "mng update"
```

It takes a few minutes when the frontend rebuilds. If it refuses with `not green`, `origin/main` moved or its checks changed since step 1: report it and go back to step 1. Only when the user explicitly asks to force the deploy (a hotfix while CI or GitHub is down), run `ssh gssgit "mng update -Force"`; it skips the green check and prints a warning. If it prints `DEPLOY ABORTED`, the checkout moved but the service still runs the old build: report the error; do not retry blindly. Once the cause is fixed, finish with `ssh gssgit "mng deploy"`; `mng update` would now find nothing to pull and deploy nothing.

## 5. Verify

```
ssh gssgit "mng status"
```

Service **Running**, health **ok**. If not: `ssh gssgit "mng logs -Stderr -Tail 60"` and report.

## Notes

- On GSSGIT itself, the same steps without `ssh gssgit`: `mng status`, `mng update`.
- `mng deploy` rebuilds from the server's local checkout without pulling. It is for recovering from an aborted update, not for shipping changes.
- `mng update` uses the committed `frontend/src/lib/api.types.ts`. Route or schema changes must have gone through the `sync-api-types` skill before the PR merged.
- Rollback is a revert on `main` through a PR, then `mng update` again.
