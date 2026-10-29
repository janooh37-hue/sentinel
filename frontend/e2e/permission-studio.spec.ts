import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'
import type { components } from '../src/lib/api.types'
import en from '../src/locales/en.json' with { type: 'json' }
import ar from '../src/locales/ar.json' with { type: 'json' }

type Snapshot = components['schemas']['AccessSnapshot']
type Patch = components['schemas']['Patch']
type Account = components['schemas']['AdminUserRead']
type Preview = components['schemas']['PreviewResponse']
type Check = components['schemas']['CheckResponse']
type Locale = 'en' | 'ar'

// Only the isolated launcher creates these accounts. No production credentials,
// authorization interception, target-session impersonation or business writes.
const targetEmail = 'operator@preview.local'
const sourceEmail = 'manager@preview.local'
const templateGrant: Patch = { capability: 'messages.templates', effect: 'grant', expires_at: null }
const templateDeny: Patch = { capability: 'messages.templates', effect: 'deny', expires_at: null }
const employeeDeny: Patch = { capability: 'employees.edit', effect: 'deny', expires_at: null }
const accessUrl = (id: number) => `/api/v1/auth/users/${id}/effective-access`
const bulkUrl = (id: number) => `/api/v1/auth/users/${id}/permissions/bulk`
const sortedPatches = (items: Patch[]) => [...items].sort((a, b) => a.capability.localeCompare(b.capability))
const personalSettings = (snapshot: Snapshot): Patch[] => sortedPatches(snapshot.overrides.map(({ capability, effect, expires_at }) => ({ capability, effect, expires_at: expires_at ?? null })))

async function snapshotFor(request: APIRequestContext, id: number): Promise<Snapshot> {
  const response = await request.get(accessUrl(id))
  expect(response.status(), await response.text()).toBe(200)
  expect(response.headers()['cache-control']).toContain('no-store')
  return response.json()
}

async function prepareTarget(request: APIRequestContext, id: number): Promise<Snapshot> {
  const previous = await snapshotFor(request, id)
  // Use the real conditional mutation to reset only this synthetic target.
  // This also makes retries and all four locale/device journeys independent.
  const items: Patch[] = previous.overrides
    .filter(({ capability }) => capability !== templateGrant.capability)
    .map(({ capability }) => ({ capability, effect: null, expires_at: null }))
  items.push(templateGrant)
  expect(items.length).toBeLessThanOrEqual(200)
  const response = await request.put(bulkUrl(id), {
    headers: { 'If-Match': previous.revision },
    data: { items },
  })
  expect(response.status(), await response.text()).toBe(200)
  const prepared = await snapshotFor(request, id)
  expect(personalSettings(prepared)).toEqual([templateGrant])
  expect(prepared.subject).toMatchObject({ user_id: id, role: 'operator', status: 'active', authentication_eligible: true })
  return prepared
}

