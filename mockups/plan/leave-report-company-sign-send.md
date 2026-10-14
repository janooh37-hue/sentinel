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
1. On the report, a **"Sign and send to manager"** button (only for users who can create a General Book under classification 6/1; hide otherwise). Opens a dialog: manager picker (reuse the approver picker from `SubmitForApprovalDialog.tsx`), shows the period/company/employee scope being sent.
2. The preparer's **saved profile signature** fills "Prepared by" (name, signature image, date). If the preparer has no saved signature, the dialog says so and links to where they add it — no blank-signature filing.
3. The report is filed as a **General Book** record (category GS) under classification **6/1 Statistics & monthly reports** (الإحصائيات والتقارير الشهرية, ref `1/6/GSSG/n`; user decision 2026-10-14 — General Books file by classification code, not legacy category `1`), subject `تقرير الإجازات — <period>` (+ company/employee when scoped), normal confidentiality, then **submitted for approval** to the picked manager (existing `POST /books/{id}/submit` / `book_service.submit_for_approval`).
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

## Evidence (2026-10-14)
- B route: `POST /leaves/report/send` (`leave_service.send_report_for_approval`). It checks record-type access for 6/1, an active approver, and the caller's saved signature before any book is minted. Then it calls `generate_document` (General Book, 6/1, manager = the approver's linked Manager row) and `submit_for_approval`. The server appends the «إعداد» block (name, saved-signature `<img>`, date). The renderer maps `page-break-after: avoid` to Word keep-with-next, so that block never splits across pages.
- The filed book (subject, body, «إعداد») is always Arabic. The screen paper follows the UI language.
- Dev books: 1/6/270 and 1/6/273 (month 2026-08) and 1/6/271 and 1/6/272 (G3231, 2026). 1/6/270, 1/6/272 and 1/6/273 were approved by user 3. The PNGs are in `.tmp/leave-report-send/`.
- Phone: the report view is desktop-only (`TabRecords` hides `LeavesReport` below `md`), so the narrow check ran at 800 px.

## C — Professional layout for the filed single-employee report (user feedback on 1/6/275, 2026-10-14)

Input: `.tmp/lr-275/in.pdf` (pages `p1.png`, `p2.png`), the filed G3997 report for August 2026. Reference look: `.tmp/lr-275/report-ref.png` (REPORT-1288, the "Report" template). The user likes how Reports look; keep our tables and branding, and make the layout match that calm, spaced Report style. Scope is the **filed document** (`reportDocument.ts` `reportBodyHtml` + `leave_service._prepared_by_html`). Do not redesign the on-screen sheet.

Defects seen in 1/6/275:
1. **Broken Arabic paragraph.** The General Book's fixed intro ends «…ننوه على الموضوع أعلاه انه», but the body then opens with a scope line («تقرير الإجازات: جميع أنواع الإجازات · دون المستقيلين والمفصولين · …»), so the sentence never finishes. Replace the scope line with one proper Arabic sentence that completes the intro, for example: «تم إعداد تقرير إجازات الموظف/ {name} ({G-number}) عن شهر أغسطس 2026، وذلك على النحو التالي:». For a multi-employee report: «…تقرير الإجازات عن شهر {period} [لـ{السرية}]، وذلك على النحو التالي:». No `·` chains or em dashes in the Arabic prose.
2. **Addressee is empty**: «السيد \ المحترم». Fill the General Book's addressee field (find the field the GB template uses) from the picked manager: their Manager row's title or name, else the user's name. If the GB has no addressee field the send flow can set, report that instead of hacking the template.
3. **Subject** reads «تقرير الإجازات — أغسطس 2026 — name». Make it natural Arabic: single employee «تقرير إجازات الموظف/ {name} عن شهر أغسطس 2026»; multi «تقرير الإجازات عن شهر أغسطس 2026» (+ «— {السرية}» only if scoped). Use a range wording for a multi-month period.
4. **Info not needed for one employee** (remove when the report is scoped to one employee):
   - the month roster table (one row repeating the same employee) and the «أيام الإجازة حسب موقع العمل» table (it also split across pages);
   - the «الإجازة الحالية: ليس في إجازة حالياً» line, unless the employee is currently on leave; drop «آخر إجازة مأخوذة…» entirely (it repeats the leaves table);
   - the «الحالة: نشط» row in the employee table;
   - the «تاريخ العودة» column when no leave in the period has a return date.
