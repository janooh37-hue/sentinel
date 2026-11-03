import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

// No agent steps: runs without a model.
test('a fresh install opens on the bilingual sign-in screen', async ({ app, browser, screen }) => {
  await app.open('/')
  await expect(screen.getByText('Sign in to GSSG Manager')).toBeVisible()

  await screen.getByRole('button', { name: 'العربية' }).click()
  await expect(screen.getByText('تسجيل الدخول إلى GSSG Manager')).toBeVisible()
  await expect(browser.locator('html')).toHaveAttribute('dir', 'rtl')
})
