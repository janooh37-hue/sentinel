---
name: "dev-cycle"
description: "Fix bugs and add features on the laptop dev channel (branch dev, rebased on main); user tests on the dev URL before promotion. Use for any fix, feature, or template change."
---

# /dev-cycle

## Locations

- Worktree: `C:\Users\GSSG\projects\sentinel\.worktrees\160-laptop-dev` (absolute paths only; relative paths from another checkout hit main)
- Branch: `dev`, upstream `origin/main`. `git status -sb` shows ahead (unpromoted work) / behind (main moved).
- Control: `scripts\dev-channel.ps1` (`status`, `sync`, `publish`, `restart`, `promote`). Run with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-channel.ps1 <verb>` from the worktree.
- Server: `backend\serve.py` on 127.0.0.1:8765, started detached by the script; log `.tmp\dev-server.log.err`.
- URL: `https://gssglt.<your-tailnet>.ts.net/` (tailnet only; actual host lives in the gitignored dev `.env`)
- Dev data: `C:\Users\GSSG\gssg-dev-data` (throwaway snapshot; never production)
- Main checkout: untouched.

## Cycle

1. **Start:** `dev-channel.ps1 status`. Behind main and tree clean → `sync` before touching code. Dirty → ask whose changes they are.
2. **Understand:** trace the code; reproduce the bug.
3. **Gate:** ask if a gate fires; otherwise proceed.
4. **Build:** subagents, absolute paths, own hunks only, one commit per change on `dev`.
5. **Verify:**
   - Backend: narrowest pytest.
   - Documents: generate → PDF → PNG → inspect the reported defect.
   - Required `AGENTS.md` reviews.
6. **Publish:** `dev-channel.ps1 publish` (frontend build, migrate, restart, health check). `restart` alone for backend-only changes.
7. **Report:** changes, commits, checks, failures, what to test on the dev URL.
8. **Promote (gate):** after the user approves, follow **Promotion** below. Production goes live only via `scripts\mng.ps1 update` on GSSGIT.

## Promotion

- Word reaches the server through `ms-word:ofe|u|{GSSG_PUBLIC_BASE_URL}/dav/...`. On the laptop, that base URL is the tailnet dev host, set only in the gitignored dev `.env`; production sets its own. Never commit the dev host, change the `public_base_url` default, or alter Word/WebDAV URL building to make dev work. The code path stays identical; only `.env` differs.
- Start a new branch from `origin/main` and cherry-pick the commits. Never PR `dev` directly.
- Before opening the PR, audit `git diff origin/main...<promo-branch>` and the PR text for dev routing leaks. Grep added lines for non-placeholder `ts.net`, `127.0.0.1` / `localhost` / `8765` used as a Word/DAV base, and changes to `GSSG_PUBLIC_BASE_URL`, `public_base_url`, `/dav`, or `word_url`.

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

- Always auto-plan.
- Writers run on the desktop (`dtop`, Linux, 32 GB) via `herdr --machine dtop`; the laptop keeps merge, publish, dev URL/data, Word/document checks, and the PR. Never copy dev data or `.env` to the desktop; leave its other worktrees and agents alone.
- Setup per writer: from the dev worktree `git push desk dev`; then `ssh dtop git -C ~/Projects/sentinel worktree add .worktrees/<name> -b <branch> dev`; `herdr --machine dtop tab create --workspace <id> --cwd <worktree> --label <name> --no-focus`; `herdr --machine dtop agent start <name> --kind omp --pane <returned-pane> -- --model <model>`. Cheap model to explore, strong model to review. Tell each agent to use subagents.
- Long jobs: pass `-- --goal "Read .tmp/brief-<name>.md in this worktree and complete it exactly, including the report step."` with the brief placed there first. Goal mode starts working at once, so `agent start` may report the name lost; fix it with `herdr --machine dtop agent rename <pane> <name>`, then `agent wait`.
- Large task: parallel writers, one worktree and branch each, no shared files.
- Brief: goal, owned files, edits allowed or not, check to run (`~/.venvs/sentinel/bin/python -m pytest <narrowest>`), commit on the branch, and "write your report to `<worktree>/.tmp/handoff-<name>.md` and reply with the path only".
- Reports are claims: `ssh dtop cat` the handoff, `git fetch desk <branch>`, read the diff before merging into `dev`.
- Small fixes go back to the same agent; bigger follow-ups go to a fresh agent briefed with the handoff file. After merging: `herdr --machine dtop tab close <tab>` and remove the desktop worktree and branch.
- Tests: writers run the narrowest pytest; after merging, `git push desk dev` and run the full suite once on the desktop with `-n 6` in a detached worktree of `dev`. Requirements changed → `uv pip install -p ~/.venvs/sentinel/bin/python -r requirements.txt pytest-xdist` there first.
- Before heavy runs check `ssh dtop free -g`; if a stray heavy process (ComfyUI, old `omp ps` services) leaves under ~8 GB available, ask the user to kill it, then stop it (`omp ps stop <name> --dir <project>` for omp-supervised ones).
- When done, create a PR on GitHub.
