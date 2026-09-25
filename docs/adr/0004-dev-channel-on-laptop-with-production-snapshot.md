# Dev channel runs on the laptop against a production snapshot

The production server (`GSSGAPP`) is near its RAM limit, so the dev channel runs on the laptop `GSSGLT` instead of as a second service with `dev.gssg.app`. Dev uses a restored production backup, not an empty seed, because realistic data is what the work needs. As a result, real HR records live on a portable machine. That is accepted only with BitLocker enabled.

## Consequences

- There are no outbound sends from dev. The scheduler is off, SMS, WhatsApp, and BioTime are not configured, and `.email_key` and `.vapid_key` are never copied, so stored mail credentials can't be decrypted and pushes are rejected.
- All worktrees share one dev data directory. If a branch's migration moves the database ahead of another branch, restore a fresh snapshot.
- Remote access is tailnet-only through `tailscale serve`. Dev is not public and is not always on.
- Promotion is unchanged: merge to `main`, push, then run `mng.ps1 update` on `GSSGAPP`. Rollback is a revert plus `update`, with the pre-migration backup as the last resort.
