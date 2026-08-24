# "How We Work" Management PDFs (EN+AR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two polished A4 PDFs (English + Arabic) showing the complete roundtrip of a form/request in GSSG Manager, quietly contrasted with the old manual path, using real staged screenshots as employee G3082.

**Architecture:** Stage a local copy of the production app (separate data dir + port), run one real Annual Leave Application through the full cycle as G3082, capture EN+AR screenshots with Playwright at retina sharpness, then build two styled HTML documents (shared print CSS) and render them to PDF with headless Chromium.

**Tech Stack:** Python venv (`venv\Scripts\python.exe`) for staging scripts, Node Playwright from `frontend/node_modules` for capture + PDF render, plain HTML/CSS for the documents.

**Spec:** `docs/superpowers/specs/2026-07-09-forms-roundtrip-pdf-design.md` — read it first. Its "Accuracy rule", "Screenshot quality gate", tone rules, and page structure are binding.

## Global Constraints

- **Never touch production.** The live service (port 8765, `data/`) is read-only for this work. All writes go to the stage copy. Never run `mng deploy/update/restart`.
- **Stage instance:** `GSSG_DATA_DIR=<scratchpad>\stage-data`, `GSSG_PORT=8899`, `GSSG_HOST=127.0.0.1`, `GSSG_SMS_ENABLED=0`, `GSSG_WHATSAPP_ENABLED=0` — explicit env vars override the project `.env`.
- **Tone (both languages):** professional business register, plain modern words, no ornate vocabulary, never childish. Arabic formal and plain. The word "app" never appears in the title; persuasion stays implicit.
- **Explicit old-way contrast appears exactly 4 times total:** the "two paths" page + 3 "Previously:" footnotes (steps 3, 4, 6). Nowhere else.
- **Colors (from `frontend/src/index.css` light theme):** navy `#0d2845`, navy-hover `#1d3a5e`, navy-soft `#e8edf3`, red `#c8102e` (max ~2 uses per document), bg `#f5f4f1`, surface `#ffffff`, text `#1c1f24`, muted `#5a6068`, border `#e6e4dd`.
- **Screenshot quality gate (hard):** `deviceScaleFactor: 2`, fonts/images/logo fully loaded, no cramped/wrapped logo, no clipped text, no scrollbars/dev artifacts, correct language + correct RTL mirroring in AR shots. Failed shots are re-staged, never shipped.
- **Every factual claim** in the copy must match the "Content grounding" list in the spec. Don't invent counts or behavior.
- **Commits:** this repo deliberately keeps `docs/` artifacts untracked (see git status history). Do NOT commit deliverables unless the user asks; the final task offers it.
- **Scratchpad:** use the session scratchpad directory for the stage copy, not `/tmp` and not the repo.

## File Structure

```
docs/how-we-work/
  assets/
    styles.css            # shared design system (used by both HTML docs)
    gssg-logo.png          # copied from frontend/public/brand/gssg-logo.png
    fonts/                 # Noto Naskh Arabic woff2 (AR); system fonts otherwise
  shots/
    en/<scene>.png         # English captures
    ar/<scene>.png         # Arabic captures
  capture.mjs              # Playwright capture script (--lang en|ar --phase pending|signed)
  render.mjs               # HTML -> PDF (A4, printBackground)
  how-we-work-en.html      # English document (13-14 pages)
  how-we-work-ar.html      # Arabic document (RTL mirror)
  how-we-work-en.pdf       # deliverable
  how-we-work-ar.pdf       # deliverable
<scratchpad>/stage-data/   # stage copy of production data (NOT in repo)
<scratchpad>/stage-*.py    # one-off staging scripts (NOT in repo)
```

---

### Task 1: Stage environment

**Files:**
- Create: `<scratchpad>/stage-data/` (data copy), `<scratchpad>/stage_reset_login.py`
- Read-only: `data/gssg.db`, `data/vault/`, `backend/serve.py`, `backend/app/config.py`

**Interfaces:**
- Produces: a running stage server at `http://127.0.0.1:8899` serving the committed frontend build, logged-in-able as G3082 with password `Stage#2026`. Later tasks call its API and screenshot its UI.

- [ ] **Step 1: Create stage dir and copy the vault (excluding junk)**

Run from repo root (Bash tool; `$SCRATCH` = the session scratchpad path):

```bash
STAGE="$SCRATCH/stage-data"
mkdir -p "$STAGE"
# vault + book_attachments are needed for photos/signatures/PDF scenes
cp -r data/vault "$STAGE/vault"
cp -r data/book_attachments "$STAGE/book_attachments" 2>/dev/null || true
# deliberately NOT copied: backups/, crash-reports/, logs/, *.bak*, .email_key, .vapid_key
```

Expected: copies complete (~1.1 GB, allow a few minutes; raise Bash timeout).

- [ ] **Step 2: Copy the live SQLite DB safely (backup API, not file copy)**

The live service writes to `data/gssg.db` (WAL mode) — use SQLite's backup API for a consistent snapshot:

```bash
venv/Scripts/python.exe -c "
import sqlite3
src = sqlite3.connect('data/gssg.db')
dst = sqlite3.connect(r'$STAGE/gssg.db'.replace('\$STAGE', r'<paste absolute stage path>'))
src.backup(dst)
dst.close(); src.close()
print('snapshot ok')
"
```

Expected: `snapshot ok`. Verify with `venv/Scripts/python.exe -c "import sqlite3; print(sqlite3.connect(r'<stage>/gssg.db').execute('select count(*) from employees').fetchone())"` — a real employee count, no error.

- [ ] **Step 3: Find the G3082 user and reset its stage password**

