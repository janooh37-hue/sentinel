# Handoff: department scoping (PR #258), orchestrator notes

Updated 2026-10-24. The design and evidence are in `department-orgtree-rework.md`, in the
sections R (model), S (task-first setup) and T (account-first access). Research is in
`research-org-department-setup.md` and the critique in `org-editor-critique.md`.

## How to work (user instruction)

- Keep the orchestrator session light. Delegate all work to subagents and to the dtop
  Herdr agents; only review their results.
- Only the user approves merging PR #258 and any production deploy (`scripts/mng.ps1
  update` on the server). Never deploy from the laptop.

## Where things are

- **Branch** `feat/department-scoping` (PR #258), tip `fb111cdc`.
- **dtop worktree** `/home/amh/Projects/sentinel/.worktrees/dept-orgtree`. It tracks
  origin and is clean.
- **Herdr workspace** `w0` on machine `dtop` (DEPT-ORGTREE). Agents:
  - `dept-be` (pane `w0:p1`): backend.
  - `dept-fe` (`w0:p2`): idle; superseded by the agents below.
  - `dept-ui` (`w0:p3`): about 78% of its context used; don't reuse it.
  - `dept-ui2` (`w0:p4`): frontend, fresh.

  For new tasks, start a fresh agent that reads `.tmp/handoff-dept-be.md` or
  `.tmp/handoff-dept-ui.md` first (in the dtop worktree, untracked) and appends its own
  session section.
- **Laptop worktree** `C:/Users/GSSG/projects/sentinel/.worktrees/department-scoping`.
  It serves the preview. Pull here, never edit.
- **Commands on dtop:**
  - backend: `~/.venvs/sentinel/bin/python -m pytest -n 6 -p no:cacheprovider backend/tests`
    (about 3 minutes);
  - frontend: `pnpm -C frontend test`, `pnpm -C frontend exec tsc -b --noEmit`,
    `pnpm -C frontend run build`.
- **Known failures that also happen on `main`:**
  - backend: `test_inmate_reporter` worklist, `test_0099`, `test_schema_utc_serialization`
    (book schemas only), `test_vehicle_reminders`. `test_vehicle_import` has a flaky
    teardown error under `-n 6`;
  - frontend: 2 `PermitDocumentVersions` tests; `useRecordPrintMode` Cmd+P and
    `PdfPages` are flaky under load;
  - lint: the error in `e2e/signature-placement.spec.ts`.

## The preview the user tests

- **Address:** `https://gssglt.tail0c00ff.ts.net:8443/`, tailnet only. It is
  `tailscale serve --https=8443` pointing to `127.0.0.1:8766`.
- **Data:** its own copy at `C:\Users\GSSG\gssg-dev-data-departments`, on migration 0112.
  No `.vapid_key` or `.email_key`, and the scheduler is off. The user is actively setting
  up departments there: departments 1–6 and their services.
- **The shared dev URL** (`/`, port 8765, `dev` branch, data on 0109) belongs to another
  session that publishes `dev`. Don't touch it.
- **Republish** (laptop worktree):
  1. Stop the `serve.py` that listens on 8766.
  2. `git pull --ff-only`.
  3. `pnpm -C frontend run build`, then replace `backend/app/static/assets` and copy
     `frontend/dist/*` into `backend/app/static`.
  4. Start the server detached with a nested hidden `Start-Process`, logging to
     `.tmp/dept-preview.log(.err)`.
  5. Verify that 8766 health returns 200, that `data_dir` is the copy, and that the
     `:8443` bundle hash matches the build.

  Don't start servers in a way that inherits the shell's pipe, and don't use omp
  services for this; both got killed before.
- **Remove the preview:** run `.tmp/switch-back.ps1` in the laptop worktree when the user
  says "switch back". It turns off the `:8443` serve, stops 8766, deletes the data copy
  and the old `.bak`, and cleans `.env` and the static build.
- **Visual checks on real data:** use a subagent with a temporary admin account created
  in the copy's DB, read-only. It deletes the account afterwards and proves the data
  unchanged, comparing counts and hashes before and after.

## Current state of the product

- **Model:** a department is a head employee plus their reporting branch. Supervisors see
  their own branch. Admins can add deputies, "Extra department access" (viewer) grants,
  "Placed by hand" exceptions and services per department. "All departments" gives
  organization-wide access. While access limits are on, only admins can link accounts to
  employees.
- **UI:** Permissions → Organization & departments has four sections:
  - **Accounts** (the default): what each account sees and why, plus "Give more access".
    It warns about unattached units: unit tops who report to nobody.
  - **Departments**: the register and the 4-step guided setup.
  - **Reporting lines.**
  - **Placed by hand.**

  The Employees org tree is read-only.
- **Dev data insight for the user:** the 5 companies and the Support Group report to
  nobody. Linking their tops to the right Branch Managers ("Set who they report to" on
  the Accounts card) gives Project Manager → managers → supervisors → assistant
  supervisors → guards, with no hardcoding. Titles shown are the org tree's position
  field.

## Open items

- Teach the user the Accounts page with their own numbers:
  - Saeed sees 72 people; ahmed.alameri 15, hamdan.s 4, nasser.a 17, nasser.s 16;
    operators see only their own work; the admin sees all 273 working employees;
  - 6 unattached units.

  Answer any follow-up questions.
- Not from this branch:
  - in the global top bar, the text-size slider overlaps "Permits" at 1366px;
  - some top-bar accessibility labels stay in English in Arabic mode;
  - the catalogue spells "Branche Manager".
- Before merging, give PR #258 a final summary comment covering redesigns S and T.
