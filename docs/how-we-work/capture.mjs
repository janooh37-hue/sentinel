// Screenshot capture for the "How We Work" PDFs.
// Usage: STAGE_NOTES='{"bookId":423,...}' node docs/how-we-work/capture.mjs --lang en --phase pending
//
// Playwright is resolved from frontend/node_modules (no local install needed).
// i18n localStorage key confirmed as "gssg.lang" (not i18nextLng).
import { createRequire } from "module";
import { mkdirSync } from "fs";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const BASE = "http://127.0.0.1:8899";
const lang  = process.argv[process.argv.indexOf("--lang")  + 1]; // en | ar
const phase = process.argv[process.argv.indexOf("--phase") + 1]; // pending | signed
// Optional: --scene <name> re-captures a single scene from the phase.
const sceneArgIdx = process.argv.indexOf("--scene");
const onlyScene = sceneArgIdx === -1 ? null : process.argv[sceneArgIdx + 1];
const N = JSON.parse(process.env.STAGE_NOTES);
// N = { bookId, ref, employeeId, smsEmployeeId, g3082Email, managerEmail }

const DESKTOP = { width: 1440, height: 900 };
const PHONE   = { width: 390,  height: 844 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// App uses SSE (server-sent events) — connection is never idle.
// Use "load" for navigation waits; "networkidle" would never settle.
async function login(page, email) {
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(800);

  // The login form renders in whatever language is in localStorage.
  // Accessible names differ by language; regex covers both.
  const emailBox = page.getByRole("textbox", { name: /Email|البريد/i });
  const count = await emailBox.count();
  if (count === 0) {
    // Already logged in (dashboard rendered), nothing to do.
    return;
  }
  await emailBox.fill(email);
  await page.getByRole("textbox", { name: /Password|كلمة المرور/i }).fill("Stage#2026");
  await page.getByRole("button", { name: /Sign in|تسجيل الدخول/i }).click();
  // Wait for the dashboard to render (URL stays at "/" but page content changes).
  await page.waitForTimeout(2000);
  await page.waitForSelector("nav", { timeout: 15000 });
}

async function settle(page) {
  // Short fixed waits are sufficient — SSE keeps network perpetually active.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600); // let images / logo finish painting
}

// ---------------------------------------------------------------------------
// Form-filled: open Leave Application Form, fill G3082 + Annual Leave + dates
// Does NOT save/submit — form state remains as a preview-ready draft.
// ---------------------------------------------------------------------------
async function prepareLeaveForm(p) {
  // Find and click the Leave Application Form tile.
  // EN: button text includes "Leave Application Form"
  // AR: button text includes "طلب إجازة" (but also "طلب إجازة إدارية" for Admin Leave)
  // The 📅 emoji is unique to the Leave Application Form tile in both languages.
  const tile = p.locator('button').filter({ hasText: /Leave Application Form|📅/ });
  await tile.first().click();
  await p.waitForTimeout(1000);

  // Fill employee (typeahead combobox).
  // EN placeholder: "Pick an employee…", AR placeholder: "اختر موظفًا…"
  const empBox = p.getByRole("combobox", { name: /Pick an employee|اختر موظفًا/i });
  await empBox.fill("G3082");
  await p.waitForTimeout(800); // debounce

  // Click the matched option.
  await p
    .getByRole("option", { name: /AHMED MOHAMMED|G3082/i })
    .first()
    .click();
  await p.waitForTimeout(500);

  // Select Leave Type → Annual Leave.
  // EN: "Leave Type*", AR: "نوع الإجازة"
  await p.getByRole("combobox", { name: /Leave Type|نوع الإجازة/i }).click();
  await p.waitForTimeout(300);
  // EN option: "Annual Leave", AR option: "إجازة سنوية"
  await p
    .getByRole("option", { name: /Annual Leave|إجازة سنوية/i })
    .first()
    .click();
  await p.waitForTimeout(300);

  // Set dates (ISO format accepted by the date textboxes).
  // EN labels: "Leave Start*" / "Leave End*", AR: "بداية الإجازة" / "نهاية الإجازة"
  await p.getByRole("textbox", { name: /Leave Start|بداية الإجازة/i }).fill("2026-07-14");
  await p.getByRole("textbox", { name: /Leave End|نهاية الإجازة/i }).fill("2026-07-18");
  await p.waitForTimeout(600); // let Total Days auto-compute

  // Blur the focused date input so no cursor / selection highlight lands in
  // the shot (the quality gate treats an active caret as an artifact).
  await p.evaluate(() => document.activeElement?.blur());
  await p.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Scene definitions
// ---------------------------------------------------------------------------
const SCENES = {
  pending: [
    // 1. Services catalogue — full tile grid
    {
      name: "services",
      url: "/application",
    },

    // 2. Leave form filled with G3082 / Annual Leave / 14-18 Jul — NOT saved
    {
      name: "form-filled",
      url: "/application",
      prepare: prepareLeaveForm,
    },

    // 3. The specific book (HR-0467 / book 423) in "Pending" state
    //    /books/423 renders the record detail directly.
    //    /books?open=423 strips the param on load — use the direct path instead.
    {
      name: "record-created",
      url: `/books/${N.bookId}`,
    },

    // 4. Manager's records list — should show the pending record in-queue
    {
      name: "approval-queue",
      url: "/books",
      as: "manager",
    },

    // 5. Manager on phone — record detail with sign/approve action visible
    {
      name: "approval-phone",
      url: `/books/${N.bookId}`,
      as: "manager",
      viewport: PHONE,
      prepare: async (p) => {
        // Hide the annotation-toolbar tooltip ("Click to pin · drag to highlight")
        // which is a transient UI hint, not real record content.
        await p.addStyleTag({
          content: '.backdrop-blur.rounded-full.absolute { display: none !important; }'
        });
        await p.waitForTimeout(200);
      },
    },
  ],

  signed: [
    // Task 4 fills in these scenes after signing/approval.
    {
      name: "record-signed",
      url: `/books/${N.bookId}`,
    },
    {
      name: "messages-tab",
      url: `/employees/${N.smsEmployeeId}`,
      prepare: async (p) => {
        await p.getByRole("tab", { name: /messages|الرسائل/i }).click();
      },
    },
    {
      name: "email-compose",
      url: "/ledger",
      prepare: async (p) => {
        // Open compose overlay. EN: "New email", AR: "رسالة جديدة".
        // The button sits in the sidebar with a prominent bg-info style.
        await p.getByRole("button", { name: /New email|رسالة جديدة/i }).click();
        await p.waitForTimeout(800);

        // Fill To and Subject so the compose looks purposeful.
        await p.getByRole("textbox", { name: /^To$|^إلى$/i }).fill(N.managerEmail);
        await p.locator('input[name="subject"]').fill(`Leave Application — ${N.ref}`);
        await p.waitForTimeout(300);

        // Click "Add reference" / "إضافة مرجع" to open the reference picker.
        await p.getByRole("button", { name: /Add reference|إضافة مرجع/i }).click();
        await p.waitForTimeout(600);

        // Search for the book ref in the picker.
        const searchPlaceholder = /Search books|ابحث في الكتب/i;
        await p.getByRole("textbox", { name: searchPlaceholder }).fill(N.ref);
        await p.waitForTimeout(900); // debounce + fetch

        // Click the result row that contains our ref number.
        // The result list shows ref as a mono badge; filter by its text.
        await p.locator("button").filter({ hasText: N.ref }).first().click();
        await p.waitForTimeout(600);
        // Picker closes; compose now shows a 📕 HR-0467 smart chip + PDF attachment.
        // Do NOT send. The context closes after screenshot — no email is dispatched.
      },
    },
    {
      name: "scan-inbox",
      url: "/scan-inbox",
      // scrollY applied after the window.scrollTo(0,0) reset so auto-filed cards
      // dominate the frame instead of the "couldn't match" failures at top.
      scrollY: 420,
    },
    {
      name: "employee-file",
      url: `/employees/${N.employeeId}`,
      prepare: async (p) => {
        // Click the Leaves tab to show balance meters + leave history.
        await p.getByRole("tab", { name: /leaves|الإجازات/i }).click();
        await p.waitForTimeout(800);
      },
    },
    {
      name: "dashboard",
      url: "/",
      viewport: { width: 1440, height: 1000 },
    },
  ],
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const outDir = new URL(`./shots/${lang}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

for (const scene of SCENES[phase]) {
  if (onlyScene && scene.name !== onlyScene) continue;
  const viewport = scene.viewport ?? DESKTOP;
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: lang === "ar" ? "ar-AE" : "en-US",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();

  // Force app language via localStorage before first navigation.
  await page.addInitScript(
    (l) => localStorage.setItem("gssg.lang", l),
    lang
  );

  // Login as the right identity.
  const email = scene.as === "manager" ? N.managerEmail : N.g3082Email;
  await login(page, email);

  // Navigate to the scene URL.
  // Use "load" not "networkidle" — SSE keeps the connection permanently active.
  await page.goto(BASE + scene.url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1200); // let React hydrate
  await settle(page);

  // Run any scene-specific setup (fill forms, click tabs, etc.).
  if (scene.prepare) {
    await scene.prepare(page);
    await settle(page);
  }

  // Scroll to top so header / logo are in frame, then apply any scene-level Y offset.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  if (scene.scrollY) {
    await page.evaluate((y) => window.scrollTo(0, y), scene.scrollY);
    await page.waitForTimeout(300);
  }

  // Capture — idempotent (overwrites previous run).
  const shotPath = new URL(`./${scene.name}.png`, outDir).pathname.slice(1);
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log(`ok ${lang}/${scene.name}  (${viewport.width}x${viewport.height})`);

  await ctx.close();
}

await browser.close();
