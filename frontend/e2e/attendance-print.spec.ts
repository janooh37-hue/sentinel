/**
 * The attendance printout, verified as paper rather than as DOM.
 *
 * Component tests assert markup, and markup cannot tell you the sheet came out
 * A4 landscape, that a dark-theme operator got black ink, that the largest font
 * scale did not inflate the geometry, or that Arabic bold rendered from a real
 * face instead of a synthesized smear. Those are properties of the printed
 * artifact, so they are checked by printing one and reading the PDF back.
 *
 * The sheet is mounted into the live app document — the real Tailwind build, the
 * real `@media print` block, the bundled fonts, the crest served from `/brand`.
 * No login or seeded database is needed, because the component is handed rows
 * directly.
 *
 * `page.setContent` is deliberately NOT used: it replaces the document without
 * Vite's dev CSS injection, so the sheet renders entirely unstyled and every
 * assertion here would pass vacuously.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { inflateSync } from 'node:zlib'

const LAYOUTS = ['sheet', 'roster', 'shift'] as const
const LANGS = ['en', 'ar'] as const

/** Sheets each layout is expected to fill for the fixture day. */
const EXPECTED_SHEETS: Record<(typeof LAYOUTS)[number], number> = {
  // The whole day — both companies on duty, 75 names — on one landscape sheet.
  sheet: 1,
  roster: 3,
  // 20 Aug 2026 is a noon company and a night company: one sheet each, and no
  // trailing blank one from the break-after on the last.
  shift: 2,
}

/** A4 landscape is 297x210mm. PDF units are points; 72pt to the inch. */
const toMm = (points: number): number => Math.round((points / 72) * 25.4)

/**
 * Page sizes and page count, read out of the PDF.
 *
 * Chrome compresses its object streams and `/MediaBox` lives inside them, so
 * every deflate stream is inflated before the search — grepping the raw bytes
 * finds nothing and would make the size assertion vacuously pass.
 */
