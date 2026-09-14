# GSSG Manager — phased implementation plan

Status: Phases 0–2 merged and deployed through PRs #73–#75; Phase 3 in progress.

This folder converts [GSSG_MANAGER_PLAN.md](../../../GSSG_MANAGER_PLAN.md) into independently executable phases, incorporating the code audit at `bd5c14e3` on 2026-09-05. Recheck the actual code at the start of every phase; file names and behaviors below are evidence to investigate, not permission to assume the code has stayed unchanged.

The original plan remains a historical reference. For implementation, follow these phase files and [WORKFLOW.md](WORKFLOW.md), including their corrections to the original plan. Each phase starts by preparing its behavior tests and verifying the current code before changing application code. Implement one test and one behavior at a time.

## Phase index

| Phase | Detailed plan | Main result | Depends on |
| --- | --- | --- | --- |
| 0 | [Domain language and ADR](phase-00-domain-files.md) | Verified vocabulary; separate superseding and excusing leave | None |
| 1 | [Attendance rules](phase-01-attendance-rules.md) | Shared policy, leave liveness, and correction behavior | 0 |
| 2 | [Workforce access](phase-02-workforce-access.md) | Correct read filtering and scope enforcement inside services | 1 |
| 3 | [Capability catalog](phase-03-capability-catalog.md) | Bilingual metadata and safe request availability | 2 release gate |
| 4 | [Mailbox](phase-04-mailbox.md) | One mailbox owner with realistic IMAP tests | 3 release gate |
| 5 | [Scan triage](phase-05-scan-triage.md) | Shared classification without losing extraction evidence or QR fallback | 4 release gate |
| 6 | [Document artifacts](phase-06-document-artifact.md) | Shared artifact operations that preserve Word edits and preview behavior | 5 release gate |
| 7 | [Push notifications](phase-07-push.md) | Shared copy, delivery, and explicitly defined deduplication | 6 release gate |
| 8 | [Vehicles](phase-08-vehicles.md) | Workflow boundaries justified by simpler callers | 7 release gate |
| 9 | [Record decisions](phase-09-record-decision.md) | Shared decision state and one mobile action surface | 8 release gate |

Phases 3–9 are technically independent; the release dependencies preserve the agreed sequence. The requirements visibility defect deserves an expedited fix: Phase 2 slice 2.1 can be extracted into its own small worktree/PR ahead of the architectural sequence, since it does not depend on Phase 1. This is a recommendation, not a claim that it has been approved or implemented. Otherwise it remains the first slice of Phase 2.

## Required order inside every code phase

1. **Verify the current code:** read callers, contracts, errors, existing tests, and the actual state at the worktree commit; run the relevant baseline.
2. **Prepare the tests first:** identify observable behavior and exact expected results; retain or add passing characterization tests before moving existing behavior.
3. **Write the next failing test:** run it and record its intended failure for a defect or new contract. Do not write every future phase's executable tests upfront.
4. **Verify before implementation:** inspect the test and affected callers; confirm the failure is meaningful and no protected behavior is lost.
5. **Implement the smallest change:** rerun the focused tests. Repeat steps 1–5 for each new behavior.
6. **Verify before building:** inspect the diff, run the required tests/static checks and reviews, then build and smoke-test where applicable.
7. **Release the phase:** one worktree branch and PR; merge/push to `origin/main`, follow the deploy skill, and record release evidence before proceeding.

Phase 0 is documentation only: its test-first equivalent is a written acceptance checklist and source verification. Do not invent failing application tests to test the existence of Markdown files.

## Audit corrections carried into these files

- A scope hash in a pagination cursor does not filter requirements; filtering must precede limits and pagination.
- Dashboard deleted-leave exclusion already exists. Keep that as a passing regression; investigate unknown leave types being counted as annual for the actual behavior change.
- Capability metadata must explicitly establish requestability; loading, errors, and unknown IDs cannot imply permission to request access.
- IMAP fakes must model mailbox state and failures, not return empty success from every method.
- A flat triage field dictionary cannot preserve alternatives, confidence, or source snippets. QR matching must remain usable when OCR is unavailable.
- Template rendering and finalizing an existing Word-authored DOCX need distinct artifact operations. Preview cache and locking stay with the Word session.
- Retain DOCX content, signature, parser, HTTP authorization, and concurrency regressions. Test removal requires equivalent observable coverage, not merely moving a module.
- Push currently marks references even if no delivery succeeds. Record existing behavior and separate a retry-policy change from code movement.
- Vehicle file count is not a success metric. Start with fines/EVG and evaluate further boundaries.
- Record decisions already share `useBookApprovalActions`; compose it and preserve each caller's success behavior.

## Evidence and skills

Use the `tdd` skill for behavior tests and the `codebase-design` skill when deciding module boundaries. Use `domain-modeling` for Phase 0, `sync-api-types` when route/schema contracts change, and `deploy` only at release. Run the reviewers required by AGENTS.md. Use `grilling` only for a business decision the code and existing decisions cannot resolve, after documenting the concrete alternatives.

Existing test seams in the original plan are already agreed. Additional or materially changed seams in these revised plans are proposed; settle those before writing tests at them under the TDD skill. Do not repeatedly ask about already settled semantics. Preparing these Markdown plans does not require a new seam approval.

The audit was a targeted static review, not a full application test run or production-data audit. Every execution checkbox in the phase files starts unchecked. Store actual commit IDs, commands, outcomes, review findings, and release results in the evidence section of the relevant phase.
