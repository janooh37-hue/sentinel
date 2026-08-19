/**
 * Attendance — presentation captures.
 *
 * Not assertions: this spec exists to produce the review screenshots for every
 * surface, in both languages, against the seeded preview day. Kept separate from
 * `attendance.spec.ts` so the assertion suite stays fast and focused.
 */

import type { Cookie, Page } from '@playwright/test'
import { expect, request, test } from '@playwright/test'

const DAY = '2026-08-19'
const SHOTS = 'e2e/__screenshots__'

let sessionCookies: Cookie[] = []

test.beforeAll(async ({ baseURL }) => {
  const context = await request.newContext({ baseURL })
  const response = await context.post('/api/v1/auth/login', {
    data: { email: 'admin@preview.local', password: 'preview-admin-pw' },
  })
  expect(response.status()).toBe(200)
  sessionCookies = (await context.storageState()).cookies as Cookie[]
  await context.dispose()
})

async function open(page: Page, path: string): Promise<void> {
  await page.context().addCookies(sessionCookies)
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto(path)
}

/** The page scrolls an inner container, so `fullPage` cannot see past the fold. */
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

test('captures every attendance surface', async ({ page }) => {
  await open(page, `/employees/attendance?date=${DAY}&shift=morning`)
  await expect(page.getByTestId('attendance-register-unit').first()).toBeVisible({ timeout: 20_000 })
  await shot(page, 'review-register-en')

  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(page.getByTestId('attendance-board')).toBeVisible()
  await shot(page, 'review-board-en')

  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await expect(page.getByTestId('attendance-timeline-unit').first()).toBeVisible()
  await shot(page, 'review-timeline-en')

  // The employees landing page: section tabs plus the live hero card.
  await page.goto('/employees')
  await expect(page.getByTestId('attendance-hero-card')).toBeVisible({ timeout: 20_000 })
  // Capture the settled card, not the honest-but-uninformative pending state.
  await expect(page.getByTestId('attendance-hero-pending')).toHaveCount(0, { timeout: 20_000 })
  await shot(page, 'review-directory-hero-en')

  // One employee's attendance tab, opened from the register's deep link.
  await page.goto('/employees/G-9038?tab=attendance')
  await expect(page.getByTestId('attendance-month-grid')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('attendance-month-cell').nth(18).click()
  await expect(page.getByTestId('attendance-day-timeline').first()).toBeVisible()
  await shot(page, 'review-employee-tab-en')

  // Arabic, same surfaces.
  await page.goto(`/employees/attendance?date=${DAY}&shift=morning`)
  await expect(page.getByTestId('attendance-register-unit').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Switch to Arabic' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await shot(page, 'review-register-ar')

  await page.getByRole('button', { name: /الخط الزمني/ }).click()
  await expect(page.getByTestId('attendance-timeline-unit').first()).toBeVisible()
  await shot(page, 'review-timeline-ar')

  await page.goto('/employees/G-9038?tab=attendance')
  await expect(page.getByTestId('attendance-month-grid')).toBeVisible({ timeout: 20_000 })
  await shot(page, 'review-employee-tab-ar')
})
