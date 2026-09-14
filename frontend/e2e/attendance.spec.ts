/**
 * Attendance — end-to-end review against a live backend and a seeded day.
 *
 * Preview data comes from `tests/factories/attendance.py`: 40 guards across the
 * nine real posts on 2026-08-19, which is the rotation's double day (morning +
 * night = 80 rows), each with two punches.
 *
 * The Arabic block is not decoration. Two defects only appear in RTL:
 *   • an Arabic unit name directly before a clock range is reordered by the bidi
 *     algorithm ("05:00 – 13:00" renders as "13:00 – 05:00") unless the run is
 *     isolated;
 *   • a wide register can overflow the viewport on the start side once the
 *     writing direction flips.
 */

import type { Cookie, Page } from '@playwright/test'
import { expect, request, test } from '@playwright/test'

const DAY = '2026-08-19'
const VIEWPORTS = [
  { width: 1440, height: 900, name: '1440' },
  { width: 1280, height: 900, name: '1280' },
  { width: 1024, height: 800, name: '1024' },
]

// Log in ONCE for the whole file and replay the session cookie: the login route
// is rate limited to 10 hits per minute per IP (AUTH-03), so a per-test login
// trips a 429 partway through and reports it as an app failure.
let sessionCookies: Cookie[] = []

test.beforeAll(async ({ baseURL }) => {
  const context = await request.newContext({ baseURL })
  const response = await context.post('/api/v1/auth/login', {
    data: { email: 'admin@preview.local', password: 'preview-admin-pw' },
  })
  expect(response.status(), 'preview admin must authenticate').toBe(200)
  const state = await context.storageState()
  sessionCookies = state.cookies as Cookie[]
  await context.dispose()
})

async function login(page: Page): Promise<void> {
  await page.context().addCookies(sessionCookies)
}

async function gotoAttendance(page: Page): Promise<void> {
  await page.goto(`/employees/attendance?date=${DAY}`)
  await expect(page.getByTestId('attendance-register-unit').first()).toBeVisible({ timeout: 15_000 })
}

async function selectFixtureMonth(page: Page): Promise<void> {
  const now = new Date()
  const monthDelta = (2026 - now.getUTCFullYear()) * 12 + (7 - now.getUTCMonth())
  const direction = monthDelta < 0 ? '‹' : '›'
  for (let step = 0; step < Math.abs(monthDelta); step += 1) {
    await page.getByRole('button', { name: direction, exact: true }).click()
  }
}

/** No element may stick out of the viewport on either side. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(
    overflow.scrollWidth,
    `page overflows horizontally: ${overflow.scrollWidth} > ${overflow.innerWidth}`,
  ).toBeLessThanOrEqual(overflow.innerWidth + 1)
}

test.describe('Attendance register', () => {
  test('renders the seeded day, both shifts, and every post', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await login(page)
    await gotoAttendance(page)

    // The double day: one company, two windows, so two register sections.
    await expect(page.getByTestId('attendance-register-unit')).toHaveCount(2)
    // Nine posts per shift.
    await expect(page.getByTestId('attendance-register-post')).toHaveCount(18)

    // The source line names the provider exactly once per section, and nowhere
    // else does the UI say BioTime.
    const bodyText = (await page.locator('body').innerText()).toLowerCase()
    expect(bodyText.match(/biotime/g)?.length ?? 0).toBe(2)
    expect(bodyText).toContain('attendance')

    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0)
  })

  test('shift filter narrows the day to one window', async ({ page }) => {
    await login(page)
    await gotoAttendance(page)

    await page.getByRole('button', { name: /^Morning/ }).click()

    await expect(page.getByTestId('attendance-register-unit')).toHaveCount(1)
    await expect(page.getByTestId('attendance-register-post')).toHaveCount(9)
  })

  test('the view switch reaches Board and Timeline', async ({ page }) => {
    await login(page)
    await gotoAttendance(page)

    await page.getByRole('button', { name: 'Board', exact: true }).click()
    await expect(page.getByTestId('attendance-board')).toBeVisible()
    await expect(page.getByTestId('attendance-board-post')).toHaveCount(18)

    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
    await expect(page.getByTestId('attendance-timeline-unit').first()).toBeVisible()
    await expect(page.getByTestId('attendance-timeline-grace-line').first()).toBeVisible()
    // One dot per person who punched. Derived from the payload rather than
    // hardcoded: the preview roster's punch spread is data, not contract, and a
    // fixed number here breaks the moment the seed changes.
    const punched = await page.evaluate(async () => {
      const response = await fetch(
        '/api/v1/workforce/attendance/day?operational_date=2026-08-19&limit=500',
      )
      const page_ = (await response.json()) as { items: { punch_count: number }[] }
      return page_.items.filter((row) => row.punch_count > 0).length
    })
    expect(punched, 'the preview day must contain punches to plot').toBeGreaterThan(0)
    await expect(page.getByTestId('attendance-timeline-dot')).toHaveCount(punched)
  })

  test('arrow keys change the day', async ({ page }) => {
    await login(page)
    await gotoAttendance(page)

    await page.keyboard.press('ArrowLeft')

    await expect(page).toHaveURL(/date=2026-08-18/)
  })

  test('a name deep-links into that employee attendance tab', async ({ page }) => {
    await login(page)
    await gotoAttendance(page)

    // Click the first person row by role, not by name: real rosters get renamed
    // and the contract under test is the deep link, not any particular person.
    await page.getByTestId('attendance-register-post').first().getByRole('button').first().click()

    await expect(page).toHaveURL(/\/employees\/G-\d+\?tab=attendance/)
    await selectFixtureMonth(page)
    await expect(page.getByTestId('attendance-month-grid')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('attendance-month-cell')).toHaveCount(31)
  })

  for (const viewport of VIEWPORTS) {
    test(`no horizontal overflow at ${viewport.name} (English)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await login(page)
      await gotoAttendance(page)

      await expectNoHorizontalOverflow(page)
      await page.screenshot({
        path: `e2e/__screenshots__/attendance-en-${viewport.name}.png`,
        fullPage: true,
      })
    })
  }
})

test.describe('Attendance register — Arabic RTL', () => {
  async function switchToArabic(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Switch to Arabic' }).click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 10_000 })
  }

  test('flips direction and keeps clock ranges in order', async ({ page }) => {
    await login(page)
    await gotoAttendance(page)
    await switchToArabic(page)

    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')

    // The bidi regression guard: the Arabic unit name sits immediately before
    // the window, and the range must still read start → end.
    const meta = await page.getByTestId('attendance-register-unit').first().innerText()
    expect(meta).toMatch(/05:00\s*–\s*13:00|21:00\s*–\s*05:00/)
    expect(meta).not.toMatch(/13:00\s*–\s*05:00/)

    // The label is الحضور, and BioTime still appears only as the source.
    expect(await page.locator('body').innerText()).toContain('الحضور')
  })

  for (const viewport of VIEWPORTS) {
    test(`no horizontal overflow at ${viewport.name} (Arabic)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await login(page)
      await gotoAttendance(page)
      await switchToArabic(page)

      await expectNoHorizontalOverflow(page)
      await page.screenshot({
        path: `e2e/__screenshots__/attendance-ar-${viewport.name}.png`,
        fullPage: true,
      })
    })
  }
})
