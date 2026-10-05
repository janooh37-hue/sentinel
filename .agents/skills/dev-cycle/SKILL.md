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
8. **Promote (gate):** after the user approves, `dev-channel.ps1 promote -Yes`. It refuses if main moved since the last sync; then `sync`, republish, ask the user to retest. Production goes live only via `scripts\mng.ps1 update` on GSSGAPP.

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
