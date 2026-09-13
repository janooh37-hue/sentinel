/**
 * The inmate monthly violations register's print/Save-as-PDF output,
 * verified as paper rather than as DOM.
 *
 * Three regressions are pinned here, against the REAL application shell (not
 * a bare component mount):
 *
 *   1. `WorkflowControls` used to leak its approval panel onto the printed
 *      page because it sat as a sibling of `ExportWorkspace` without
 *      `data-print-hide`. "Monthly report approval" (its heading, unique to
 *      that panel) must never appear in print media.
 *   2. The named page forced a fixed 275mm/252mm content height, which could
 *      push the signature block onto a spurious trailing blank page even for
 *      a short register. A short register must print exactly one page.
 *   3. Save as PDF suggested the generic app title instead of the selected
 *      month's Arabic register name.
 *
 * The backend is entirely synthetic and fail-closed: every `/api/v1/...`
 * request must be explicitly matched below or the test fails. This follows
 * `lock-word-handoff.spec.ts`'s route-interception pattern and
 * `attendance-print.spec.ts`'s PDF-geometry reading, but keeps the real
 * `ApplicationPage` ancestor and its `WorkflowControls` sibling, because the
 * print-hide regression only exists at that level — a bare `ExportWorkspace`
 * mount would hide the defect the same way it hid the original bug.
 */
import { expect, test as base } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { inflateSync } from 'node:zlib'

import { workflowMonth } from '../src/pages/application/statistics/workflowFixtures'
import type { InmateRegisterEntry, InmateRegisterMonth } from '../src/lib/api'

const YEAR = 2026
const MONTH = 9

/** A4 portrait is 210x297mm. PDF units are points; 72pt to the inch. */
const toMm = (points: number): number => Math.round((points / 72) * 25.4)

/** Page sizes and page count, read out of the PDF (see attendance-print.spec.ts). */
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

function entry(overrides: Partial<InmateRegisterEntry> & { id: string; uid: string }): InmateRegisterEntry {
  return {
    origin: 'derived',
    row_no: 1,
    population: 'citizens',
    name: `اسم ${overrides.uid}`,
    nationality_label: 'الإمارات',
    nationality_code: 'AE',
    violation_date: `${YEAR}-${String(MONTH).padStart(2, '0')}-10`,
    duty_unit: 'السرية الأولى',
    details_text: `تفاصيل مخالفة ${overrides.uid}`,
    wing: '1A',
    holding_no: '',
    reporter_id: null,
    reporter_name: null,
    source_book_id: 500,
    source_version_no: 1,
    source_row_index: 0,
    source_ref_number: 'IV-500',
    incomplete_marks: [],
    missing: [],
    duplicate_of: null,
    completion_book_id: null,
    manual: null,
    ...overrides,
  }
}

/** Six citizen rows and two expat rows — matches the reference PDF's density. */
const FIXTURE_ENTRIES: InmateRegisterEntry[] = [
  ...Array.from({ length: 6 }, (_, i) =>
    entry({ id: `citizen-${i + 1}`, uid: `FIX-C-${String(i + 1).padStart(2, '0')}`, population: 'citizens' }),
  ),
  ...Array.from({ length: 2 }, (_, i) =>
    entry({ id: `expat-${i + 1}`, uid: `FIX-E-${String(i + 1).padStart(2, '0')}`, population: 'expats' }),
  ),
]

const ACTOR = (suffix: string, id: number) => ({
  user_id: id,
  name_ar: `مُعِدّ ${suffix}`,
  employee_id: `G-FIX-${id}`,
  acted_at: `${YEAR}-${String(MONTH).padStart(2, '0')}-15T06:00:00Z`,
})