5. **Dates wrap** («13 أغسطس / 2026» on two lines). In the filed tables use the compact numeric date the Report uses (`2026/08/13`) so every date stays on one line.
6. **Wording**: «السجلات» → «عدد الإجازات». Arabic counts/plurals must read correctly (e.g. the total row). Fix «أخر» → «آخر» wherever it remains.
7. **«إعداد» block** looks cramped and misaligned (the signature sits above «التوقيع:», the date floats). Match the Report's signature block: centred, «الإسم: …», «المسمى الوظيفي: …» (from the preparer's employee record when present), «التوقيع:» with the image on the same line, then «التاريخ: …», with even spacing. Keep it together on one page (keep-with-next already exists). Put the date in the same format as the header (`2026/10/14`).
8. Overall: even spacing between sections (one blank line before each heading, none doubled), section headings bold, tables full width with consistent column widths, so a one-employee report fits on **one page** with the manager signature block when the period has few leaves.

Verify C:
- Unit tests: update `reportDocument.test.ts` only for real behaviour (one-employee body omits roster/unit tables; intro sentence present; empty return column dropped). Delete any test that pins old wording.
- Re-send the same scope (G3997, August 2026) on dev → approve as user 3 → PDF → PNG. Inspect: intro sentence reads as one Arabic paragraph, addressee filled, no redundant tables, dates on one line, «إعداد» block like the Report, ideally one page. Also re-send one multi-employee month and confirm it still renders well.
- `i18n-rtl-reviewer` on the diff. ruff/tsc/eslint/vitest on changed files only.
- One commit on `dev`: `fix(leaves-report): professional layout for the filed report`. `dev-channel.ps1 publish`. Append evidence here.

### Evidence C (2026-10-14)
- Body (`reportDocument.ts`): it opens with one sentence that finishes the paper's «…أعلاه انه», for example «تم إعداد تقرير إجازات الموظف/ {name} ({G}) عن شهر أغسطس 2026، وذلك على النحو التالي:». The company form is «تقرير إجازات {السرية}», a year reads «عام 2026», and a range reads «الفترة من … إلى …». Leave-type, staff or status filters add «ويقتصر التقرير على: …». The `·` scope line is gone.
- Subject (`filedSubject`): «تقرير إجازات الموظف/ {name} عن شهر أغسطس 2026», or «تقرير الإجازات عن شهر أغسطس 2026» with «— {السرية}» added only when the report is scoped to one company.
- One-employee body: the employee table is one horizontal row with no status column, then the days by type («عدد الإجازات»), then the leaves in the period. The return-date column appears only when a leave has a return date. The current-leave line appears only when the employee is on leave. «آخر إجازة» is dropped. The month roster and the duty-location table are omitted. Dates use the numeric `13/08/2026` form, which Word shows as 2026/08/13 on one line. A multi-employee total reads «المجموع: 18 موظفًا».
- Spacing: there is one blank line before each heading. The first heading after the intro gets none, because the paper's body paragraph already spaces after itself.
- Server (`leave_service`): `recipient_name` is filled from the approver's Manager row, using the title, then the name, then the account name. «إعداد» is centred: «الإسم», «المسمى الوظيفي» (from the preparer's employee record), «التوقيع:» with the image on the same line, and «التاريخ: 2026/10/14». It keeps together across pages.
- Dev books:
  - 1/6/277 (G3997, August 2026), approved by user 3. It is **one page**, with the addressee «السيد \ مدير مركز الاصلاح والتأهيل الوثبة -2 المحترم» and both signatures. PNG: `.tmp/lr-275/employee-signed-p1.png`.
  - 1/6/279 (السرية الخامسة, August 2026), approved by user 3. It has two pages, and «إعداد» moved to page 2 whole. PNGs: `.tmp/lr-275/month2-signed-p1.png` and `-p2.png`.
  - 1/6/276 and 1/6/278 are earlier iterations; 1/6/276 is still pending.
- Checks: `vitest src/pages/leaves/report` (15 passed), `tsc -b --noEmit`, eslint on the changed files, `pytest backend/tests/test_leave_report_send.py` (2 passed), and ruff check/format on the changed backend files. The `i18n-rtl-reviewer` found no must-fix items; the wording of `filedIntroCompany` and `filedCurrent` («بتاريخ») and the English parity were applied.
- Open (not part of C): the by-type total counts only the days inside the period (20), while the leaves table lists each leave's full days (14 + 7). The 31 July to 13 August leave straddles the month. This is the A3 behaviour, the same as on screen.