First verify the employees G-number column name: `grep -n "g_number" backend/app/db/models.py | head -3` (expected: `Employee.g_number`). Then write `<scratchpad>/stage_reset_login.py`:

```python
"""Reset the stage password for the G3082 user. Runs against the STAGE db only."""
import sqlite3, sys
sys.path.insert(0, "backend")
from app.core.security import hash_password

STAGE_DB = r"<absolute path>\stage-data\gssg.db"
con = sqlite3.connect(STAGE_DB)
row = con.execute(
    "SELECT u.id, u.email, u.display_name FROM users u "
    "JOIN employees e ON e.id = u.employee_id WHERE e.g_number = 'G3082'"
).fetchone()
assert row, "no user linked to G3082 — check employees.g_number / users.employee_id"
con.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password("Stage#2026"), row[0]))
con.commit()
print("user:", row)  # note the email + display_name — needed for login and the PDF cover
```

Run: `venv/Scripts/python.exe <scratchpad>/stage_reset_login.py`
Expected: prints the user id/email/display_name. **Record the email and display_name** (display_name goes on the PDF cover).

- [ ] **Step 4: Launch the stage server (background)**

```bash
GSSG_DATA_DIR="$STAGE" GSSG_PORT=8899 GSSG_HOST=127.0.0.1 \
GSSG_SMS_ENABLED=0 GSSG_WHATSAPP_ENABLED=0 GSSG_SECURE_COOKIES=0 \
venv/Scripts/python.exe backend/serve.py
```

Run with `run_in_background: true`. Expected: uvicorn startup line mentioning `127.0.0.1:8899`.

- [ ] **Step 5: Verify login works**

```bash
curl -s -i -X POST http://127.0.0.1:8899/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<g3082 email>","password":"Stage#2026"}' | head -20
```

Expected: `200 OK` + a session cookie header. Also `curl -s http://127.0.0.1:8899/ | head -5` returns the frontend HTML. If login 401s, re-check Step 3.

---

### Task 2: Stage the leave request (up to "pending approval")

**Files:**
- Create: `<scratchpad>/stage_notes.md` (records ids/refs/emails discovered — later tasks read it)
- Read-only: `backend/app/api/v1/documents.py`, `backend/app/core/constants.py`, `backend/app/core/form_policy.py`