async function reviewAndSave(
  page: Page,
  request: APIRequestContext,
  locale: Locale,
  baseline: Snapshot,
  items: Patch[],
): Promise<Snapshot> {
  const strings = (locale === 'en' ? en : ar).access.studio
  const review = page.getByRole('region', { name: strings.review.title, exact: true })
  const exactChanges = review.getByRole('list', { name: strings.review.exactChanges, exact: true })
  await expect(exactChanges.getByRole('listitem')).toHaveCount(items.length)

  const previewResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `${accessUrl(baseline.subject.user_id)}/preview`)
  await review.getByRole('button', { name: strings.review.refresh, exact: true }).click()
  // Header navigation must expose a focused decision even while preview is in flight.
  await page.getByRole('button', { name: strings.backToAccounts, exact: true }).click()
  const leavePrompt = page.getByRole('alert').filter({ hasText: strings.leaveDirty })
  await expect(leavePrompt).toBeFocused()
  await expect(leavePrompt.getByRole('button', { name: strings.stay, exact: true })).toBeInViewport()
  await leavePrompt.getByRole('button', { name: strings.stay, exact: true }).click()
  await expect(exactChanges.getByRole('listitem')).toHaveCount(items.length)
  const response = await previewResponse
  expect(response.status(), await response.text()).toBe(200)
  expect(response.request().postDataJSON()).toEqual({ expected_revision: baseline.revision, items: sortedPatches(items) })
  const preview: Preview = await response.json()
  expect(preview.current.revision).toBe(baseline.revision)
  expect(preview.current.subject.user_id).toBe(baseline.subject.user_id)
  expect(preview.proposed.subject).toEqual(baseline.subject)
  expect(preview.validation.filter(({ severity }) => severity === 'error')).toEqual([])
  await expect(review.getByRole('heading', { name: strings.review.impacts, exact: true })).toBeVisible()
  await expect(review.getByText(strings.review.noValidation, { exact: true })).toBeVisible()
  // A preview must not apply even a single personal exception.
  expect((await snapshotFor(request, baseline.subject.user_id)).revision).toBe(baseline.revision)
  await review.getByRole('button', { name: strings.review.acknowledge, exact: true }).click()
  await expect(review.getByText(strings.review.ready, { exact: true })).toBeVisible()

  const savedResponse = page.waitForResponse((result) => result.request().method() === 'PUT' && new URL(result.url()).pathname === bulkUrl(baseline.subject.user_id))
  await page.getByRole('button', { name: strings.save, exact: true }).click()
  const saved = await savedResponse
  expect(saved.status(), await saved.text()).toBe(200)
  expect(saved.request().headers()['if-match']).toBe(baseline.revision)
  expect(sortedPatches(saved.request().postDataJSON().items)).toEqual(sortedPatches(items))
  await expect(page.getByRole('status').filter({ hasText: strings.saved.replace('{{id}}', String(baseline.subject.user_id)) })).toBeVisible()
  await expect(review).toHaveCount(0)
  const refreshed = await snapshotFor(request, baseline.subject.user_id)
  expect(refreshed.revision).not.toBe(baseline.revision)
  expect(saved.headers()['etag']?.replace(/^"|"$/g, '')).toBe(refreshed.revision.replace(/^"|"$/g, ''))
  return refreshed
}

