import { test } from '@e2e-dev/web'
import { credentials, expect } from 'e2e'

// The stack starts with an empty database, so the first account to request
// access is promoted to admin and lands in the app without approval, where the
// v3 migration wizard greets it.
test('the first account to request access becomes the admin', async ({ app, agent, screen }) => {
  const admin = credentials.user('admin')
  await app.open('/')

  await agent.act('request access with email {email} and password {password}', {
    params: { email: admin.username, password: admin.password },
  })
  await expect(screen.getByRole('dialog', { name: 'Migrate from GSSG v3.5.4' })).toBeVisible()
  await screen.getByRole('button', { name: 'Skip for now' }).click()
  await screen.getByRole('dialog', { name: 'Skip migration?' }).getByRole('button', { name: 'Skip for now' }).click()
  await expect(screen.getByRole('navigation', { name: 'Menu' })).toBeVisible()

  await agent.act('open the list of active user accounts')
  await expect(screen.getByRole('tab', { name: /Active users/ })).toHaveAttribute('aria-selected', 'true')
  await agent.assert('the active users list includes {email} with the admin role', {
    params: { email: admin.username },
  })
})
