import { expect, test } from '@playwright/test'

// Uses the isolated dev fixture accounts, never production credentials or data.
for (const locale of ['en', 'ar'] as const) {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    test(`accounts preserve identity and Back state ${locale} ${viewport.width}`, async ({ page, context, request }) => {
      await page.setViewportSize(viewport)
      const login = await request.post('/api/v1/auth/login', { data: { email: 'admin@preview.local', password: 'preview-admin-pw' } })
      expect(login.ok()).toBeTruthy()
      await context.addCookies((await request.storageState()).cookies)
      await page.addInitScript((language) => {
        localStorage.setItem('gssg.lang', language)
        localStorage.setItem('gssg.migration.skipped', 'true')
      }, locale)
      const usersResponse = await request.get('/api/v1/auth/users')
      expect(usersResponse.ok()).toBeTruthy()
      const users = await usersResponse.json() as Array<{ id: number; email: string; role: string; status: string }>
      const target = users.find((user) => user.email === 'operator@preview.local')
      expect(target, 'isolated operator fixture is required').toBeTruthy()
      if (!target) throw new Error('Missing isolated operator account')
      await page.goto('/permissions?tab=people&dept=7')
      const search = page.getByRole('searchbox')
      await expect(search).toBeVisible()
      await expect(page).not.toHaveURL(/[?&]user=/)
      await search.fill(target.email)
      const row = page.getByRole('row').filter({ hasText: target.email })
      await expect(row).toHaveCount(1)
      await row.getByRole('button').focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(new RegExp(`[?&]user=${target.id}(?:&|$)`))
      await expect(page).toHaveURL(/dept=7/)
      await expect(page.getByText(target.email, { exact: true })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const back = page.getByRole('button', { name: locale === 'en' ? 'Back to accounts' : 'العودة إلى الحسابات' })
      await back.click()
      await expect(search).toHaveValue(target.email)
      await expect(row.getByRole('button')).toBeFocused()
      await expect(page).not.toHaveURL(/[?&]user=/)
    })
  }
}
