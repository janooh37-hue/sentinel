---
name: "dev-cycle"
description: "Fix bugs and add features on the laptop dev channel (one worktree per work item off main; dev is a disposable test merge); user tests on the dev URL before promotion. Use for any fix, feature, or template change."
---

# /dev-cycle

## Locations

- Dev worktree: `C:\Users\GSSG\projects\sentinel\.worktrees\160-laptop-dev`, branch `dev` = `origin/main` + work branches under test. Disposable; never commit or PR from it.
- Work worktree: `C:\Users\GSSG\projects\sentinel\.worktrees\<x>`, branch `work/<x>` cut from `origin/main`. Absolute paths only.
- Control: `scripts\dev-channel.ps1` (`status`, `rebuild`, `publish`, `restart`), run from the dev worktree with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-channel.ps1 <verb>`.
- Server: `backend\serve.py` on 127.0.0.1:8765, started detached by the script; log `.tmp\dev-server.log.err`.
- URL: `https://gssglt.<your-tailnet>.ts.net/` (tailnet only; actual host lives in the gitignored dev `.env`)
- Dev data: `C:\Users\GSSG\gssg-dev-data` (throwaway snapshot; never production)
- Main checkout: untouched.

## Cycle

1. **Start:** `git fetch origin && git worktree add -b work/<x> .worktrees/<x> origin/main`. Dirty dev worktree → ask whose changes they are.
2. **Understand:** trace the code; reproduce the bug.
3. **Gate:** ask if a gate fires; otherwise proceed.
4. **Build:** in the work worktree; subagents, absolute paths, one commit per change. Never commit on `dev`; fixes found while testing go on `work/<x>`.
5. **Verify:**
   - Backend: narrowest pytest.
   - Documents: generate → PDF → PNG → inspect the reported defect.
   - Required `AGENTS.md` reviews.
6. **Publish:** in the dev worktree, `git merge work/<x>`, then `dev-channel.ps1 publish` (`restart` alone for backend-only changes).
7. **Report:** changes, commits, checks, failures, what to test on the dev URL.
8. **Promote (gate):** after the user approves, PR `work/<x>` per **Promotion**. After it merges: `dev-channel.ps1 rebuild <work branches still under test>`. Production goes live only via `scripts\mng.ps1 update` on GSSGAPP.

## Promotion

- Word reaches the server through `ms-word:ofe|u|{GSSG_PUBLIC_BASE_URL}/dav/...`. On the laptop, that base URL is the tailnet dev host, set only in the gitignored dev `.env`; production sets its own. Never commit the dev host, change the `public_base_url` default, or alter Word/WebDAV URL building to make dev work. The code path stays identical; only `.env` differs.
- PR the work branch itself; never PR or cherry-pick from `dev`.
- Before opening the PR, audit `git diff origin/main...work/<x>` and the PR text for dev routing leaks. Grep added lines for non-placeholder `ts.net`, `127.0.0.1` / `localhost` / `8765` used as a Word/DAV base, and changes to `GSSG_PUBLIC_BASE_URL`, `public_base_url`, `/dav`, or `word_url`.

## Gates (ask)

- Request can't work or breaks something: measure, offer options, recommend one.
- Changes the user's spec.
- Promote/push, merge, deploy.
- Destructive: delete worktree/branch, restore snapshot.
- User-only: credentials, Tailscale, BitLocker, physical scans.

## Rules

- Dev `.env`: scheduler off, no SMS/WhatsApp/BioTime, no `.email_key`/`.vapid_key`.
- Word COM: one conversion at a time; kill only your WINWORD.
- `.docx`: edit XML; never resave in Word.
- Other sessions' hunks: leave alone.

## Work 

- Always Auto-plan 
- Use Herdr skill and send work to another agent
- Give Agent instruction to use subagents to keep context window clean
- if task is large you can delegate to multiple agent in parallel 
- keep your context window clean by delegating 
- close the tab or pane of the agent work after he report back to you and he is done working 
- after done working create a PR in github 
