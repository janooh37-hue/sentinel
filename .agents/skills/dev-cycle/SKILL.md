---
name: "dev-cycle"
description: "Fix bugs and add features on the laptop dev branch first; user tests on the dev URL before promotion. Use for any fix, feature, or template change."
---

# /dev-cycle

## Locations

- Worktree: `C:\Users\GSSG\projects\sentinel\.worktrees\160-laptop-dev` (absolute paths only; relative paths hit main)
- Branch: `feature/160-laptop-dev`
- Server: hub `dev-channel-160`, port 8765
- URL: `https://gssglt.<your-tailnet>.ts.net/`
- Dev data: `C:\Users\GSSG\gssg-dev-data` (read-only; test on temp copies)
- Main checkout: untouched.

## Cycle

1. **Understand:** trace the code; reproduce the bug.
2. **Gate:** ask if a gate fires; otherwise proceed.
3. **Build:** subagents, absolute paths, own hunks only, one commit per change.
4. **Verify:**
   - Backend: narrowest pytest.
   - Documents: generate → PDF → PNG → inspect the reported defect.
   - Frontend: build → copy to `backend/app/static` → check page.
   - Required `AGENTS.md` reviews.
5. **Publish:** restart `dev-channel-160`; wait ready.
6. **Report:** changes, commits, checks, failures, what to test.

## Gates (ask)

- Request can't work or breaks something: measure, offer options, recommend one.
- Changes the user's spec.
- Push, merge, deploy.
- Destructive: delete worktree/branch, restore snapshot, migration on shared DB.
- User-only: credentials, Tailscale, BitLocker, physical scans.

## Rules

- Dev `.env`: scheduler off, no SMS/WhatsApp/BioTime, no `.email_key`/`.vapid_key`.
- Word COM: one conversion at a time; kill only your WINWORD.
- `.docx`: edit XML; never resave in Word.
- Other sessions' hunks: leave alone.
