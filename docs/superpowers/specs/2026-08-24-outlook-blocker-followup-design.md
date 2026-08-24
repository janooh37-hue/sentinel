# Outlook Blocker Follow-up Design

## Goal

Make the existing Outlook correspondence replacement branch merge-ready by correcting the three regressions found in the final scoped re-review, then install and use the native Windows toolchain on this workstation to verify the .NET Framework 4.8 launcher, VSTO add-in, and x86/x64 MSI packages.

## Context

The feature branch already contains the complete eight-task Outlook replacement and the final security/contract fix wave. Commit `7c2bd83` addressed the original whole-branch findings but introduced three regressions:

1. invalid handoff attachment indices can raise uncaught exceptions and return HTTP 500;
2. a failed completion callback can mark a successful Outlook action failed and permit duplicate drafts; and
3. fresh operator/manager role presets no longer include `email.manage`, hiding IMAP and Outlook pairing settings.

The previous Subagent-Driven Development ledger reached its final-wave breaker. This follow-up is a new, narrow plan and review cycle on the same isolated feature branch. Existing commits remain intact.

## Scope

### Attachment bounds

`GET /api/v1/outlook/device/handoffs/{handoff_id}/attachments/{index}` validates that the stored `attachments` payload is a list and that `index` is within bounds before indexing it. Negative, missing, malformed, and out-of-range references return the existing attachment-not-found 404 response. A valid reference continues through the existing access-checked PDF resolver.

### Completion callback semantics

The launcher must distinguish an Outlook action failure from a completion-reporting failure. `COMPLETION_RETRY_REQUIRED` means the draft was created or the message was opened successfully; it must never be sent to the handoff failure endpoint. The local completion receipt remains authoritative and retries only the completion callback. Every other native failure continues through the existing failure-reporting path.

### Role presets

`email.manage` remains an active capability because IMAP account management and Outlook device pairing still depend on it. Restore it to `_OPERATOR_CAPS`; `_MANAGER_CAPS` inherits it. Obsolete `ledger.view`, `ledger.edit`, and `ledger.send` remain removed from the capability catalog and presets.

### Native build environment

Install on this workstation:

- Visual Studio 2022 Build Tools with MSBuild;
- .NET Framework 4.8 targeting pack and desktop build tools;
- Office/VSTO build targets;
- Windows SDK with SignTool; and
- the WiX toolset version required by `Gssg.Outlook.Installer.wixproj`.

Installation is workstation configuration only. No product dependency or runtime downloader is added.

## Non-goals

- Do not revisit the completed Outlook architecture or mailbox cutover.
- Do not rewrite or squash existing feature commits.
- Do not add abstractions around the three fixes.
- Do not bypass signing, classic Outlook smoke testing, wrong-mailbox testing, or production-draft preservation.
- Do not deploy from the feature worktree.

## Error Handling and Invariants

- Untrusted attachment indices never escape as `IndexError` or `TypeError`.
- A successful native Outlook action cannot transition to server status `failed` solely because its completion callback failed.
- Retrying a completion receipt cannot create another draft.
- Fresh operator and manager presets expose required Email and Outlook settings without restoring any removed Ledger capability.
- Native build failures are fixed at source; missing signing certificate or unavailable classic Outlook remains an explicit external deployment gate.

## Tests

### Backend

Add focused tests proving:

- negative and out-of-range attachment indices return 404;
- malformed/missing attachment payloads return 404;
- a valid attachment still downloads through access checks;
- operator and manager role presets contain `email.manage`;
- removed Ledger capabilities remain absent.

### Native

Add the smallest pure test around failure reporting: `COMPLETION_RETRY_REQUIRED` is not reported through `TryFail`, while ordinary failure codes are. Run the existing native suite after the toolchain is installed.

### Integration and release verification

Run, in order:

1. focused backend/frontend checks;
2. native unit tests;
3. x64 and x86 solution/MSI builds;
4. SignTool verification for assemblies, manifests, and MSI packages;
5. launcher `--self-test`;
6. classic Outlook smoke tests, including callback interruption and duplicate-draft prevention;
7. the complete real Outlook/IONOS acceptance path; and
8. manual preservation of the single production draft before deployment.

## Completion Criteria

The follow-up is complete when the three source regressions have reviewed behavioral coverage, the branch-wide review has no Critical or Important findings, both native bitnesses build and pass tests locally, signed artifacts verify, launcher/classic Outlook smoke tests pass, and all remaining production-only gates are explicitly recorded for the deployment operator.