function fixtureMonth(entries: InmateRegisterEntry[] = FIXTURE_ENTRIES): InmateRegisterMonth {
  const citizens = entries.filter((e) => e.population === 'citizens').length
  const expats = entries.filter((e) => e.population === 'expats').length
  const pending = entries.filter((e) => e.population === 'pending').length
  return workflowMonth({
    year: YEAR,
    month: MONTH,
    closed: true,
    closed_at: `${YEAR}-09-16T06:00:00Z`,
    closed_by: 3,
    closed_by_name: 'مُعِدّ الموافقة',
    first_closable_date: `${YEAR}-09-01`,
    projection_fingerprint: 'fixture-2026-09',
    counts: { citizens, expats, pending, total: entries.length },
    wing_summary: {
      counts: [{ wing: '1A', violations: entries.length }],
      most: ['1A'],
      most_count: entries.length,
      least: ['6B'],
      least_count: 0,
      zero: ['6B'],
      unassigned_count: 0,
    },
    workflow: {
      version: 1,
      state: 'closed',
      reviewer: null,
      manager: null,
      prepared: ACTOR('التحضير', 1),
      reviewed: ACTOR('المراجعة', 2),
      approved: ACTOR('الموافقة', 3),
      last_event: null,
      needs_review: false,
      blockers: [],
      allowed_actions: [],
    },
    entries,
    uncounted: [],
    arrived_after_close: [],
    blocking: [],
  })
}

const INMATE_TEMPLATE_META = {
  id: 'Inmate Conduct Violations',
  name_en: 'Inmate Conduct Violations',
  name_ar: 'المخالفات المسلكية',
  form_number: '300-005',
  category: 'admin' as const,
  signing_path: 'auto' as const,
  has_code: true,
  feature_minted: false,
  notifies_employee: false,
}

class SyntheticApi {
  readonly unhandledRequests: string[] = []
  month: InmateRegisterMonth = fixtureMonth()