function pdfPages(pdf: Uint8Array): { sizes: string[]; pages: number } {
  const raw = Buffer.from(pdf).toString('latin1')
  let text = raw
  const stream = /stream\r?\n/g
  let match: RegExpExecArray | null
  while ((match = stream.exec(raw)) !== null) {
    const from = match.index + match[0].length
    const to = raw.indexOf('endstream', from)
    if (to === -1) continue
    try {
      text += inflateSync(Buffer.from(raw.slice(from, to), 'latin1')).toString('latin1')
    } catch {
      // Fonts and images are not deflate streams; nothing to read from them.
    }
  }
  const sizes = [...text.matchAll(/MediaBox\s*\[\s*[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)/g)].map(
    (box) => `${toMm(Number(box[1]))}x${toMm(Number(box[2]))}mm`,
  )
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((count) => Number(count[1]))
  return {
    sizes: [...new Set(sizes)],
    pages: counts.length > 0 ? Math.max(...counts) : sizes.length,
  }
}

/**
 * Mount one layout into the running app and switch the page to print media.
 *
 * `theme: 'dark'` and the largest font scale are the defaults on purpose: they
 * are the two settings that used to leak onto paper, so every case exercises
 * them rather than one dedicated test nobody reads.
 */
async function mount(
  page: Page,
  lang: string,
  layout: string,
  theme: 'light' | 'dark' = 'dark',
): Promise<void> {
  await page.emulateMedia({ media: 'screen' })
  await page.goto('/')
  await page.waitForFunction("!!document.getElementById('root')")

  await page.evaluate(
    async ({ lang, layout, theme }) => {
      // Dynamic by necessity: this body is serialised and evaluated inside the
      // browser, where the specifiers are resolved by the dev server's module
      // graph. A static import here would be resolved by Node against the test
      // file, which has no `/src/...` and no Vite transform.
      //
      // Vite serves the React deps pre-bundled and CJS-interopped, so
      // `createRoot` is a property of the default export, not a named one —
      // destructuring it yields undefined and the mount fails silently.
      const React = (await import('/@id/react')).default
      const ReactDOM = (await import('/@id/react-dom/client')).default
      const i18n = (await import('/src/lib/i18n.ts')).default
      const { AuthContext } = await import('/src/lib/authContext.ts')
      const { AttendancePrintSheet } = await import(
        '/src/pages/employees/attendance/AttendancePrintSheet.tsx'
      )
      const { ROWS } = await import('/src/pages/employees/attendance/printProofRows.ts')

      await i18n.changeLanguage(lang)
      document.documentElement.dataset.theme = theme
      document.documentElement.dataset.fontScale = '3'
      // The page under test hides its own screen tree exactly like this, so the
      // named landscape page has no in-flow sibling to spend a blank sheet on.
      document.getElementById('root')?.setAttribute('data-print-hide', '')

      const host = document.createElement('div')
      document.body.append(host)
      const user = { name_en: 'A. Alhamadi', name_ar: 'أ. الحمادي', email: 'ops@gssg.local' }
      ReactDOM.createRoot(host).render(
        React.createElement(
          AuthContext.Provider,
          { value: { user, status: 'authed' } },
          React.createElement(AttendancePrintSheet, {
            layout,
            rows: ROWS,
            now: new Date('2026-08-20T18:00:00Z'),
            operationalDate: '2026-08-20',
            shiftCode: null,
            search: '',
          }),
        ),
      )
    },
    { lang, layout, theme },
  )

  // Hidden on screen is the contract that keeps this off the display.
  await expect(page.locator('.print-attendance')).toBeHidden()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.print-attendance')).toBeVisible()
}

test.describe('attendance printout', () => {
  for (const lang of LANGS) {
    for (const layout of LAYOUTS) {
      test(`${layout} prints ${EXPECTED_SHEETS[layout]} A4 landscape sheet(s) in ${lang}`, async ({
        page,
      }) => {
        await mount(page, lang, layout)

        const printed = await page.evaluate(() => {
          const root = document.querySelector('.print-attendance') as HTMLElement
          const unit = root.querySelector('[data-testid="attendance-print-unit"]') as HTMLElement
          const crests = [...root.querySelectorAll('img')]
          return {
            ink: getComputedStyle(root).color,
            rootFontSize: getComputedStyle(document.documentElement).fontSize,
            unitWeight: getComputedStyle(unit).fontWeight,
            unitFamily: getComputedStyle(unit).fontFamily,
            crests: crests.length,
            brokenCrests: crests.filter((img) => img.naturalWidth === 0).length,
          }
        })

        // Black ink under the dark theme: the sheet re-pins the light token
        // values, so nobody prints near-white text onto white paper.
        expect(printed.ink).toBe('rgb(0, 0, 0)')
        // Pinned despite data-font-scale="3": paper geometry must not depend on
        // a reading-comfort setting.
        expect(printed.rootFontSize).toBe('16px')
        // 700, not 800: only 400/500/700 of Noto Sans Arabic are bundled, so an
        // 800 request has no real Arabic face and the browser fakes one.
        expect(printed.unitWeight).toBe('700')
        // Inter carries no Arabic, and --font-arabic only applies under
        // [dir=rtl]/:lang(ar), which dir="auto" matches neither of.
        expect(printed.unitFamily).toContain('Noto Sans Arabic')
        expect(printed.brokenCrests).toBe(0)
        expect(printed.crests).toBeGreaterThan(0)

        // The original defect: names on paper, shift window nowhere.
        const windows = page.getByTestId('attendance-print-window')
        expect(await windows.count()).toBeGreaterThan(0)

        const { sizes, pages } = pdfPages(
          await page.pdf({ preferCSSPageSize: true, printBackground: true }),
        )
        expect(sizes).toEqual(['297x210mm'])
        expect(pages).toBe(EXPECTED_SHEETS[layout])
      })
    }
  }

  test('the roster repeats its crest and stamp on every sheet', async ({ page }) => {
    await mount(page, 'en', 'roster')

    // Repeating groups only matter once the table breaks, so assert it does.
    const { pages } = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }))
    expect(pages).toBeGreaterThan(1)

    // A table header/footer group is the one thing a browser repeats across the
    // fragments of a broken table, which is why the masthead lives in `thead`
    // and the provenance in `tfoot` rather than above and below the table.
    await expect(page.locator('.print-attendance thead img')).toHaveCount(1)
    await expect(
      page.locator('.print-attendance tfoot [data-testid="attendance-print-stamp"]'),
    ).toHaveCount(1)

    // Total time replaced the scheduled window column; the window moved to the
    // shift band, which is why it is still on the sheet.
    await expect(page.getByRole('columnheader', { name: 'Total' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Window' })).toHaveCount(0)
    await expect(page.getByTestId('attendance-print-window').first()).toBeVisible()
  })

  test('the per-shift layout gives each shift its own signable sheet', async ({ page }) => {
    await mount(page, 'en', 'shift')

    await expect(page.locator('.print-attendance img')).toHaveCount(2)
    await expect(page.getByText('Sheet 1 / 2')).toBeVisible()
    await expect(page.getByText('Sheet 2 / 2')).toBeVisible()
    // The sign-off strip is the reason this layout costs its own page.
    await expect(page.getByText('Shift supervisor')).toHaveCount(2)
  })

  test('a clock range beside Arabic keeps its order', async ({ page }) => {
    await mount(page, 'ar', 'sheet')

    // Unisolated, the bidi algorithm prints "الظهيرة 13:00 – 21:00" as
    // "21:00 – 13:00" — the defect `.isolate-bidi` exists to prevent.
    const windows = page.getByTestId('attendance-print-window')
    await expect(windows.first()).toHaveText('13:00 – 21:00')
    await expect(windows.nth(1)).toHaveText('21:00 – 05:00')
  })
})
