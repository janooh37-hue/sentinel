# Leave report: company filter, exclude departed staff, employee details, sign & send to manager

Status: approved by user 2026-10-14. Dev channel only; no promotion without user approval.
Worktree: `C:\Users\GSSG\projects\sentinel\.worktrees\160-laptop-dev` (branch `dev`, already synced with origin/main — do not sync again).
Follow `/skill:dev-cycle`. One commit per item below. Use subagents for legwork.

## Where the code is (verified 2026-10-14)
- The report is frontend-only: `frontend/src/pages/leaves/report/` — `LeavesReport.tsx` (mounts `ReportView`), `ReportView.tsx` (options = `useState`, one filtering `useMemo` ~:91-104, `facts` header array ~:121-132, options panel, `withSignatures` checkbox, print buttons call `window.print()`), `reportData.ts` (`matchesStaff` :109-120, `buildReportSections` :300-420), `ReportPaper.tsx` (sheet; blank Prepared by / Approved by lines :175-192), `controls.ts` (`SEGMENT_*`, `CHIP_*`, `FIELD_LABEL`, `NATIVE_SELECT`), `useLeaveReport.ts` (pages `api.listLeaves`).
- Rows are `LeaveListItem` (`backend/app/schemas/leave.py:99-111`): carries `employee_status`, `employee_duty_unit`, leave type/dates/days/status.
- Locale keys under `leaves.report` in `frontend/src/locales/en.json` + `ar.json`. Arabic and English are peers.

## A1 — Filter by company (frontend only)
- "Company" = the employee's **duty unit** (السرية: الدوام الرسمي، السرية الأولى … الخامسة). There is no other company column on Employee.
- Add a company `<select>` (`NATIVE_SELECT`) to the options panel: "All companies" + `unitOptions(...)` from `frontend/src/lib/dutyUnits.ts` (seeds + extra values present in the data) + "Unassigned" (`UNASSIGNED`).
- Filter in the `ReportView` `useMemo` on `(r.employee_duty_unit ?? '').trim()`; add the picked company to `facts` so the printed sheet states it.
- en/ar keys: label `Company` / `السرية`, `All companies` / `جميع السرايا`.

## A2 — Exclude resigned and terminated (frontend only)
- Resigned/Terminated are **employee statuses** (`Employee.status`, stored bilingual e.g. `"Resigned - مستقيل"`), not leave types. Today their leaves are counted.
- Add a checkbox in the options panel: "Exclude resigned and terminated" / "استبعاد المستقيلين والمفصولين", **checked by default**.
- Filter with `englishPart(r.employee_status ?? '').trim()` not in `{Resigned, Terminated}` (same helper `matchesStaff` uses). People on notice (`pending_status`) stay in — `status` is still Active.
- When checked, add it to `facts`.

## A3 — Employee details when one employee is picked
When the report is scoped to a single employee (the employee picker), the sheet (screen + print) shows, above the monthly tables:
1. **Employee header card**: ID (G-number), name (AR/EN by language), position, duty unit, status, join date. Reuse the existing employee query/hook — find it, don't add a new endpoint unless the data truly isn't reachable.
2. **Currently on leave / last return**: on leave now? expected return date; last completed leave. The Leaves page already has `leaves.report.profileCurrent / profileNotOnLeave / profileReturns_* / profileLast / profileNone` keys — find the component that uses them and reuse its logic.
3. **Totals per leave type** within the selected period (use `classifyLeaveType` / `CANONICAL_KINDS` from `kinds.ts`).
4. **Every leave listed**: type, from, to, days, status, return date — sorted by start date, within the period.
- Must print cleanly on the A4 sheet with the repeating letterhead, in both directions (logical CSS properties only).

## B — Sign in the app and send to the manager for approval + signature
User decision: **the manager approves and signs** (normal General Book approval flow).

Flow:
1. On the report, a **"Sign and send to manager"** button (only for users who can create a General Book in category `1`; hide otherwise). Opens a dialog: manager picker (reuse the approver picker from `SubmitForApprovalDialog.tsx`), shows the period/company/employee scope being sent.
2. The preparer's **saved profile signature** fills "Prepared by" (name, signature image, date). If the preparer has no saved signature, the dialog says so and links to where they add it — no blank-signature filing.
3. The report is filed as a **General Book** record under category `1` Employee Staff (شؤون الموظفين), subject `تقرير الإجازات — <period>` (+ company/employee when scoped), normal confidentiality, then **submitted for approval** to the picked manager (existing `POST /books/{id}/submit` / `book_service.submit_for_approval`).
4. When the manager approves in Approvals, the existing General Book signing embeds the manager's signature at the `GSSG_ManagerSignature` bookmark — that is the **"Approved by"** line. Do not invent a second manager-signature mechanism.

Content of the filed paper:
- The General Book body carries the report as real Word tables: the pipeline already rebuilds `<table>` from `body_html` (`_pp_general_book`). Per month: `#`, ID, Name, Duty location, Total days, then totals by duty location as a table (the bar chart is screen/print only — no chart in the docx). A3's employee details as tables when one employee is picked.
- A "Prepared by" block with the preparer's name, saved signature and date. Find how the body pipeline can carry the signature image (or a template-supported signature token); if it cannot without a new dependency, STOP and report options to the coordinator — no new libraries, no HTML→PDF stack.
- Reuse existing endpoints wherever they already do the job (document generate → book → submit). Add a backend route only for what is genuinely missing; if routes/schemas change, run the `sync-api-types` steps and commit the generated types.

## Verify
- Frontend: unit tests for the new pure filters/aggregations in `reportData.ts` (company filter, departed exclusion, per-type totals) — boundaries only, no wiring tests. `pnpm -C frontend exec tsc -b --noEmit`, `vitest src/pages/leaves`, eslint on changed files (run frontend checks one at a time — memory).
- Backend: narrowest pytest for any new/changed service code, including a test that the filed book carries the preparer's signature and goes to the picked approver.
- Documents: generate a month report and a single-employee report → PDF → PNG; then approve one as the manager on dev and inspect the signed PDF: Prepared by (preparer signature) + manager signature both present, tables readable, Arabic RTL correct.
- Screen: check the report view in AR and EN, desktop and phone width.
- Required reviews: `i18n-rtl-reviewer` (UI strings + document). `notification-template-reviewer` only if notification text changes.

## Finish
- Commits on `dev` (A1, A2, A3, B separately; include this plan file in the first commit). `dev-channel.ps1 publish`.
- Reply with: commits, checks run, PNG paths inspected, anything not done and why, and what the user should test on the dev URL.