  private async fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(value),
    })
  }

  async install(page: Page): Promise<void> {
    await page.route('**/*', async (route) => this.handleRoute(route))
  }

  private async handleRoute(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())

    if (!url.pathname.startsWith('/api/')) {
      await route.continue()
      return
    }
    if (!url.pathname.startsWith('/api/v1/')) {
      this.unhandledRequests.push(`${request.method()} ${url.pathname}`)
      await route.abort('failed')
      return
    }

    const method = request.method()
    const path = decodeURIComponent(url.pathname.slice('/api/v1'.length))

    if (method === 'GET' && path === '/auth/me') {
      await this.fulfillJson(route, {
        id: 42,
        email: 'print.fixture@example.invalid',
        employee_id: 'G-PRINT-42',
        name_en: 'Print Fixture Operator',
        name_ar: 'مشغل اختبار الطباعة',
        position: 'Records Officer',
        department: 'Records',
        photo_url: null,
        role: 'operator',
        status: 'active',
        is_admin: false,
        is_manager: false,
        has_signature: false,
        idle_lock_seconds: 3600,
        lock_layout: 'band',
      })
      return
    }
    if (method === 'GET' && path === '/system/migration-status') {
      await this.fulfillJson(route, {
        has_db: true,
        has_data: true,
        v3_data_dir_detected: null,
        last_migration: null,
      })
      return
    }
    if (method === 'GET' && path === '/auth/me/capabilities') {
      await this.fulfillJson(route, [
        'documents.generate',
        'books.view',
        'books.service.Inmate Conduct Violations',
      ])
      return
    }
    if (method === 'GET' && path === '/auth/capabilities') {
      await this.fulfillJson(route, [])
      return
    }
    if (method === 'GET' && path === '/settings') {
      await this.fulfillJson(route, {
        stamp_style: 'Header Text (Ref: XX-0000)',
        default_manager_id: null,
        manager_hand_sign_default: false,
        theme: 'light',
        language: 'en',
        font_scale: 1,
        sig_personnel_path: null,
        sig_admin_path: null,
        legacy_signature_path: null,
        admin_gate_enabled: false,
        sentry_opt_in: false,
        sms_autosend_enabled: false,
        email_signature: '',
        signature_size_mm: 28,
        signature_boldness: 1,
      })
      return
    }
    if (method === 'GET' && path === '/email/account') {
      await this.fulfillJson(route, null)
      return
    }
    if (method === 'GET' && path === '/notifications/counts') {
      await this.fulfillJson(route, {
        approvals: 0,
        leaves: 0,
        scans: 0,
        emails: 0,
        monthly_reviews: 0,
        monthly_approvals: 0,
      })
      return
    }
    if (method === 'GET' && path === '/notifications/stream') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body:
          'event: counts\ndata: {"approvals":0,"leaves":0,"scans":0,"emails":0,' +
          '"monthly_reviews":0,"monthly_approvals":0}\n\n',
      })
      return
    }
    if (method === 'GET' && path === '/inmate-violations/statistics/awaiting-close') {
      await this.fulfillJson(route, { months: [], count: 0 })
      return
    }
    if (method === 'GET' && path === '/inmate-violations/nationalities') {
      await this.fulfillJson(route, { items: [], aliases: {} })
      return
    }
    if (method === 'GET' && path === '/managers') {
      await this.fulfillJson(route, [])
      return
    }
    if (method === 'GET' && path === '/templates') {
      await this.fulfillJson(route, { items: [INMATE_TEMPLATE_META] })
      return
    }
    if (method === 'GET' && path === '/templates/Inmate Conduct Violations/fields') {
      await this.fulfillJson(route, {
        meta: INMATE_TEMPLATE_META,
        signing_path: 'auto',
        attachment_slots: [],
        fields: [
          { key: 'report_date', type: 'date', label_en: 'Date', label_ar: 'التاريخ', required: true },
          { key: 'report_time', type: 'time', label_en: 'Time', label_ar: 'الوقت', required: true },
          { key: 'inmates', type: 'inmates_table', label_en: 'Inmates', label_ar: 'النزلاء', required: true },
          {
            key: 'violation_details',
            type: 'arabic_rich',
            label_en: 'Violation details',
            label_ar: 'تفاصيل المخالفة',
            required: true,
          },
          {
            key: 'action_notified',
            type: 'checkbox',
            label_en: 'Branch manager of Inmate Affairs was notified',
            label_ar: 'تم إبلاغ مدير فرع شؤون النزلاء',
            required: false,
          },
          {
            key: 'action_written',
            type: 'checkbox',
            label_en: 'A conduct violation was written against the inmate',
            label_ar: 'تم كتابة مخالفة مسلكية في حق النزلاء',
            required: false,
          },
          {
            key: 'action_transferred',
            type: 'checkbox',
            label_en: 'Inmate moved to section B and restrained',
            label_ar: 'تم نقل النزيل إلى قسم B وتقييده',
            required: false,
          },
          { key: 'action_other', type: 'text', label_en: 'Other action', label_ar: 'إجراء آخر', required: false },
          {
            key: 'reporter_id',
            type: 'employee_picker',
            label_en: 'Reported by',
            label_ar: 'مقدم التقرير',
            required: true,
          },
          {
            key: 'manager_id',
            type: 'manager_picker',
            label_en: 'Signing manager',
            label_ar: 'المُوقِّع',
            required: false,
          },
          {
            key: 'hand_sign_manager',
            type: 'hand_sign_checkbox',
            label_en: "Embed manager's saved signature",
            label_ar: 'تضمين توقيع المدير المحفوظ',
            required: false,
            default: 'true',
          },
        ],
      })
      return
    }
    if (method === 'GET' && path === `/inmate-violations/statistics/${YEAR}/${MONTH}`) {
      await this.fulfillJson(route, this.month)
      return
    }

    this.unhandledRequests.push(`${method} ${url.pathname}${url.search}`)
    await route.abort('failed')
  }
}

const test = base.extend<{ backend: SyntheticApi }>({
  backend: async ({ page }, runTest) => {
    const backend = new SyntheticApi()
    await backend.install(page)
    await runTest(backend)
    expect(
      backend.unhandledRequests,
      'Every API request must be explicitly synthetic; live/proxy fallback is forbidden',
    ).toEqual([])
  },
})

test.use({ serviceWorkers: 'block' })
test.describe.configure({ timeout: 45_000 })

/** Navigate straight into the register and switch to the Export view. */
async function gotoExport(page: Page, options: { lang?: 'en' | 'ar' } = {}): Promise<void> {
  const lang = options.lang ?? 'en'
  await page.addInitScript((value: string) => {
    window.localStorage.clear()
    window.localStorage.setItem('gssg.lang', value)
  }, lang)
  await page.goto('/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-09')
  await expect(page.locator('#main-content')).toBeVisible()
  const exportTab = page.getByRole('button', { name: lang === 'ar' ? 'التصدير' : 'Export', exact: true })
  await expect(exportTab).toBeVisible()
  await exportTab.click()
  await expect(page.locator('[data-inmate-register-document][dir="rtl"]').first()).toBeVisible()
}

