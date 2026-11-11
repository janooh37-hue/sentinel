---
name: "deploy"
description: "Deploy GSSG Manager to the production server (GSSGIT) after the user explicitly asks: confirm the work is merged to origin/main, show what will ship, run mng update on the server, and verify health."
---

# /deploy

Production is the Windows server `GSSGIT`. Its checkout (`C:\Users\Admin\sentinel`) only ever moves by `mng update`, which pulls `origin/main`, syncs dependencies, builds the frontend if it changed, migrates, smoke-checks and restarts. So a change ships by being merged to `origin/main` first. Nothing is edited, committed or built by hand on the server.

Deploy from the laptop (`GSSGLT`): `ssh gssgit` works there with a key, and the session is already administrator. The desktop (`dtop`) has no key for the server. Run the steps in order; stop and report on any failure.

## 1. Confirm it is merged

The PR is merged and `origin/main` contains it: `git fetch origin && git log --oneline -5 origin/main`. Unmerged work does not deploy; finish the `dev-cycle` first.

## 2. Show what will ship

```
ssh gssgit "git -C C:/Users/Admin/sentinel rev-parse HEAD"
git log --oneline <that commit>..origin/main
git diff --stat <that commit>..origin/main -- backend/app/db/migrations frontend requirements.txt
```

Summarise it for the user: the commits, whether a migration runs, whether the frontend rebuilds. If the server is already on `origin/main` there is nothing to deploy; say so and stop.

## 3. Check the server's tree

```
ssh gssgit "git -C C:/Users/Admin/sentinel status --short"
```

Untracked files are fine. Modified tracked files are usually `backend/templates/*.docx` re-saved by Word; they can block the pull. Show them to the user and ask before reverting anything on the server.

## 4. Deploy

```
ssh gssgit "mng update"
```

It takes a few minutes when the frontend rebuilds. If it prints `DEPLOY ABORTED`, the checkout moved but the service still runs the old build: report the error; do not retry blindly.

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
