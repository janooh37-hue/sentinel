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

## D — «Save as PDF» downloads a real PDF (user decision 2026-10-14: server builds it)

Today both «Print» and «Save as PDF» in `ReportView.tsx` (:428-440) call `window.print()`, so «Save as PDF» opens the print dialog. Make «Save as PDF» download a PDF file directly, with no print dialog. «Print» stays as is.

- The PDF is the **same formal General Book layout as section C** (letterhead, intro sentence, tables, «إعداد» with the preparer's saved signature), but a **draft**: no ref allocated, no Book row, not submitted, no manager signature. Reuse the existing draft path: `document_service.generate_document(..., commit=False)` (the `/documents/generate` "Draft/Save split" → `ref_number="DRAFT"`) and the existing document download endpoint. No new libraries, no HTML→PDF stack.
- Share one builder with the send flow: subject + body + «إعداد» must come from the same code (`leave_service`), so the draft and the filed book can never drift. Smallest shape wins, e.g. a `commit` switch on the existing service plus one thin route (or reuse `/documents/generate` directly if the «إعداد» block can be produced without duplicating `_prepared_by_html`). If a route/schema changes, run `sync-api-types` and commit the types.
- No saved signature: still produce the PDF; «إعداد» shows name, title, an empty «التوقيع:» line and the date (saving a PDF must not require a signature; sending still does).
- Addressee: there is no picked manager on save. Check what the General Book renders when `manager_id` is None; the paper must not show an empty «السيد \ المحترم». Pick the least-code option that reads correctly (e.g. omit the addressee line, or the default the GB draft already uses) and say which in the report.
- UI: the button shows a busy state while Word renders (a few seconds) and disables double clicks; errors show the existing toast pattern. Download filename like the filed one: `تقرير الإجازات — <scope> — <date>.pdf` (reuse `download_filename_for` if it fits). Follow the existing in-app download pattern (base64 `encoding` to dodge download managers, `<a download>`).
- Same permission as the send button's 6/1 General Book access check? No — saving a PDF is reading the report; anyone who can see the report can save it. If the draft path demands General Book create access, report that rather than widening permissions.

Verify D:
- Backend: narrowest pytest — draft returns a PDF/document without allocating a ref or creating a Book, with and without a saved signature.
- On dev: click «Save as PDF» for G3997 August 2026 and for a whole month → file downloads (no print dialog) → PDF → PNG; inspect it matches the C layout, says nothing like an empty addressee.
- `i18n-rtl-reviewer` if strings change. tsc/eslint/vitest/ruff on changed files.
- One commit on `dev`: `feat(leaves-report): save the report as a PDF directly`. `dev-channel.ps1 publish`. Append evidence here.

### Evidence D (2026-10-14)
- **One builder.** `leave_service._generate_report` builds the subject, the body, «إعداد» and the addressee for both paths:
  - `send_report_for_approval` calls it with `commit=True` (6/1).
  - The new `report_pdf` calls it with `commit=False`. That is the existing draft path: `ref_number="DRAFT"`, no Book row, nothing submitted, no manager signature.
- **Route.** `POST /leaves/report/pdf` (`LeaveReportPdfRequest{subject, body_html}`; `LeaveReportSendRequest` now extends it) returns the PDF as base64 text/plain, the in-app download pattern.
  - It is gated by `leaves.view` only, and the service passes no `record_access_user`, so saving needs no General Book create access.
  - Deviation from the plan: I did not chain `/documents/generate` → `/jobs` → `/documents/{id}/download`. That chain requires `documents.generate` and General Book record access, which would contradict "anyone who can see the report can save it". It would also need job polling.
  - Types are synced (`api.types.ts`).
- **Addressee.** Nothing is picked, so it names the paper's default signing manager: `resolve_manager(None)`, using its title or name, else `DEFAULT_MANAGER_TITLE`. That is the same manager the bottom block already prints, so there is no empty «السيد \ المحترم».
- **No saved signature.** The PDF is still produced, and «التوقيع:» stays blank (unit test). Sending still requires a signature.
- **UI.** «حفظ PDF» calls `api.leaveReportPdf` and saves the file with a `<a download>` blob.
  - While Word renders, the button is disabled with `aria-busy` and a spinner. Errors use the `toast.error(apiErrorMessage)` pattern.
  - The file name is the filed subject without path characters, then the date, for example `تقرير إجازات الموظف عبدالرحمن … عن شهر أغسطس 2026 — 2026-10-14.pdf`.
  - «طباعة» still calls `window.print()`.
- **Dev run** (Playwright, `window.print` stubbed to detect calls):
  - G3997, August 2026: the file downloaded in 21 s, `print called: false`, 1 page. PNG: `.tmp/lr-275/save-employee-p1.png`.
  - Whole month, August 2026: the file downloaded in 5.5 s, 5 pages. PNGs: `.tmp/lr-275/save-month-p1.png` and `-p5.png`.
  - Both match the C layout: the ref is blank, there is no manager signature, and «إعداد» carries the preparer's signature.
- **Checks.**
  - `pytest backend/tests/test_leave_report_send.py`: 4 passed. The new parametrized test checks for a draft with no ref and no Book, the signature present or absent, and the addressee naming the default manager. The fixture now also patches `artifact_service.get_settings`, so the test no longer writes into the dev data directory.
  - ruff check and format on the changed backend files.
  - `mypy` on `leave_service.py` and `leaves.py`: no errors in them; the 22 errors reported are pre-existing ones in `book_service`, `auth_service` and `attendance_policy`.
  - `tsc -b --noEmit`, and eslint on `ReportView.tsx` and `api.ts`.
  - No UI strings changed.

### D addendum: report actions as a toolbar (user request 2026-10-14)
- **Change.** Print, Save PDF and Sign-and-send moved from the foot of the options column to one horizontal row directly above the paper (`ReportView.tsx`).
  - Classes: `mx-auto flex w-full max-w-[210mm] flex-wrap items-center gap-2 print:hidden` plus `data-print-hide`. The row is as wide as the sheet, so it starts at the paper's inline-start edge.
  - The column wrapper is `print:block`. `SendReportDialog` wiring is unchanged (it portals).
  - Logical CSS only, and no new strings.
- **Screenshots** (Playwright on dev, August 2026):
  - `.tmp/lr-275/toolbar-ar-desktop.png` and `toolbar-en-desktop.png` (1440 px).
  - `toolbar-ar-1024.png` and `toolbar-en-1024.png`.
  - `toolbar-ar-narrow.png` and `toolbar-en-narrow.png` (800 px). The view is desktop-only below `md`. At 800 px the options panel stacks above, and the toolbar still sits directly above the paper.
  - AR puts «طباعة» at the right edge, EN puts «Print» at the left edge, and the order mirrors.
  - With `print` media emulated, the Print button is not visible at any of the six sizes.
  - All three buttons fit on one row at every width the view renders, so the `flex-wrap` fallback did not trigger.
- **Review.** `i18n-rtl-reviewer` found no must-fix items on the toolbar or on D. Its should-fix items on D (filename date separators and bidi controls, a blank line to sign by pen) were **not** committed: D was stopped and replaced by E.

## E — «Save as PDF» = the printable sheet, saved straight to a file (user, 2026-10-14 14:4x; replaces D's General Book draft)

User: the saved PDF must be **the same as the printable one** (the on-screen report sheet that «Print» prints, `ReportPaper.tsx` + print CSS). The General Book draft from D is wrong for saving: with no manager approval there is no ref, so the letter format makes no sense. Still **no print dialog**.

- Replace D's draft path (`POST /leaves/report/pdf` → `leave_service.report_pdf` / `api.leaveReportPdf` / `savePdf` mutation, commit 5a50925d). Remove what becomes dead; keep `send_report_for_approval` (it shares `_generate_report`) working and unchanged in behaviour.
- No new npm/pip dependency. Options, in order of preference — measure, pick the first that gives a faithful, Arabic-correct PDF:
  1. Server prints the sheet with the **installed Chromium browser in headless mode** (`msedge`/`chrome --headless --print-to-pdf`, or Chrome DevTools `Page.printToPDF` via stdlib if flags are not enough for page size/margins). Both exist on GSSGLT (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`, `C:/Program Files/Google/Chrome/Application/chrome.exe`). The browser path must be resolved at runtime (Edge, then Chrome) with a clear 503 if neither is present — production is GSSGAPP (Windows), do not hard-code one host's path. The client posts the sheet's HTML (the same DOM the print uses, with the built CSS/fonts resolvable, e.g. inline the app stylesheet or serve via the same origin) — the PDF must look like the browser's print of that sheet, including RTL, fonts, page breaks and the print-only parts.
  2. If headless print cannot be made faithful and safe (sanitise posted HTML: no scripts, no external fetches; run with a temp profile, timeout, kill on hang), STOP and report options with evidence. Do not fall back to the General Book.
- Frontend: «حفظ PDF» in the toolbar (28509b34) calls it, busy state, blob `<a download>`, filename `تقرير الإجازات — <scope> — <date>.pdf` (Arabic and English per UI language), error toast.
- Permission: anyone who can view the report.
- Verify: download for G3997 August 2026 and for a whole month in AR and EN → render to PNG → compare side by side with the browser's own print of the same sheet (`.tmp/lr-save/`). pytest for the new route (happy path + browser missing). tsc/eslint/vitest/ruff on changed files. `i18n-rtl-reviewer`. Commit `fix(leaves-report): save the printable report as a PDF`, publish, append evidence. Also correct D's evidence line that says reviewer items were "handled in the next commit" (they were not).

### Evidence E (2026-10-14)
- **Replaced D.**
  - `leave_service.py`, `schemas/leave.py` and `test_leave_report_send.py` are back to their `eef80ec2` (C) state. `report_pdf`, `_generate_report`, the optional-signature path and the D test are gone, and `send_report_for_approval` is byte-for-byte as in C.
  - The test fixture now also patches `artifact_service.get_settings`, so it no longer writes into the dev data directory.
- **Server.** New `services/sheet_pdf_service.py`. `POST /leaves/report/pdf` (`LeaveReportPdfRequest{html, lang: ar|en}`, ≤ 5 MB, gated by `leaves.view` only) returns base64 text/plain.
  - The posted sheet HTML is wrapped in `<html lang dir><div id="root">` with the built app CSS inlined. `/assets/` font URLs point at `backend/app/static/assets` on disk.
  - The page is printed by headless Edge, else Chrome, resolved at runtime from `ProgramFiles(x86)`, `ProgramFiles` and `LocalAppData`. It runs `--print-to-pdf --no-pdf-header-footer` with a throwaway profile and a 60 s timeout, and a hang is killed with `taskkill /T /F`. No browser gives a 503 `PDF_BROWSER_UNAVAILABLE`; a failed print gives a 503 `PDF_NOT_AVAILABLE`.
  - **Safety.** `<script>` tags are stripped. The page CSP is `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src file: data:`, which allows no network, no scripts or inline handlers, and no `file:` images, so a posted `<img src=file:…>` can't pull server files into the PDF. The wordmark is inlined as a data URI.
  - Measured: `--blink-settings=scriptEnabled=false` makes `--print-to-pdf` write nothing, so it is not used.
- **Frontend.**
  - «حفظ PDF» posts `.print-leave-report` `outerHTML` (the same DOM «Print» prints) and the UI language. It is busy and disabled while printing, saves with a blob `<a download>`, and shows `toast.error(apiErrorMessage)` on failure.
  - New key `leaves.report.pdfFilename` (ar/en) gives `تقرير الإجازات — أغسطس 2026 — <name> — 2026-10-14.pdf` and `Leave report — August 2026 — 2026-10-14.pdf`. Characters Windows rejects and bidi controls are stripped, and an empty scope leaves a single separator.
- **Dev run** (Playwright, August 2026; `window.print` stubbed, print dialog never called):
  - The download took 2–3.4 s per file.
  - Each file was compared with the browser's own print of the same page (`page.pdf`, print media): same page count (employee 2/2, month 4/4), all A4, and the same text on every page except one extraction-order difference on AR employee p2.
  - The images are visually identical: fonts, RTL/LTR, the `n / N` counter, footer.
  - Side-by-side PNGs (left saved, right print) in `.tmp/lr-save/`: `ar-employee-p1/p2`, `ar-month-p1/p4`, `en-employee-p1/p2` and `en-month-p1/p4`, each `-saved-vs-print.png`.
- **Checks.**
  - `pytest test_leave_report_pdf.py test_leave_report_send.py`: 4 passed. The new tests cover the happy path (scripts stripped, CSP, wordmark inlined, font URLs on disk, base64 PDF back) and the missing browser (503 `PDF_BROWSER_UNAVAILABLE`).
  - ruff check and format on the changed backend files. mypy reports no errors in `sheet_pdf_service.py` or `leaves.py`.
  - `tsc -b --noEmit`, eslint on `ReportView.tsx` and `api.ts`, and `vitest src/pages/leaves/report` (15 passed).
  - `api.types.ts` was regenerated.
- **Review.** `i18n-rtl-reviewer` raised one must-fix: a cleared month input crashed `describe()`. It is now guarded. Its should-fix (a doubled separator when the scope is empty) is applied.

## F — Long tables must not run into the letterhead header/footer bands (user screenshots, 2026-10-14)

In the filed multi-employee General Book (e.g. 1/6/279 on dev), when a table continues onto the next page its first row sits on the red header band/line at the top of the page, and the last row of a page sits on the red footer band. Page 1 is fine. Fix it so body content always stays clear of the header and footer on every page.

- Find the cause in the General Book template (`backend/templates/`, the "General Book" entry in `core/constants.py`) and its render path (`_pp_general_book`, `arabic_rtl.html_to_docx`): likely the header/footer art is floating (anchored) so Word does not push the body, and the page margins/`w:header`/`w:footer` distances on continuation pages are smaller than the art. Fix at the root, for every General Book, not only leave reports; page 1 must look exactly as today.
- `.docx` rule: edit the template XML (unpack → edit → repack per the docx skill); never resave in Word. Prefer a template/sectPr margin fix over code; if the fix belongs in code (e.g. the renderer's section setup), keep it minimal.
- While there: mark the table's `<thead>` row as a repeating header row (`w:tblHeader`) and rows `w:cantSplit` in `html_to_docx`, so a continued table repeats its column titles — only if it is a few lines.
- Verify: render a long multi-employee report (≥ 3 pages) and an ordinary short General Book → PDF → PNG every page (`.tmp/gb-margins/`); check page 1 unchanged vs before, and continuation pages have clear space under the header and above the footer. Narrowest pytest for any code change; existing General Book tests pass. Commit `fix(general-book): keep body clear of the letterhead on continuation pages`, publish, append evidence.

### Evidence F (2026-10-14)
- **Cause.** Pages 2+ use the default header `header2.xml` and the default footer `footer1.xml`. Page 1 uses the first-page parts `header3.xml` and `footer2.xml` (`titlePg`). Both red bands are page-anchored `wrapNone` drawings, so Word does not push the body away from them. The body starts and ends where the in-flow header/footer paragraphs end. Measured on a 5-page render, page 2: header band 99.1–114.7pt, table top 114.7pt (touching); footer band 757.0pt, table bottom 753.5pt.
- **Fix (template XML only, no code).** Two attributes, patched in the zip without Word; every other part is byte-identical:
  - `header2.xml`: `w:spacing w:after="360"` on the last paragraph (18pt).
  - `footer1.xml`: `w:spacing w:before="300"` on the first paragraph (15pt).
  - Neither part renders on page 1, and page 1 is pixel-identical before and after (`ImageChops.difference(...).getbbox() is None`) for both the long and the short book.
- **After.** Pages 2+: the table starts at 130.0pt (15pt under the band). The body limit moves up 15pt, and rows stop at or above ~738pt, which keeps at least 18pt clear of the footer band. With these two-line rows the last row ended at 712pt.
- **Already present.** `html_to_docx` already sets `w:tblHeader` and `w:cantSplit` on `<thead>` rows. The column titles repeat on every continued page.
- **Editor guides.** The editor page-break guides use `GENERAL_BOOK_PAGE_VIEW.pageNBodyPx`, now 865 → 821, which is the 33pt of new clearance. `backend/scripts/measure_general_book_pages.py` can no longer run (`docx2pdf` is not installed), so this value is computed, not re-measured.
- **Existing books.** Books filed before the fix, such as 1/6/279, keep the letterhead they were rendered with. New and re-generated books get the fix.
- **PNGs.** In `.tmp/gb-margins/`: `before-long-p1..p5.png`, `after-long-p1..p6.png`, `before-short-p1.png` and `after-short-p1.png`.

## G — Options panel: every option on screen without scrolling the page (user, 2026-10-14)

User: "if I want to configure the panel and choose from the side rail, I need to scroll all the way to the bottom, then I can view the rest of the menu." The report's options column (the `19rem` left column in `ReportView.tsx`, `grid-cols-[19rem_minmax(0,1fr)]`) scrolls away with the long paper, so options further down (company, status, employee, sort, signatures) are only reachable by scrolling the whole page.

- Make the options column **sticky** beside the paper (`position: sticky`, top offset under the app header) with its own vertical scroll (`max-height` = viewport minus header, `overflow-y: auto`) so every option is reachable at any scroll position of the report. Native CSS only; logical properties; no JS scroll handling. `print:` output unchanged.
- Make it compact enough that, at a normal laptop height (1366×768 and 1440×900), all options fit without inner scrolling if that only takes spacing/density tweaks (tighter gaps, chip sizes). Do not remove options.
- First confirm with screenshots that this is the panel the user means. If the app's **main side navigation rail** has the same problem (its menu items below the fold unreachable without scrolling to the page bottom on long pages), fix that too at its root (shared layout), not only on this page.
- Below `lg` the layout is one column — keep it usable (sticky off there if it would cover the paper).
- Verify: Playwright screenshots on dev at 1366×768 and 1440×900, AR and EN, scrolled to the top and to the middle of a long month report (`.tmp/report-panel/`); all options visible/reachable; print preview unchanged. tsc/eslint on changed files; `i18n-rtl-reviewer`. Commit `fix(leaves-report): keep the options panel in view`, publish, append evidence.

### Evidence G (2026-10-14)
- **Panel confirmed.** The app has no side navigation rail. Navigation is the horizontal `TopNav`, and the shell is `h-screen`, so the window never scrolls. That clause of G does not apply. The report scrolls inside `TabRecords`' `overflow-auto` box, and the panel was already `lg:sticky lg:top-0`, but it had no height bound. Before: the panel is 824 px tall (AR) and 857 px (EN), while the box is 493 px at 768 and 625 px at 900. Reaching «خانات التوقيع» / "Signature lines" took 236–401 px of page scroll (`before-*.png`).
- **Fix (`ReportView.tsx`, classes only).** Added `lg:max-h-[calc(100dvh-21rem)] lg:overflow-y-auto` to the sticky panel. 21rem covers the shell header, the page header, the tabs, the Register/Report toolbar and the bottom padding. It is in rem, so it grows with the font scale, and too much leaves a gap instead of hiding options. Below `lg` the stacked layout is unchanged, because every new class is `lg:`. Native CSS, no JS, direction-neutral.
- **Density not changed.** The panel needs 824–857 px against 430 px (768) and 562 px (900) of room. Tighter gaps or chips cannot recover 260–430 px without removing options, so the panel scrolls inside itself.
- **After** (Playwright, month 2026-08, `.tmp/report-panel/after-{ar,en}-{1366x768,1440x900,1024x768}-{top,middle}.png`): the panel stays inside the box (bottom 737 px of 744 at 768, 869 of 876 at 900). The last option is reachable by scrolling only the panel, with 0 px of page scroll needed at top and middle, AR and EN.
- **Print.** `before-{ar,en}-print.png` and `after-{ar,en}-print.png` (print media, full page) are pixel-identical (`ImageChops.difference(...).getbbox() is None`).
- **Checks.** `tsc -b --noEmit`, `vite build` and eslint on `ReportView.tsx` were run in a throwaway worktree at HEAD plus this patch, because the shared tree had another agent's mid-edit `ReportView.tsx`. `i18n-rtl-reviewer`: clean.