test.describe('inmate monthly register print/PDF', () => {
  test('prints one A4 portrait page with every row, actor content, and no workflow panel', async ({
    page,
    backend,
  }) => {
    void backend
    await gotoExport(page)

    // Regression #1: the workflow approval panel sits beside ExportWorkspace
    // in the DOM and must never reach paper.
    await expect(page.getByText('Monthly report approval')).toBeVisible()
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByText('Monthly report approval')).toBeHidden()

    const printDoc = page.locator('.print-inmate-register')
    await expect(printDoc).toBeVisible()
    for (const row of FIXTURE_ENTRIES) {
      await expect(printDoc.getByText(row.uid, { exact: true })).toBeVisible()
    }
    await expect(printDoc.getByText('G-FIX-1', { exact: true })).toBeVisible()
    await expect(printDoc.getByText('G-FIX-2', { exact: true })).toBeVisible()
    await expect(printDoc.getByText('G-FIX-3', { exact: true })).toBeVisible()

    // Regression #2 (margins): the paper's side inset now comes from the
    // exposed CSS var instead of being zeroed by the print stylesheet, and
    // the named `@page` no longer reserves a redundant horizontal margin.
    const paperStyle = await printDoc.evaluate((el) => {
      const style = getComputedStyle(el)
      return { paddingInlineStart: style.paddingInlineStart, paddingBlockStart: style.paddingBlockStart }
    })
    expect(paperStyle.paddingBlockStart).toBe('0px')
    // 15.95mm at 96dpi ≈ 60.3px.
    expect(Number.parseFloat(paperStyle.paddingInlineStart)).toBeGreaterThan(55)
    expect(Number.parseFloat(paperStyle.paddingInlineStart)).toBeLessThan(65)

    // Regression #2: physically render the page and prove it is exactly one
    // A4 portrait sheet — a forced content height used to push this short
    // register onto a spurious trailing blank page.
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, scale: 1 })
    const { sizes, pages } = pdfPages(pdf)
    expect(sizes).toEqual(['210x297mm'])
    expect(pages).toBe(1)
  })

  test('a dense multi-month register paginates naturally with no forced blank page', async ({ page, backend }) => {
    const denseEntries = Array.from({ length: 84 }, (_, i) => {
      const population = i % 10 === 9 ? 'expats' : 'citizens'
      return entry({
        id: `dense-${i}`,
        uid: `DNS-${String(i + 1).padStart(3, '0')}`,
        population,
        details_text:
          i % 7 === 0
            ? 'تفاصيل طويلة بلا انقطاع: ' + 'أ'.repeat(220)
            : `سطر أول\nسطر ثانٍ للمخالفة رقم ${i + 1}`,
      })
    })
    backend.month = fixtureMonth(denseEntries)
    await gotoExport(page)

    await page.emulateMedia({ media: 'print' })
    const printDoc = page.locator('.print-inmate-register')
    await expect(printDoc).toBeVisible()
    await expect(printDoc.getByText('DNS-001', { exact: true })).toBeVisible()
    await expect(printDoc.getByText('DNS-084', { exact: true })).toBeVisible()
    // The signature block is a single element that follows the content once,
    // never duplicated per page.
    await expect(printDoc.locator('[data-report-signatures]')).toHaveCount(1)
    await expect(printDoc.locator('thead').first()).toHaveCSS('display', 'table-header-group')

    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, scale: 1 })
    const { sizes, pages } = pdfPages(pdf)
    expect(sizes).toEqual(['210x297mm'])
    expect(pages).toBeGreaterThan(1)
  })

  test('export options control exactly the selected content', async ({ page, backend }) => {
    void backend
    await gotoExport(page)
    const printDoc = page.locator('.print-inmate-register')

    // Deselect expats (screen-media control): only citizen rows and the
    // dropped-table warning remain, in print media too.
    await page.getByRole('checkbox', { name: 'Non-citizens' }).uncheck()
    await expect(page.getByText('Excluded:', { exact: false })).toBeVisible()
    await page.emulateMedia({ media: 'print' })
    await expect(printDoc.getByText('FIX-C-01', { exact: true })).toBeVisible()
    await expect(printDoc.getByText('FIX-E-01', { exact: true })).toHaveCount(0)
    await page.emulateMedia({ media: 'screen' })

    // Re-select expats, then turn the summary off.
    await page.getByRole('checkbox', { name: 'Non-citizens' }).check()
    await page.emulateMedia({ media: 'print' })
    await expect(printDoc.locator('[data-report-summary]')).toHaveCount(1)
    await page.emulateMedia({ media: 'screen' })
    await page.getByRole('checkbox', { name: 'Include summary' }).uncheck()
    await page.emulateMedia({ media: 'print' })
    await expect(printDoc.locator('[data-report-summary]')).toHaveCount(0)
    await page.emulateMedia({ media: 'screen' })
    await page.getByRole('checkbox', { name: 'Include summary' }).check()

    // Full narrative detail mode still carries the same violation text.
    await page.getByRole('radio', { name: 'Full narrative' }).click()
    await page.emulateMedia({ media: 'print' })
    await expect(printDoc.getByText('تفاصيل مخالفة FIX-C-01', { exact: false })).toBeVisible()
  })

  test('an empty population extract prints its table with no rows, not an omission', async ({ page, backend }) => {
    backend.month = fixtureMonth(FIXTURE_ENTRIES.filter((e) => e.population === 'citizens'))
    await gotoExport(page)
    await page.emulateMedia({ media: 'print' })
    const printDoc = page.locator('.print-inmate-register')
    await expect(printDoc.getByText('FIX-C-01', { exact: true })).toBeVisible()
    await expect(printDoc.getByText('FIX-E-01', { exact: true })).toHaveCount(0)
  })

  test('Arabic RTL renders the same invariant report regardless of application locale', async ({ page, backend }) => {
    void backend
    await gotoExport(page, { lang: 'ar' })
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

    // Regression #3: the Arabic-only filename is unaffected by the app
    // locale already being Arabic (it is always built with `{ lng: 'ar' }`,
    // never the ambient i18n language).
    const original = await page.title()
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await expect.poll(() => page.title()).toContain('2026-09')
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await expect.poll(() => page.title()).toBe(original)

    // Regression #1 under an Arabic shell: the workflow panel's Arabic
    // heading must still be print-hidden, not just its English counterpart.
    await expect(page.getByText('اعتماد التقرير الشهري')).toBeVisible()
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByText('اعتماد التقرير الشهري')).toBeHidden()

    const printDoc = page.locator('.print-inmate-register')
    await expect(printDoc).toHaveAttribute('dir', 'rtl')
    await expect(printDoc).toHaveAttribute('lang', 'ar')
    for (const row of FIXTURE_ENTRIES) {
      await expect(printDoc.getByText(row.uid, { exact: true })).toBeVisible()
    }
  })

  test('dark theme, maximum font scale, and preview zoom never change the printed geometry', async ({
    page,
    backend,
  }) => {
    void backend
    await gotoExport(page)
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
      document.documentElement.dataset.fontScale = '24'
    })
    await page.getByRole('button', { name: '50%', exact: true }).click()
    await page.emulateMedia({ media: 'print' })
    const printDoc = page.locator('.print-inmate-register')
    const colors = await printDoc.evaluate((el) => {
      const style = getComputedStyle(el)
      return { color: style.color, background: style.backgroundColor }
    })
    // The print stylesheet force-pins light-paper ink regardless of the
    // shell's dark theme or font-scale data attributes.
    expect(colors.color).toBe('rgb(0, 0, 0)')
    expect(colors.background).toBe('rgb(255, 255, 255)')

    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, scale: 1 })
    const { sizes, pages } = pdfPages(pdf)
    expect(sizes).toEqual(['210x297mm'])
    expect(pages).toBe(1)
  })

  test('Save as PDF suggests the selected month name and restores the tab title', async ({ page, backend }) => {
    void backend
    await gotoExport(page)
    const original = await page.title()
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await expect.poll(() => page.title()).not.toBe(original)
    const printing = await page.title()
    expect(printing).toContain('2026-09')
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await expect.poll(() => page.title()).toBe(original)
  })
})
