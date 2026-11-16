---
name: "dev-cycle"
description: "Fix bugs and add features: one feature branch per change, cut from origin/main in its own worktree, previewed on the laptop dev URL, sent to main through its own PR. Use for any fix, feature, or template change."
---

# /dev-cycle

## The rule

One branch owns a change from its first commit to its merge. The branch is cut from `origin/main`, every edit is committed on it, the user tests it on the dev URL, and its PR goes to `main`.

`dev` is a preview, not a place to work: `origin/main` plus merges of the branches under test, rebuilt by a script. Never edit, commit, or cherry-pick in the dev worktree, and never copy commits between `dev` and a feature branch in either direction. Carrying the same change on two branches under different commit ids is what made PRs conflict at merge time.

When the user says "put it on dev", "add this to the worktree too", or "make the worktree match dev", the action is always the same: commit on the feature branch, then `preview` it again.

## Locations

- **Feature worktrees:** on the desktop, `~/Projects/sentinel/.worktrees/<name>` (`ssh dtop`). See the `dtop-writers` skill for starting agents there.
- **Dev channel:** on the laptop, worktree `C:\Users\GSSG\projects\sentinel\.worktrees\160-laptop-dev`, branch `dev`. Use absolute paths; relative paths from another checkout hit main.
- **Control:** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-channel.ps1 <verb>` from the dev worktree.

  | Verb | Effect |
  | --- | --- |
  | `status` | Main, previewed branches (and whether each has newer commits), stray work, server health. |
  | `preview <branch>` | Fetch the branch from dtop (`desk`) and `origin`, merge its newest tip onto `origin/main` with the other previewed branches, publish. Run it again after every new commit. |
  | `drop <branch>` | Take a branch off the preview, publish. |
  | `sync` | Rebuild on the latest `origin/main` and the latest of every previewed branch; merged or deleted branches leave the preview. |
  | `publish` / `restart` | Build frontend, migrate, restart / restart only. |

- **Server:** `backend\serve.py` on 127.0.0.1:8765, started detached; log `.tmp\dev-server.log.err`.
- **URL:** `https://gssglt.<your-tailnet>.ts.net/` (tailnet only; the real host is in the gitignored dev `.env`). The user is on the laptop or a phone: never give a `localhost` link.
- **Dev data:** `C:\Users\GSSG\gssg-dev-data` (throwaway snapshot; never production).
- **Production:** GSSGIT, through the `deploy` skill.

## Cycle

1. **Start:** fetch, then cut the branch from `origin/main`, never from `dev` or local `main`:
   `ssh dtop 'cd ~/Projects/sentinel && git fetch origin && git worktree add -b <branch> .worktrees/<name> origin/main'`
2. **Understand:** trace the code; reproduce the bug.
3. **Gate:** ask if a gate fires; otherwise proceed.
4. **Build:** in the feature worktree, own hunks only, one commit per change.
5. **Verify:**
   - Backend: narrowest pytest in the feature worktree.
   - Documents: generate → PDF → PNG → inspect the reported defect (laptop; needs Word).
   - Required `AGENTS.md` reviews.
6. **Preview:** `dev-channel.ps1 preview <branch>` on the laptop. It reads the branch straight from dtop, so no push is needed first. Tell the user what to test and give the dev URL.
7. **Fix what testing finds:** in the same feature worktree. Commit, then `preview <branch>` again.
8. **PR (gate):** after the user approves what they saw. From the feature worktree: `git fetch origin && git merge origin/main` if main moved, re-run the checks, run the routing audit below, `git push -u origin <branch>`, `gh pr create --base main`. The PR contains exactly the commits the user tested.
9. **After the merge:** `dev-channel.ps1 sync` (the merged branch leaves the preview), then remove the worktree and branch on dtop. Deploy only when the user asks.

## When branches collide

- **`preview` refuses with conflicts.** dev is left as it was. Either the branch is behind main (`git merge origin/main` in its worktree) or it overlaps another previewed branch: preview them one at a time with `drop`, or merge the first PR and bring main into the second.
- **Two previewed branches each add a migration.** dev gets two Alembic heads and `publish` fails. Preview one at a time. The branch that merges second takes main in and renumbers with the `new-migration` skill.
- **A dropped branch had a migration.** The dev database is now ahead of the code; restore a fresh snapshot (`docs/dev-channel.md`).
- **`status` reports stray commits or edits on dev.** Someone worked there. Cherry-pick each commit into the worktree of the branch it belongs to, or recreate the edit there, and push. Then `git reset --hard origin/main` in the dev worktree and `sync`. The `.githooks/pre-commit` hook blocks plain commits on dev; cherry-picks and edits added while committing a merge get past it, which is why `sync` and `publish` also refuse.
- **New work depends on an unmerged branch.** Cut it from that branch, say so in the PR, and merge `origin/main` in once the first PR lands.

## Routing audit before the PR

Word reaches the server through `ms-word:ofe|u|{GSSG_PUBLIC_BASE_URL}/dav/...`. On the laptop that base URL is the tailnet dev host, set only in the gitignored dev `.env`; production sets its own. Never commit the dev host, change the `public_base_url` default, or alter Word/WebDAV URL building to make dev work.

Read `git diff origin/main...<branch>` and the PR text. Grep added lines for non-placeholder `ts.net`, `127.0.0.1` / `localhost` / `8765` used as a Word/DAV base, and changes to `GSSG_PUBLIC_BASE_URL`, `public_base_url`, `/dav`, or `word_url`.

## Gates (ask)

- Request can't work or breaks something: measure, offer options, recommend one.
- Changes the user's spec.
- Push to `origin`, open or merge a PR, deploy.
- Destructive: delete worktree/branch, restore snapshot, `git reset --hard` on dev when `status` shows stray work.
- User-only: credentials, Tailscale, BitLocker, physical scans.

## Rules

- Dev `.env`: scheduler off, no SMS/WhatsApp/BioTime, no `.email_key`/`.vapid_key`. Never copy dev data or `.env` to the desktop.
- Word COM: one conversion at a time; kill only your WINWORD.
- `.docx`: edit XML; never resave in Word.
- Other sessions' hunks, worktrees and agents: leave alone.
- Always auto-plan. Heavy or parallel work runs on dtop (`dtop-writers`); the laptop keeps the dev channel, Word/document checks and light orchestration.