**Interfaces:**
- Consumes: stage server + G3082 session (Task 1).
- Produces (written into `stage_notes.md`): `BOOK_ID`, `REF_NUMBER`, `EMPLOYEE_ID` (G3082's employee row id), `MANAGER_USER_ID` + `MANAGER_EMAIL` (approval assignee, password also reset to `Stage#2026`), `SMS_EMPLOYEE_ID` (an employee with real sent SMS history), `SCAN_STATE` (what the scan inbox shows).

- [ ] **Step 1: Identify the Leave Application template id and its signing path**

```bash
grep -n "Leave_Application" backend/app/core/constants.py
grep -n "leave" backend/app/core/form_policy.py | head -20
```

Expected: two leave templates (300-003 / 301-003). Pick the one whose form policy is **in_app** (an approval step must exist for the pending scenes). If neither is in_app, pick the in_app form closest to the story and keep the Leave Application for the generation scenes — note the decision in `stage_notes.md`.

- [ ] **Step 2: Find the generation endpoint contract**

```bash
grep -n "def \|router.post" backend/app/api/v1/documents.py | head -20
```

Read the request schema it references (in `backend/app/schemas/`). Expected: a POST endpoint taking template id, employee, fields, commit flag.

- [ ] **Step 3: Generate one Annual Leave Application for employee G3082 (committed)**

Log in with curl (save cookie jar), then POST the generation payload: template = Leave Application (in_app), employee = G3082's employee id, leave type "Annual Leave", a clean 5-working-day range in the near future, `commit=true`. Exact JSON shape comes from Step 2's schema.

Expected: 200 response containing the new document + ref number (format like `HR-0042`). Word must be installed (it is — this machine renders production docs); the response/DB should show a non-null `pdf_path`.

- [ ] **Step 4: Verify the staged rows and find the approval assignee**

```bash
venv/Scripts/python.exe -c "
import sqlite3
con = sqlite3.connect(r'<stage>/gssg.db')
book = con.execute(\"SELECT id, ref_number, approval_state FROM books ORDER BY id DESC LIMIT 1\").fetchone()
step = con.execute('SELECT assignee_user_id, state FROM book_approval_steps WHERE book_id=? ORDER BY step_order', (book[0],)).fetchone()
print('book:', book, 'step:', step)
u = con.execute('SELECT id, email, display_name, signature_path FROM users WHERE id=?', (step[0],)).fetchone()
print('manager user:', u)
"
```

Expected: `approval_state = 'pending'`, one step `pending`, and the manager user **has a non-null signature_path** whose file exists under the stage vault. If the signature is missing, pick a different target employee whose default manager has one (query users where signature_path is not null, then an employee managed by them) and regenerate. Reset the manager's stage password with the same technique as Task 1 Step 3. Record everything in `stage_notes.md`.

- [ ] **Step 5: Pick the SMS-history employee and check the scan inbox**

```bash
venv/Scripts/python.exe -c "
import sqlite3
con = sqlite3.connect(r'<stage>/gssg.db')
print(con.execute(\"SELECT employee_id, count(*) FROM sms_messages WHERE status='sent' GROUP BY employee_id ORDER BY 2 DESC LIMIT 5\").fetchall())
print(con.execute('SELECT state, count(*) FROM scan_inbox GROUP BY state').fetchall())
"
```

Expected: at least one employee with several sent SMS (photograph that Messages tab — SMS is disabled on stage so nothing new sends). For the scan inbox: if there is at least one `auto_filed` or `awaiting_confirmation` row, note its owner user; the scene may need to be captured logged in as that owner. If the inbox is empty for every user, note `SCAN_STATE=needs-seeding` — Task 4 has a seeding fallback.

---

### Task 3: Capture script + "pending" phase screenshots (EN + AR)

**Files:**
- Create: `docs/how-we-work/capture.mjs`, `docs/how-we-work/shots/en/*.png`, `docs/how-we-work/shots/ar/*.png`

**Interfaces:**
- Consumes: stage server, `stage_notes.md` ids, G3082 + manager credentials (`Stage#2026`).
- Produces: `shots/<lang>/<scene>.png` files. Scene names are fixed — the HTML tasks reference them exactly: `services`, `form-filled`, `record-created`, `approval-queue`, `approval-phone`, then (Task 4) `record-signed`, `messages-tab`, `email-compose`, `scan-inbox`, `employee-file`, `dashboard`.

- [ ] **Step 1: Confirm the i18n localStorage key**

```bash
grep -n "lookupLocalStorage\|detection" frontend/src/lib/i18n.ts
```

i18next's default key is `i18nextLng`; use whatever the config says. The capture script sets it before page load so the app boots in the target language (AR must render `dir="rtl"`).

- [ ] **Step 2: Write `docs/how-we-work/capture.mjs`**

```js
// Screenshot capture for the "How We Work" PDFs.
// Usage: node docs/how-we-work/capture.mjs --lang en --phase pending
// Playwright is resolved from frontend/node_modules (no local install).
import { createRequire } from "module";
import { mkdirSync } from "fs";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8899";
const lang = process.argv[process.argv.indexOf("--lang") + 1];   // en | ar
const phase = process.argv[process.argv.indexOf("--phase") + 1]; // pending | signed
const N = JSON.parse(process.env.STAGE_NOTES); // {bookId, ref, employeeId, smsEmployeeId, g3082Email, managerEmail}

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function login(page, email) {
  await page.goto(BASE + "/");
  await page.getByLabel(/email|البريد/i).fill(email);
  await page.getByLabel(/password|كلمة/i).fill("Stage#2026");
  await page.getByRole("button", { name: /sign in|log ?in|دخول/i }).click();
  await page.waitForURL("**/"); // dashboard
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400); // let images/logo finish painting
}

// Scenes. `as` picks the login identity; `viewport` defaults to DESKTOP.
// Selector details below are best-effort — verify each against the live UI
// (getByRole / getByText on the rendered page) and adjust in place.
const SCENES = {
  pending: [
    { name: "services", url: "/application" },
    { name: "form-filled", url: "/application", prepare: async (p) => {
        await p.getByText(/Leave Application|طلب إجازة/i).first().click();
        // pick employee G3082, set the same dates used in staging; DO NOT save
      } },
    { name: "record-created", url: `/books?open=${"" + N.bookId}` },
    { name: "approval-queue", url: "/books", as: "manager" },
    { name: "approval-phone", url: `/books/${N.bookId}`, as: "manager", viewport: PHONE },
  ],
  signed: [
    { name: "record-signed", url: `/books/${N.bookId}` },
    { name: "messages-tab", url: `/employees/${N.smsEmployeeId}`, prepare: async (p) => {
        await p.getByRole("tab", { name: /messages|الرسائل/i }).click();
      } },
    { name: "email-compose", url: "/ledger", prepare: async (p) => {
        await p.getByRole("button", { name: /compose|new|إنشاء/i }).click();
        // type a line containing the staged ref (e.g. "Please find HR-0042 attached")
        // and G3082 so smart chips render; enable "Attach reference PDFs"; DO NOT send
      } },
    { name: "scan-inbox", url: "/scan-inbox" },
    { name: "employee-file", url: `/employees/${N.employeeId}` },
    { name: "dashboard", url: "/" },
  ],
};

const browser = await chromium.launch();
for (const scene of SCENES[phase]) {
  const ctx = await browser.newContext({
    viewport: scene.viewport ?? DESKTOP,
    deviceScaleFactor: 2,
    locale: lang === "ar" ? "ar" : "en",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.addInitScript((l) => localStorage.setItem("i18nextLng", l), lang);
  await login(page, scene.as === "manager" ? N.managerEmail : N.g3082Email);
  await page.goto(BASE + scene.url);
  await settle(page);
  if (scene.prepare) { await scene.prepare(page); await settle(page); }
  mkdirSync(new URL(`./shots/${lang}`, import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`./shots/${lang}/${scene.name}.png`, import.meta.url).pathname.slice(1) });
  console.log(`ok ${lang}/${scene.name}`);
  await ctx.close();
}
await browser.close();
```

- [ ] **Step 3: Run the pending phase for both languages**

```bash
export STAGE_NOTES='{"bookId":..., "ref":"...", "employeeId":"...", "smsEmployeeId":"...", "g3082Email":"...", "managerEmail":"..."}'
node docs/how-we-work/capture.mjs --lang en --phase pending
node docs/how-we-work/capture.mjs --lang ar --phase pending
```

Expected: `ok en/...` × 5 and `ok ar/...` × 5, files appear under `shots/`. Selector failures are normal on first run — open the page, find the real roles/labels, fix the script, re-run. The script is idempotent (overwrites shots).

- [ ] **Step 4: Eyeball the 10 pending shots**

Read each PNG (Read tool renders images). Check against the quality gate: logo intact and not cramped, right language, RTL mirrored in AR, no spinners/scrollbars/clipped text, the form-filled scene shows G3082's name, the phone scene shows the Sign button. Re-capture failures now — Task 4 destroys the pending state.

---

### Task 4: Approve + sign, then "signed" phase screenshots (EN + AR)

**Files:**
- Modify: `docs/how-we-work/capture.mjs` (only if selectors need fixes)
- Create: `docs/how-we-work/shots/{en,ar}/{record-signed,messages-tab,email-compose,scan-inbox,employee-file,dashboard}.png`

**Interfaces:**
- Consumes: pending book from Task 2, capture script from Task 3.
- Produces: the remaining 12 shots; the staged book in `approved` state with an embedded signature.

- [ ] **Step 1: Sign the book as the manager (via API)**

```bash
grep -n "sign" backend/app/api/v1/books.py | head   # confirm the sign endpoint path
# login as manager -> cookie jar -> POST the sign endpoint for BOOK_ID
```

Expected: 200; then verify in the stage DB: `approval_state='approved'`, `BookVersion.signed_pdf_path` non-null, file exists.

- [ ] **Step 2: Seed the scan inbox if Task 2 found it empty**

Only if `SCAN_STATE=needs-seeding`: copy the signed PDF from Step 1 to a temp file and enqueue + drain it with the app's own services against the stage DB (`GSSG_DATA_DIR` env set to the stage path, `sys.path.insert(0, "backend")`, call `scan_inbox_service.enqueue_*` then the drain function — read `backend/app/services/scan_inbox_service.py` for the two entry points). Expected: one row in `awaiting_confirmation` or `auto_filed` owned by G3082's user.

- [ ] **Step 3: Capture the signed phase, both languages**

```bash
node docs/how-we-work/capture.mjs --lang en --phase signed
node docs/how-we-work/capture.mjs --lang ar --phase signed
```

Expected: 6 `ok` lines per language.

- [ ] **Step 4: Full quality-gate review of all 22 shots**

Read every PNG in `shots/en/` and `shots/ar/`. Apply the spec's gate item by item (logo, language, RTL, no artifacts, subject visible). Keep a pass/fail list; re-stage and re-capture every failure. Do not proceed until all 22 pass. The two most likely failures per the user's warning: the **logo wordmark cramping** (fix: adjust viewport width for that scene) and RTL leakage in AR shots.

---

### Task 5: Document assets + design system CSS

**Files:**
- Create: `docs/how-we-work/assets/styles.css`, `docs/how-we-work/assets/gssg-logo.png`, `docs/how-we-work/assets/fonts/` (AR font)

**Interfaces:**
- Produces: `assets/styles.css` class vocabulary used verbatim by both HTML tasks: `.page`, `.cover`, `.index-list`, `.paths`, `.path-old`, `.path-new`, `.step-page`, `.step-num`, `.progress-rail`, `.shot`, `.shot-caption`, `.ring`, `.phone-frame`, `.footnote`, `.catalog-grid`, `.ahead-list`, `.doc-footer`.

- [ ] **Step 1: Copy the logo and fetch the Arabic font**

```bash
mkdir -p docs/how-we-work/assets/fonts docs/how-we-work/shots
cp frontend/public/brand/gssg-logo.png docs/how-we-work/assets/
curl -s -A "Mozilla/5.0" "https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap" -o /tmp/naskh.css
grep -o "https://[^)]*woff2" /tmp/naskh.css   # download each URL into assets/fonts/
```

If offline, skip the download and use the Windows-bundled fallback stack (`"Sakkal Majalla", "Traditional Arabic"`) — Chromium renders these fine; note the substitution.

- [ ] **Step 2: Write `assets/styles.css`**

Complete design system (this is the actual file content; extend only with more of the same):

```css
/* How We Work — print design system. A4 portrait, GSSG identity. */
@page { size: A4; margin: 0; }
:root {
  --navy: #0d2845; --navy-2: #1d3a5e; --navy-soft: #e8edf3;
  --red: #c8102e; --bg: #f5f4f1; --surface: #ffffff;
  --text: #1c1f24; --muted: #5a6068; --border: #e6e4dd;
}
* { box-sizing: border-box; margin: 0; }
html { font-size: 10.5pt; }
body { font-family: "Segoe UI", system-ui, sans-serif; color: var(--text); background: var(--bg); }
[dir="rtl"] body, body[dir="rtl"] { font-family: "Noto Naskh Arabic", "Sakkal Majalla", "Traditional Arabic", serif; }
h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; color: var(--navy); font-weight: 600; }
[dir="rtl"] h1, [dir="rtl"] h2, [dir="rtl"] h3 { font-family: inherit; font-weight: 700; }

.page { width: 210mm; height: 297mm; padding: 22mm 20mm 18mm; background: var(--bg);
        position: relative; overflow: hidden; page-break-after: always; }
.doc-footer { position: absolute; bottom: 10mm; inset-inline: 20mm; display: flex;
              justify-content: space-between; font-size: 8pt; color: var(--muted);
              border-top: 0.4pt solid var(--border); padding-top: 3mm; }

/* Cover */
.cover { background: var(--navy); color: #fff; display: flex; flex-direction: column;
         justify-content: center; align-items: center; text-align: center; gap: 10mm; }
.cover img { width: 42mm; }
.cover h1 { color: #fff; font-size: 26pt; }
.cover .subtitle { font-size: 13pt; color: var(--navy-soft); }
.cover .byline { position: absolute; bottom: 24mm; font-size: 10pt; color: var(--navy-soft); }

/* Index */
.index-list { list-style: none; margin-top: 12mm; }
.index-list li { display: flex; align-items: baseline; gap: 3mm; font-size: 12pt; padding: 3.2mm 0; }
.index-list .leader { flex: 1; border-bottom: 1pt dotted var(--navy-2); opacity: .45; }
.index-list .pageno { color: var(--navy); font-variant-numeric: tabular-nums; }

/* Two paths */
.paths { display: flex; flex-direction: column; gap: 16mm; margin-top: 18mm; }
.path { display: flex; align-items: center; }
.path .stop { flex: 1; text-align: center; font-size: 8.5pt; position: relative; padding-top: 7mm; }
.path .stop::before { content: ""; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
                      width: 3.2mm; height: 3.2mm; border-radius: 50%; }
.path .stop::after { content: ""; position: absolute; top: 1.4mm; inset-inline-start: calc(50% + 2mm);
                     width: calc(100% - 4mm); height: 0.5mm; }
.path .stop:last-child::after { display: none; }
.path-old .stop { color: var(--muted); }
.path-old .stop::before { background: #b9b6ad; } .path-old .stop::after { background: #d4d1c8; }
.path-new .stop { color: var(--navy); font-weight: 600; font-size: 10pt; }
.path-new .stop::before { background: var(--navy); } .path-new .stop::after { background: var(--navy-2); }

/* Step pages */
.step-num { font-family: Georgia, serif; font-size: 30pt; color: var(--navy); opacity: .18; }
.step-page h2 { font-size: 17pt; margin: 2mm 0 5mm; }
.step-page p { font-size: 11pt; line-height: 1.65; max-width: 150mm; }
.progress-rail { position: absolute; top: 40mm; inset-inline-end: 8mm; display: flex;
                 flex-direction: column; gap: 2.4mm; }
.progress-rail i { width: 1.8mm; height: 1.8mm; border-radius: 50%; background: var(--border); }
.progress-rail i.on { background: var(--navy); }
.footnote { margin-top: 5mm; font-size: 9pt; font-style: italic; color: var(--muted); }

/* Screenshots */
.shot { margin-top: 7mm; background: var(--surface); border: 0.6pt solid var(--navy-soft);
        border-radius: 2mm; padding: 2.5mm; box-shadow: 0 1mm 3mm rgba(13,40,69,.08); position: relative; }
.shot img { width: 100%; display: block; border-radius: 1mm; }
.shot-caption { font-size: 8.5pt; color: var(--muted); margin-top: 2mm; text-align: center; }
.ring { position: absolute; border: 0.8mm solid var(--red); border-radius: 50%; pointer-events: none; }
.phone-frame { width: 62mm; margin: 7mm auto 0; border: 1.6mm solid var(--navy); border-radius: 7mm;
               padding: 1.6mm; background: #000; }
.phone-frame img { border-radius: 5mm; width: 100%; display: block; }

/* Catalog + looking ahead */
.catalog-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 10mm; }
.catalog-grid .tile { background: var(--surface); border: 0.5pt solid var(--border); border-radius: 2mm;
                      padding: 5mm 3mm; text-align: center; font-size: 9pt; }
.catalog-grid .tile .emoji { display: block; font-size: 16pt; margin-bottom: 2mm; }
.ahead-list { margin-top: 8mm; display: flex; flex-direction: column; gap: 6mm; }
.ahead-list .idea { border-inline-start: 1mm solid var(--navy-soft); padding-inline-start: 5mm; }
.ahead-list .idea h3 { font-size: 12pt; margin-bottom: 1.5mm; }
.ahead-list .idea p { font-size: 10.5pt; line-height: 1.6; color: var(--text); }
@font-face { font-family: "Noto Naskh Arabic"; src: url("fonts/naskh-400.woff2") format("woff2");
             font-weight: 400; }
@font-face { font-family: "Noto Naskh Arabic"; src: url("fonts/naskh-700.woff2") format("woff2");
             font-weight: 700; }
```

- [ ] **Step 3: Verify assets exist**

Run: `ls docs/how-we-work/assets docs/how-we-work/assets/fonts`
Expected: `styles.css`, `gssg-logo.png`, and the woff2 files (or a note that system fonts are used).

---

### Task 6: English HTML document

**Files:**
- Create: `docs/how-we-work/how-we-work-en.html`

**Interfaces:**
- Consumes: `assets/styles.css` classes, `shots/en/*.png` (exact scene names from Task 3/4).
- Produces: a complete 14-page HTML document; Task 8 renders it verbatim.

- [ ] **Step 1: Write the document skeleton and cover + index**

`<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="assets/styles.css"></head><body>` then one `<section class="page">` per page. Cover:

```html
<section class="page cover">
  <img src="assets/gssg-logo.png" alt="GSSG">
  <h1>How Our Work Moves</h1>
  <p class="subtitle">The path of a request, from start to file</p>
  <p class="byline">Prepared by <b>[display_name from stage_notes]</b> — G3082 · July 2026</p>
</section>
```

Index (`.index-list`, entries + page numbers — finalize numbers after render): The Two Paths · Step 1 Starting a Request · Step 2 Creating the Document · Step 3 Approval and Signature · Step 4 Notifying the Employee · Step 5 Related Correspondence · Step 6 Incoming Scans · Step 7 The Completed Record · Oversight · One Path, Every Form · Looking Ahead · Closing.

- [ ] **Step 2: The Two Paths page**

Old path stops (`.path-old`): Write in Word → Print → Carry for signatures → Wait → Scan → Sort into folders → Write an email → Send and file.
New path stops (`.path-new`): Start the request → Approve → Filed.
Single sentence below (muted, centered): *"Both paths end with the same signed document on file. The difference is the distance it travels."*

- [ ] **Step 3: The seven step pages — exact copy**

Each step page: `.step-num` ("01".."07"), `<h2>` title, prose, `.shot` with image + `.shot-caption`, `.progress-rail` (7 dots, current one `.on`), `.doc-footer`. Footnotes only on steps 3, 4, 6. The copy (use verbatim):

**Step 1 — Starting a Request** *(shot: services + form-filled)*
"Every request starts in one place: the Services screen. The officer picks the form, selects the employee, and the employee's details fill in from their file. There is nothing to copy from old documents and nothing to retype."
Captions: "The Services screen — every form starts here." / "The form, filled — the employee's details arrive on their own."

**Step 2 — Creating the Document** *(shot: record-created; red ring on the ref number)*
"The moment the form is saved, the official document is created. It receives its reference number automatically — issued in sequence, never repeated — with a scannable code stamped on the page. The finished PDF is ready the same second. For annual leave, the undertaking form is prepared with it, under the same reference."
Caption: "The document, seconds after saving — numbered, stamped, and ready."

**Step 3 — Approval and Signature** *(shots: approval-queue + approval-phone in `.phone-frame`)*
"The request goes straight to the manager's approval queue. The manager reviews the actual document — at the desk or on the phone — and approves with one tap. The signature is placed into the official document, and the record locks so nothing changes after signing."
Footnote: "Previously: printed, carried from desk to desk, and waiting until the right person was in the office."
Captions: "The approval queue — everything waiting, in one list." / "Approval from the phone — wherever the manager is."

**Step 4 — Notifying the Employee** *(shot: messages-tab; red ring on one message)*
"As soon as the document is issued, the employee receives a text message in their own language — Arabic or English — with the dates and the details. No one has to remember to inform them, and every message is kept on the employee's file."
Footnote: "Previously: the employee asked at the office, or waited to hear."
Caption: "The employee's messages — sent automatically, kept on file."

**Step 5 — Related Correspondence** *(shot: email-compose)*
"Letters and emails are written on the same screen where the records live. Typing an employee number or a reference number turns it into a direct link, and the referenced document attaches itself to the email. What is sent is exactly what is on file."
Caption: "An email in progress — the reference becomes a link, the document attaches itself."

**Step 6 — Incoming Scans** *(shot: scan-inbox)*
"When a signed paper comes back — from the scanner or by email — it lands in one inbox. The system reads it, recognizes the reference, and files it to the right record on its own. The officer only confirms."
Footnote: "Previously: scan, rename, sort into folders, then write and send an email."
Caption: "The scan inbox — papers file themselves; the officer confirms."

**Step 7 — The Completed Record** *(shot: employee-file)*
"The signed document rests in the employee's file, next to everything else that concerns them. The leave balance updates by itself, the yearly report reflects it immediately, and anyone who needs the record finds it in seconds."
Caption: "The employee's file — the complete record, in one place."

- [ ] **Step 4: Oversight, catalog, looking-ahead, closing pages**

**Oversight** *(shot: dashboard)*: "Management sees the whole picture on one screen: who is on leave today, what is waiting for approval, and which passports and visas expire soon. No requests for status reports — the status is always on."

**One Path, Every Form**: `.catalog-grid` with the 16 real tiles (emoji + name — copy the exact pairs from `frontend/src/pages/quickActions.ts` / the services gallery: ✍️ Acknowledgment Form, 💰 Salary Transfer Request, 💸 Salary Deduction, 🚨 Violation Form, ✅ Employee Clearance, 📅 Leave Application, 📤 Passport Release, 🔁 Duty Resumption, 📦 Material Request, 📓 General Book, 🧑‍💼 HR Request, ✉️ Resignation Letter, 🎫 Leave Permit, 🗂️ Administrative Leave, ⚠️ Warning Form, 🛂 Passport Release List). Line above the grid: "Leave applications, clearances, warnings, salary forms, passport releases — every one of them travels the same road: created, approved, communicated, and filed."

**Looking Ahead — Notes for the Next Level** (`.ahead-list`, first person, modest): intro line "The path above is working today. These are my notes on where it can go next." Then five ideas:
1. *WhatsApp alongside SMS* — "The WhatsApp channel is already built into the system and waits for activation. Once approved, notifications can reach employees on the channel they check most."
2. *Automatic reminders* — "The system knows when a leave ends and when a passport or visa expires. The next step is letting it remind people on its own — a message before the return date, an alert before the expiry."
3. *Employee self-service* — "Today, requests start at the HR desk. The natural next step is letting employees open their own requests from their phones, with the same path handling approval and filing."
4. *Smarter document reading* — "Scanned passports and IDs are already read automatically. Widening this to more document types will remove the last of the manual typing."
5. *A monthly management summary* — "The data is already in one place. A one-page monthly summary — leaves, approvals, violations — can be produced automatically for management."

**Closing page**: "One path for every request — in Arabic and English, at the desk or on the phone, with every step recorded as it happens. This document was prepared from the live system, as it works today." + `.doc-footer`.

- [ ] **Step 5: Open in a browser and eyeball**

Run: `start docs/how-we-work/how-we-work-en.html` (or Read/screenshot it via Playwright). Check: each `.page` is one clean A4, no overflow, shots sharp, red rings positioned on the right spots (`.ring` uses inline `style="top:..%;left:..%;width:..;height:.."` per shot — set them by looking at each image).

---

### Task 7: Arabic HTML document

**Files:**
- Create: `docs/how-we-work/how-we-work-ar.html`

**Interfaces:**
- Consumes: same stylesheet + `shots/ar/*.png`.
- Produces: the RTL mirror document, same 14-page structure.

- [ ] **Step 1: Write the document**

`<html lang="ar" dir="rtl">` — same page structure and classes as the EN file (the CSS uses logical properties, so the layout mirrors on its own). All copy in formal plain Arabic (use verbatim):

- **Cover:** title `كيف يسير العمل لدينا` · subtitle `مسار الطلب من بدايته حتى حفظه` · byline `إعداد: [الاسم] — G3082 · يوليو 2026`
- **Two paths** — old stops: `الكتابة في وورد ← الطباعة ← التنقل للتواقيع ← الانتظار ← المسح الضوئي ← الفرز في مجلدات ← كتابة بريد ← الإرسال والحفظ` · new stops: `إنشاء الطلب ← الاعتماد ← الحفظ` · sentence: `كلا الطريقين ينتهي بالمستند الموقع نفسه محفوظاً في الملف. الفرق هو المسافة التي يقطعها.`
- **Step 1 — بداية الطلب:** `كل طلب يبدأ من مكان واحد: شاشة الخدمات. يختار الموظف المختص النموذج، ويحدد الموظف المعني، فتُعبأ بياناته تلقائياً من ملفه. لا نسخ من مستندات قديمة، ولا إعادة كتابة.`
- **Step 2 — إنشاء المستند:** `بمجرد حفظ النموذج، يُنشأ المستند الرسمي. يحصل تلقائياً على رقم مرجعي متسلسل لا يتكرر، مع رمز قابل للمسح مطبوع على الصفحة. وتكون نسخة PDF جاهزة في اللحظة نفسها. وفي الإجازة السنوية، يُعد نموذج التعهد معه تحت المرجع ذاته.`
- **Step 3 — الاعتماد والتوقيع:** `ينتقل الطلب مباشرة إلى قائمة اعتماد المدير. يراجع المدير المستند نفسه — من مكتبه أو من هاتفه — ويعتمده بلمسة واحدة. يُدرج توقيعه في المستند الرسمي، ويُقفل السجل فلا يتغير شيء بعد التوقيع.` · footnote: `سابقاً: يُطبع الطلب ويُنقل من مكتب إلى مكتب بانتظار وجود المسؤول.`
- **Step 4 — إبلاغ الموظف:** `فور صدور المستند، تصل الموظفَ رسالة نصية بلغته — بالعربية أو بالإنجليزية — تتضمن التواريخ والتفاصيل. لا حاجة لأن يتذكر أحد إبلاغه، وكل رسالة تُحفظ في ملف الموظف.` · footnote: `سابقاً: يسأل الموظف في المكتب أو ينتظر من يخبره.`
- **Step 5 — المراسلات المرتبطة:** `تُكتب الرسائل والمراسلات من الشاشة نفسها التي تُحفظ فيها السجلات. كتابة رقم الموظف أو الرقم المرجعي تحوّله إلى رابط مباشر، ويُرفق المستند المشار إليه تلقائياً بالرسالة. فما يُرسل هو المحفوظ في الملف تماماً.`
- **Step 6 — المستندات الواردة:** `عندما تعود ورقة موقعة — من الماسح الضوئي أو عبر البريد — تصل إلى صندوق وارد واحد. يقرأها النظام، ويتعرف على المرجع، ويحفظها في السجل الصحيح من تلقاء نفسه. ولا يبقى على الموظف المختص إلا التأكيد.` · footnote: `سابقاً: مسح ضوئي، ثم إعادة تسمية، ثم فرز في مجلدات، ثم كتابة رسالة وإرسالها.`
- **Step 7 — السجل المكتمل:** `يستقر المستند الموقع في ملف الموظف إلى جانب كل ما يخصه. يتحدّث رصيد الإجازات تلقائياً، ويظهر الأثر في التقرير السنوي فوراً، ويجد السجلَ من يحتاجه في ثوانٍ.`
- **الإشراف:** `ترى الإدارة الصورة كاملة في شاشة واحدة: من في إجازة اليوم، وما الذي ينتظر الاعتماد، وأي الجوازات والإقامات تقترب من الانتهاء. لا حاجة لطلب تقارير حالة — فالحالة معروضة دائماً.`
- **مسار واحد لكل النماذج:** `طلبات الإجازة، إخلاء الطرف، الإنذارات، نماذج الرواتب، تسليم الجوازات — جميعها تسلك الطريق نفسه: إنشاء، فاعتماد، فإبلاغ، فحفظ.` (نفس شبكة النماذج بالأسماء العربية من واجهة التطبيق — انسخ التسميات العربية الفعلية من `frontend/src/locales/ar.json`).
- **نظرة إلى الأمام — ملاحظات للمرحلة التالية:** intro `المسار أعلاه يعمل اليوم. وهذه ملاحظاتي حول ما يمكن أن يكون عليه غداً.` والأفكار الخمس:
  1. *واتساب إلى جانب الرسائل النصية* — `قناة واتساب مبنية في النظام بالفعل وتنتظر التفعيل؛ وبعد اعتمادها يمكن أن تصل الإشعارات إلى الموظفين عبر القناة التي يتابعونها أكثر.`
  2. *تذكيرات تلقائية* — `النظام يعرف متى تنتهي الإجازة ومتى ينتهي الجواز أو الإقامة. والخطوة التالية أن يذكّر من تلقاء نفسه — رسالة قبل موعد العودة، وتنبيه قبل انتهاء الوثيقة.`
  3. *الخدمة الذاتية للموظفين* — `اليوم تبدأ الطلبات من مكتب الموارد البشرية. والخطوة الطبيعية التالية أن يفتح الموظف طلبه بنفسه من هاتفه، ويتولى المسار نفسه الاعتماد والحفظ.`
  4. *قراءة أذكى للمستندات* — `الجوازات والهويات الممسوحة تُقرأ تلقائياً اليوم؛ وتوسيع ذلك إلى أنواع أخرى من المستندات سيُنهي ما تبقى من الإدخال اليدوي.`
  5. *ملخص شهري للإدارة* — `البيانات كلها في مكان واحد. ويمكن إصدار ملخص شهري من صفحة واحدة — الإجازات والاعتمادات والمخالفات — تلقائياً للإدارة.`
- **الخاتمة:** `مسار واحد لكل طلب — بالعربية والإنجليزية، من المكتب أو من الهاتف، مع تسجيل كل خطوة لحظة حدوثها. أُعدّ هذا المستند من النظام الفعلي كما يعمل اليوم.`

Captions: translate the EN captions in the same plain register (e.g. `شاشة الخدمات — من هنا يبدأ كل نموذج.`).

- [ ] **Step 2: Eyeball in a browser**

Same check as Task 6 Step 5, plus RTL specifics: index leaders flow right-to-left, progress rail sits on the left edge (logical `inset-inline-end`), timeline arrows read right-to-left, AR screenshots (not EN) on every page.

- [ ] **Step 3: Run the i18n-rtl-reviewer agent on the AR document**

Dispatch the `i18n-rtl-reviewer` agent on `docs/how-we-work/how-we-work-ar.html` (+ the EN file for parity). Fix genuine findings (wrong register, EN leakage, RTL breaks); this document is a bilingual surface.

---

### Task 8: Render the PDFs

**Files:**
- Create: `docs/how-we-work/render.mjs`, `docs/how-we-work/how-we-work-en.pdf`, `docs/how-we-work/how-we-work-ar.pdf`

**Interfaces:**
- Consumes: both HTML files.
- Produces: the two deliverable PDFs. Re-render any time with `node docs/how-we-work/render.mjs`.

- [ ] **Step 1: Write `docs/how-we-work/render.mjs`**

```js
// Render the two "How We Work" HTML documents to PDF.
// Usage: node docs/how-we-work/render.mjs
import { createRequire } from "module";
import { fileURLToPath } from "url";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");

const DOCS = [
  ["how-we-work-en.html", "how-we-work-en.pdf"],
  ["how-we-work-ar.html", "how-we-work-ar.pdf"],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out] of DOCS) {
  await page.goto("file://" + fileURLToPath(new URL(src, import.meta.url)));
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: fileURLToPath(new URL(out, import.meta.url)),
    format: "A4", printBackground: true, preferCSSPageSize: true,
  });
  console.log("rendered", out);
}
await browser.close();
```

- [ ] **Step 2: Render and verify page count**

```bash
node docs/how-we-work/render.mjs
venv/Scripts/python.exe -c "
from pypdf import PdfReader
for f in ('docs/how-we-work/how-we-work-en.pdf','docs/how-we-work/how-we-work-ar.pdf'):
    print(f, len(PdfReader(f).pages))
"
```

Expected: both render; both report 14 pages (or the count matching the final page structure — one PDF page per `.page` section, no stray blank page at the end; if a blank trailing page appears, drop `page-break-after` on the last section). If `pypdf` is missing, `pip` it into the venv is NOT allowed without asking — count pages by opening the PDF instead.

- [ ] **Step 3: Visual check of both PDFs**

Open each PDF (Read tool reads PDFs page by page). Verify against the spec's success criteria: crisp shots, correct fonts (AR pages actually in Naskh, not fallback tofu), colors printing as intended, index page numbers match reality (fix numbers and re-render if not), red used at most ~2 times per document.

---

### Task 9: Final review, deliverables, cleanup

**Files:**
- Deliver: both PDFs to the user; stage server stopped; scratch stage kept until user confirms.

- [ ] **Step 1: Verification before completion**

Use the superpowers:verification-before-completion skill. Evidence checklist: 22 shots passed the quality gate; both HTML files eyeball-clean; both PDFs render at the expected page count; AR reviewed by i18n-rtl-reviewer; every claim in the copy maps to the spec's grounding list.

- [ ] **Step 2: Send the PDFs to the user**

SendUserFile with both PDFs and a one-line caption. Ask for wording/visual feedback — expect at least one revision round (copy tweaks re-render in seconds via `render.mjs`).

- [ ] **Step 3: Stop the stage server + offer cleanup and commit**

Kill the background serve.py task. Tell the user: the stage copy lives in the scratchpad (auto-cleaned eventually); deliverables live in `docs/how-we-work/`. Offer — don't do unprompted — a git commit of `docs/how-we-work/` (repo convention keeps docs untracked, but these are durable deliverables; user decides).

---

## Self-Review Notes

- **Spec coverage:** cover/index/two-paths/7 steps/oversight/catalog/looking-ahead/closing → Tasks 6–7; staging → Tasks 1–2; screenshots + quality gate → Tasks 3–4; Approach A production → Tasks 5, 8; G3082 identity → Task 1 Step 3 + cover byline; SMS fallback (photograph existing history) → Task 2 Step 5; scan-inbox seeding fallback → Task 4 Step 2; accuracy rule → Global Constraints; deliverables + re-render script → Task 8.
- **Known runtime unknowns (deliberate):** exact UI selectors (Task 3 says verify against live DOM), exact generation payload (Task 2 Step 2 discovers the schema), AR catalog tile labels (copied from `ar.json` at build time), index page numbers (finalized after first render). Each has a discovery step in place — none is a placeholder.
- **Type consistency:** scene names in capture.mjs match the `shots/<lang>/<name>.png` references in Tasks 6–7; CSS class names in Task 5 match the markup in Tasks 6–7; `Stage#2026` password consistent across Tasks 1–4.
