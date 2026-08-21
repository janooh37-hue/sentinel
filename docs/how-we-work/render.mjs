// Render the two "How We Work" HTML documents to PDF.
// Usage: node docs/how-we-work/render.mjs
import { createRequire } from "module";
import { fileURLToPath } from "url";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const DOCS = [
  ["how-we-work-en.html", "how-we-work-en.pdf"],
  ["how-we-work-ar.html", "how-we-work-ar.pdf"],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out] of DOCS) {
  await page.goto("file://" + fileURLToPath(new URL(src, import.meta.url)));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.pdf({
    path: fileURLToPath(new URL(out, import.meta.url)),
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  console.log("rendered", out);
}
await browser.close();
