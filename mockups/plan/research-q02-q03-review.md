# Q02 / Q03 research findings — review only

**DRAFT — DO NOT MERGE.** This document presents research for review, not application fixes, production incident claims, or acceptance of the daily research automation.

## Q02: distinct headerless messages silently deduplicated

A synthetic probe through the real `email_service.sync_now` → `_sync_account_locked` flow using the project's fake IMAP server supplied two distinct headerless messages:

```python
b'\xff\xfe garbage\x00'
b'totally different junk'
```

Observed: `imported=1, skipped_duplicate=1, errors=[]`. One junk row was imported and the second distinct payload was silently classified as duplicate. An assertion expecting a parse-error report failed as intended.

This finding passed the research runner's independent review. It is not a fix. The intended malformed-message policy still needs confirmation; synthetic inputs do not establish production incidence. Proposed implementation work: a failing public-sync regression and the smallest correction, preserving valid messages with recoverable parser defects.

## Q03: a valid database backup can reference absent files

Synthetic Linux tests used the actual application backup and attachment-writing services with Python 3.12.14 / SQLite 3.53.1. Independent review approved this as offline evidence, not as a runner-accepted research unit.

Results:
- Quiet control: database and file references coherent.
- Delete or replacement after the database snapshot but before directory copying: restored database passes SQLite integrity and foreign-key checks, yet references a missing attachment.
- The application's unlink-before-commit window also reproduces a missing referenced attachment.
- Creation in that window produces an unreferenced extra file, not a missing referenced file.
- A file disappearing during directory copy raises an error and removes the partial backup (fail-closed).
- Referenced `vehicle_files/` and `book_packages/` files are omitted from the backup allowlist. Vehicle files are user uploads; whether historic book packages can safely be regenerated is unresolved.
- Encryption keys are intentionally excluded by documented design; that exclusion alone is not asserted as a defect.

Cause: the database snapshot and subsequent directory copies do not form one coherent snapshot. SQLite integrity and foreign-key checks cannot validate JSON file-path references against disk.

Evidence includes forced deterministic interleavings through real application functions and an unhooked concurrent stress run corroborating missing references. The parent reran the synthetic harness successfully: all deterministic expectations matched; exit 0. That exit means the defect was reproduced as expected, not that backups are repaired.

Limits: restore checking models the documented restore procedure in Python; Windows/PowerShell execution and production incidence are unmeasured. Some byte-overwrite checks are explicitly models, not actual application writer calls. The reproduction was reviewed against application revision `ebf085ab332373b33b5b44510ba9d145881a47b0`; this publication does not claim the current branch head was behaviorally retested.

## Evidence and automation status

The Q03 harness, detailed reviewer report and original run receipts remain retained privately; this public document is a sanitized summary, not the complete reproduction bundle. Those artifacts must accompany a subsequent implementation review; no unshared artifact is being presented here as publicly accessible.

At the recovery close: Q02 was runner-accepted; Q03 was independently approved offline only. One of two required runner units was accepted, with zero credited seconds toward the 3600-second requirement. All 18 approved recovery sessions were consumed. Later authorization to resume recurring research does not retroactively accept the recovery day or reset its allowance.

Live verification still needs a real research execution through source capture, research, independent review, runner acceptance/checkpoint and report delivery. No full automation readiness is claimed by this document.

## Review decision requested

Review the findings, their limitations and proposed regression scope. **No merge, deployment or application change is requested.** Keep this PR draft until an explicit later decision; fixes belong in separately reviewed implementation changes. Previously merged PRs #215 and #220 are historical work, not the review location for these findings.
