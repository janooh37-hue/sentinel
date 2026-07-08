import { test, expect } from '@playwright/test'

/**
 * Soft-refresh e2e tests for the keyboard shortcuts added in the
 * refresh-experience milestone (Alt+R / F5 intercept).
 *
 * The marker technique: set `window.__ptr = true` before the keypress, then
 * check it survived. A hard reload wipes the JS heap so __ptr becomes
 * undefined; a soft refresh (invalidate + refetch) leaves it intact.
 *
 * The tests navigate to /books because that page is wired for refresh.
 * The Vite dev server must be running on localhost:5173 (playwright.config.ts
 * launches it via `webServer` if not already up).
 */

test('Alt+R soft-refreshes without a full page reload', async ({ page }) => {
  await page.goto('/books')
  await page.evaluate(() => ((window as unknown as { __ptr: boolean }).__ptr = true))
  await page.keyboard.press('Alt+r')
  // marker survives a soft refresh but would be wiped by a hard reload
  const survived = await page.evaluate(() => (window as unknown as { __ptr?: boolean }).__ptr)
  expect(survived).toBe(true)
})

test('F5 is intercepted (no navigation)', async ({ page }) => {
  await page.goto('/books')
  await page.evaluate(() => ((window as unknown as { __ptr: boolean }).__ptr = true))
  await page.keyboard.press('F5')
  const survived = await page.evaluate(() => (window as unknown as { __ptr?: boolean }).__ptr)
  expect(survived).toBe(true)
})