for (const locale of ['en', 'ar'] as const) {
  for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    test(`real account search, deny, check and reviewed copy ${locale} ${viewport.width}x${viewport.height}`, async ({ page, context, request }) => {
      test.setTimeout(120_000)
      const strings = (locale === 'en' ? en : ar).access.studio
      await page.setViewportSize(viewport)
      const login = await request.post('/api/v1/auth/login', {
        data: { email: 'admin@preview.local', password: 'preview-admin-pw' },
      })
      expect(login.status(), await login.text()).toBe(200)
      await context.addCookies((await request.storageState()).cookies)
      await page.addInitScript((language) => {
        localStorage.setItem('gssg.lang', language)
        localStorage.setItem('gssg.migration.skipped', 'true')
      }, locale)
      const usersResponse = await request.get('/api/v1/auth/users')
      expect(usersResponse.status(), await usersResponse.text()).toBe(200)
      const users: Account[] = await usersResponse.json()
      const target = users.find(({ email }) => email === targetEmail)
      const source = users.find(({ email }) => email === sourceEmail)
      expect(target, 'isolated operator fixture is required').toBeDefined()
      expect(source, 'isolated manager fixture is required').toBeDefined()
      if (!target || !source) throw new Error('Start the isolated launcher with operator and manager fixture accounts')
      expect(source.role).toBe('manager')
      expect(source.status).toBe('active')
      const sourceBefore = await snapshotFor(request, source.id)
      expect(sourceBefore.subject.authentication_eligible).toBe(true)
      expect(personalSettings(sourceBefore)).toEqual(sortedPatches([templateGrant, employeeDeny]))
      const baseline = await prepareTarget(request, target.id)
      const notification = baseline.items
        .filter(({ resource }) => resource.kind === 'notification_template')
        .sort((a, b) => a.resource.id.localeCompare(b.resource.id, 'en'))[0]
      expect(notification, 'real notification catalog is required').toBeDefined()
      if (!notification) throw new Error('No notification wording resource in the real catalog')
      expect(notification.actions.find(({ action }) => action === 'edit')?.authorization).toBe('allowed')

      const authorizationWrites: Request[] = []
      page.on('request', (outgoing) => {
        if (['PUT', 'PATCH', 'DELETE'].includes(outgoing.method()) && /\/auth\/users\/\d+\/permissions(?:\/bulk)?$/.test(new URL(outgoing.url()).pathname)) authorizationWrites.push(outgoing)
      })
      await page.goto('/permissions?tab=people&dept=7')
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      await expect(page).not.toHaveURL(/[?&]user=/)
      const accountSearch = page.getByRole('combobox', { name: strings.search.accounts, exact: true })
      await expect(accountSearch).toBeVisible()
      // Phone entry must not summon its keyboard before the user chooses search.
      await expect(accountSearch).not.toBeFocused()
      await page.getByRole('combobox', { name: strings.role, exact: true }).selectOption('operator')
      await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))))
      await page.screenshot({ path: `../.impeccable/review/perm-polish/${locale}-${viewport.width}-register.png` })
      await page.getByRole('combobox', { name: strings.statusLabel, exact: true }).selectOption('active')
      await accountSearch.fill(target.email)
      const accountResult = page.getByRole('listbox', { name: strings.search.accounts, exact: true }).getByRole('option').filter({ hasText: target.email })
      await expect(accountResult).toHaveCount(1)
      await accountSearch.press('ArrowDown')
      await expect(accountResult).toHaveAttribute('aria-selected', 'true')
      await accountSearch.press('Enter')
      await expect(page).toHaveURL(new RegExp(`[?&]user=${target.id}(?:&|$)`))
      await expect(page).toHaveURL(/dept=7/)
      await expect(page.getByText(target.email, { exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: strings.access, exact: true })).toBeVisible()
      const firstAction = page.getByRole('article').first()
      await expect(firstAction).toBeInViewport()
      if (viewport.width >= 1000) {
        const visibleRows = await page.getByRole('article').evaluateAll((rows) => rows.filter((row) => {
          const rect = row.getBoundingClientRect()
          return rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight
        }).length)
        expect(visibleRows).toBeGreaterThanOrEqual(10)
      }
      await page.screenshot({ path: `../.impeccable/review/perm-polish/${locale}-${viewport.width}-workspace.png` })

      const resourceSearch = page.getByRole('combobox', { name: strings.search.resources, exact: true })
      const editName = `${strings.actions.edit} · ${notification.label[locale]}`
      const editRow = page.getByRole('article', { name: editName, exact: true })
      // Both catalog languages must find the same action in either UI language.
      for (const query of [notification.label.en, notification.label.ar]) {
        await resourceSearch.fill(query)
        const results = page.getByRole('listbox', { name: strings.search.resources, exact: true })
        const editResult = results.getByRole('option', { name: `${notification.label[locale]} · ${strings.search.actions.edit}`, exact: true })
        await expect(editResult).toHaveCount(1)
        if (query === notification.label[locale]) await page.screenshot({ path: `../.impeccable/review/perm-polish/${locale}-${viewport.width}-search.png` })
        await editResult.click()
        await expect(editRow.getByRole('heading', { name: editName, exact: true })).toBeFocused()
        await expect(page.getByText(target.email, { exact: true })).toBeInViewport()
        await page.getByRole('button', { name: strings.backToResults, exact: true }).click()
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        await expect(resourceSearch).toBeFocused()
      }
      await resourceSearch.press('Escape')
      expect(authorizationWrites).toHaveLength(0)
      await editRow.getByRole('radio', { name: strings.settings.deny, exact: true }).check()
      const denied = await reviewAndSave(page, request, locale, baseline, [templateDeny])
      expect(authorizationWrites).toHaveLength(1)
      expect(personalSettings(denied)).toEqual([templateDeny])
      const savedNotification = denied.items.find(({ resource }) => resource.kind === 'notification_template' && resource.id === notification.resource.id)
      expect(savedNotification?.actions.find(({ action }) => action === 'edit')).toMatchObject({ authorization: 'denied', executable_now: false })
      expect(savedNotification?.actions.find(({ action }) => action === 'view')?.authorization).toBe('allowed')
      await expect(editRow.getByRole('radio', { name: strings.settings.deny, exact: true })).toBeChecked()
      await expect(editRow.getByText(strings.outcomes.denied, { exact: true }).first()).toBeVisible()
      await editRow.locator('summary').filter({ hasText: strings.why.short }).click()
      const why = editRow.locator('details[open]')
      await expect(why.getByRole('heading', { name: strings.why.decisive, exact: true })).toBeVisible()
      await expect(why.getByText(strings.reasonCodes.PERSONAL_DENY, { exact: true }).first()).toBeVisible()
      const viewRow = page.getByRole('article', { name: `${strings.actions.view} · ${notification.label[locale]}`, exact: true })
      await expect(viewRow.getByText(strings.outcomes.allowed, { exact: true }).first()).toBeVisible()

      // Check uses the current admin cookie, never the subject's credentials.
      const check = page.getByRole('region', { name: strings.check.title, exact: true })
      await check.getByRole('combobox', { name: strings.check.kind, exact: true }).selectOption('notification_template')
      await check.getByRole('textbox', { name: strings.check.resourceId, exact: true }).fill(notification.resource.id)
      await check.getByRole('combobox', { name: strings.check.action, exact: true }).selectOption('edit')
      const checkWrites: string[] = []
      const captureCheckWrite = (outgoing: Request) => {
        const path = new URL(outgoing.url()).pathname
        if (path.startsWith('/api/v1/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(outgoing.method())) {
          checkWrites.push(`${outgoing.method()} ${path}`)
        }
      }
      page.on('request', captureCheckWrite)
      const checkResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/auth/users/${target.id}/check-access`)
      await check.getByRole('button', { name: strings.check.submit, exact: true }).click()
      const checked = await checkResponse
      expect(checked.status(), await checked.text()).toBe(200)
      const checkedAccess: Check = await checked.json()
      expect(checkedAccess.snapshot.revision).toBe(denied.revision)
      expect(checkedAccess.current.authorization).toBe('denied')
      expect(checkedAccess.current.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PERSONAL_DENY', decisive: true, capability: 'messages.templates' })]))
      await expect(check.getByRole('heading', { name: strings.check.current, exact: true })).toBeVisible()
      await expect(check.getByText(strings.outcomes.denied, { exact: true }).first()).toBeVisible()
      const afterCheck = await snapshotFor(request, target.id)
      expect(afterCheck.revision).toBe(denied.revision)
      expect(personalSettings(afterCheck)).toEqual([templateDeny])
      expect(authorizationWrites).toHaveLength(1)
      page.off('request', captureCheckWrite)
      expect(checkWrites).toEqual([`POST /api/v1/auth/users/${target.id}/check-access`])

      const copy = page.getByRole('region', { name: strings.copy.title, exact: true })
      await copy.getByRole('combobox', { name: strings.copy.source, exact: true }).selectOption(String(source.id))
      const roleNames = (locale === 'en' ? en : ar).access.roleName
      const roleMismatch = strings.copy.roleMismatch.replace('{{sourceRole}}', roleNames.manager).replace('{{targetRole}}', roleNames.operator)
      await expect(copy.getByText(roleMismatch, { exact: true })).toBeVisible()
      const copyChanges = copy.getByRole('list', { name: strings.copy.exactChanges, exact: true })
      await expect(copyChanges.getByRole('listitem')).toHaveCount(2)
      for (const [capability, before, after] of [
        ['messages.templates', strings.review.deny, strings.review.allow],
        ['employees.edit', strings.review.followRole, strings.review.deny],
      ]) {
        const change = copyChanges.getByRole('listitem').filter({ hasText: capability })
        await expect(change.locator('dd').filter({ hasText: before })).toBeVisible()
        await expect(change.locator('dd').filter({ hasText: after })).toBeVisible()
      }
      const stageCopy = copy.getByRole('button', { name: strings.copy.stage, exact: true })
      await expect(stageCopy).toBeDisabled()
      await copy.getByRole('checkbox', { name: strings.copy.confirm, exact: true }).check()
      await expect(stageCopy).toBeEnabled()
      await stageCopy.click()
      expect(authorizationWrites).toHaveLength(1)
      expect((await snapshotFor(request, target.id)).revision).toBe(denied.revision)
      const copied = await reviewAndSave(page, request, locale, denied, [employeeDeny, templateGrant])
      expect(authorizationWrites).toHaveLength(2)
      expect(copied.subject).toEqual(denied.subject)
      expect(personalSettings(copied)).toEqual(sortedPatches([employeeDeny, templateGrant]))
      expect(copied.effective).toContain('messages.templates')
      expect(copied.effective).not.toContain('employees.edit')
      expect((await snapshotFor(request, source.id)).revision).toBe(sourceBefore.revision)
      await expect(editRow.getByRole('radio', { name: strings.settings.allow, exact: true })).toBeChecked()
      await expect(editRow.getByText(strings.outcomes.allowed, { exact: true }).first()).toBeVisible()
      await expect(page.getByText(target.email, { exact: true })).toBeVisible()

      // A personal view denial hides just this event, even with global edit
      // allowed. Restoring edit explicitly reviews both prerequisite IDs.
      const viewCapability = notification.actions.find(({ action }) => action === 'view')?.setting_capabilities[0]
      expect(viewCapability).toBeTruthy()
      if (!viewCapability) throw new Error('Per-template view binding is required')
      const viewDeny: Patch = { capability: viewCapability, effect: 'deny', expires_at: null }
      await viewRow.getByRole('radio', { name: strings.settings.deny, exact: true }).check()
      const hidden = await reviewAndSave(page, request, locale, copied, [viewDeny])
      const hiddenItem = hidden.items.find(({ resource }) => resource.kind === 'notification_template' && resource.id === notification.resource.id)
      expect(hiddenItem?.actions.find(({ action }) => action === 'view')?.authorization).toBe('denied')
      expect(hiddenItem?.actions.find(({ action }) => action === 'edit')?.authorization).toBe('denied')
      await viewRow.locator('summary').filter({ hasText: strings.why.short }).click()
      await expect(viewRow.getByText(strings.reasonCodes.PERSONAL_DENY, { exact: true }).first()).toBeVisible()

      // Deny/Allow here uses the actual controls rather than bypassing them
      // through an API patch, and the preview/save must carry both IDs.
      await editRow.getByRole('radio', { name: strings.settings.deny, exact: true }).check()
      await editRow.getByRole('radio', { name: strings.settings.allow, exact: true }).check()
      const viewGrant: Patch = { capability: viewCapability, effect: 'grant', expires_at: null }
      const restored = await reviewAndSave(page, request, locale, hidden, [templateGrant, viewGrant])
      expect(restored.items.find(({ resource }) => resource.kind === 'notification_template' && resource.id === notification.resource.id)?.actions.every(({ authorization }) => authorization === 'allowed')).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

      await page.getByRole('button', { name: strings.backToAccounts, exact: true }).click()
      await expect(page).not.toHaveURL(/[?&]user=/)
      await expect(page).toHaveURL(/dept=7/)
      await expect(accountSearch).toHaveValue(target.email)
      await expect(page.getByRole('combobox', { name: strings.role, exact: true })).toHaveValue('operator')
      await expect(page.getByRole('combobox', { name: strings.statusLabel, exact: true })).toHaveValue('active')
      const targetRow = page.getByRole('row').filter({ hasText: target.email })
      await expect(targetRow).toHaveCount(1)
      await expect(targetRow.getByRole('button', { name: strings.editAccess, exact: true })).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }
}
