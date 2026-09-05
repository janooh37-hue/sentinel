/**
 * Capability catalog — real browser, cookie sessions, API, and synthetic SQLite.
 *
 * Normal paths use the real catalog and capability resolver. Only the catalog
 * network boundary is replaced in the fail-closed matrix below; auth,
 * /auth/me/capabilities, protected routes, and permission-request writes stay
 * real throughout.
 */

import type {
  Browser,
  BrowserContext,
  Cookie,
  Page,
  Route,
} from '@playwright/test'
import { expect, request, test } from '@playwright/test'

const DAY = '2026-08-19'
const CATALOG_PATH = '/api/v1/auth/capabilities'
const CATALOG_ROUTE = '**/api/v1/auth/capabilities'
const REQUEST_PATH = '/api/v1/permissions/requests'
const DESKTOP = { width: 1280, height: 900 }
const MOBILE = { width: 375, height: 812 }

type Locale = 'en' | 'ar'
type Persona = 'admin' | 'operator'

interface CatalogEntry {
  id: string
  domain: string
  label_en: string
  label_ar: string | null
  description_en: string
  description_ar: string | null
  sensitive: boolean
  requestable: boolean
  default_roles: string[]
}

interface LocalizedCopy {
  lang: Locale
  dir: 'ltr' | 'rtl'
  permissionStudio: string
  advancedPermissions: string
  knownCatalogLabel: string
  requestAccess: string
  requestTitle: string
  requestSend: string
  requestSent: string
  workforceLabel: string
  noAccess: string
  managedByAdmin: string
}

const COPY: Record<Locale, LocalizedCopy> = {
  en: {
    lang: 'en',
    dir: 'ltr',
    permissionStudio: 'Permissions studio',
    advancedPermissions: 'Advanced permissions',
    knownCatalogLabel: 'View records',
    requestAccess: 'Request access',
    requestTitle: 'Request permission',
    requestSend: 'Request',
    requestSent: 'Request sent',
    workforceLabel: 'View workforce people',
    noAccess: "You don't have access to this page",
    managedByAdmin: 'Access to this area is managed by administrators and cannot be requested.',
  },
  ar: {
    lang: 'ar',
    dir: 'rtl',
    permissionStudio: 'استوديو الصلاحيات',
    advancedPermissions: 'الصلاحيات المتقدمة',
    knownCatalogLabel: 'عرض السجلات',
    requestAccess: 'طلب الوصول',
    requestTitle: 'طلب إذن',
    requestSend: 'طلب',
    requestSent: 'تم إرسال الطلب',
    workforceLabel: 'عرض منتسبي القوى العاملة',
    noAccess: 'ليس لديك صلاحية الوصول إلى هذه الصفحة',
    managedByAdmin: 'تُدار صلاحية الوصول إلى هذه المنطقة من قِبل المسؤولين ولا يمكن طلبها.',
  },
}

const MATRIX = [
  { name: 'en-1280', locale: 'en' as const, viewport: DESKTOP, realToggle: false },
  { name: 'en-375', locale: 'en' as const, viewport: MOBILE, realToggle: false },
  { name: 'ar-1280', locale: 'ar' as const, viewport: DESKTOP, realToggle: true },
  { name: 'ar-375', locale: 'ar' as const, viewport: MOBILE, realToggle: false },
]

let baseURL = ''
let adminCookies: Cookie[] = []
let operatorCookies: Cookie[] = []
let realCatalog: CatalogEntry[] = []

test.describe.configure({ mode: 'serial', timeout: 90_000 })

test.beforeAll(async ({ baseURL: configuredBaseURL }) => {
  expect(configuredBaseURL, 'the isolated Playwright config must provide a base URL').toBeTruthy()
  if (!configuredBaseURL) throw new Error('missing Playwright base URL')
  baseURL = configuredBaseURL

  const authenticate = async (
    email: string,
    password: string,
  ): Promise<{ cookies: Cookie[]; catalog: CatalogEntry[] }> => {
    const context = await request.newContext({ baseURL })
    const login = await context.post('/api/v1/auth/login', { data: { email, password } })
    expect(login.status(), `${email} must authenticate against the synthetic backend`).toBe(200)
    const catalog = await context.get(CATALOG_PATH)
    expect(catalog.status(), `${email} must read the real Phase 3 catalog`).toBe(200)
    const body = await catalog.json() as CatalogEntry[]
    const cookies = (await context.storageState()).cookies as Cookie[]
    await context.dispose()
    return { cookies, catalog: body }
  }

  const admin = await authenticate('admin@preview.local', 'preview-admin-pw')
  const operator = await authenticate('operator@preview.local', 'preview-operator-pw')
  adminCookies = admin.cookies
  operatorCookies = operator.cookies
  realCatalog = operator.catalog

  const byId = new Map(realCatalog.map((entry) => [entry.id, entry]))
  expect(byId.get('workforce.people.view')).toMatchObject({ requestable: true, sensitive: false })
  expect(byId.get('users.manage')).toMatchObject({ requestable: false, sensitive: true })
  expect(byId.get('books.edit')).toMatchObject({ requestable: true, sensitive: false })
})

async function newPersonaPage(
  browser: Browser,
  persona: Persona,
  locale: Locale,
  viewport: { width: number; height: number },
  startInEnglish = false,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, viewport })
  await context.addCookies(persona === 'admin' ? adminCookies : operatorCookies)
  await context.addInitScript((initialLanguage) => {
    window.localStorage.setItem('gssg.lang', initialLanguage)
  }, startInEnglish ? 'en' : locale)
  return { context, page: await context.newPage() }
}

async function assertDocumentLocale(page: Page, locale: Locale): Promise<void> {
  const copy = COPY[locale]
  await expect(page.locator('html')).toHaveAttribute('lang', copy.lang)
  await expect(page.locator('html')).toHaveAttribute('dir', copy.dir)
}

async function switchToArabic(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Switch to Arabic' }).click()
  await assertDocumentLocale(page, 'ar')
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(
    dimensions.scrollWidth,
    `page overflows horizontally: ${dimensions.scrollWidth} > ${dimensions.innerWidth}`,
  ).toBeLessThanOrEqual(dimensions.innerWidth + 1)
}

function captureUnexpectedConsoleErrors(
  page: Page,
  allowedDeniedResourcePaths: readonly string[] = [],
): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const location = message.location().url
    const expectedDeniedResource = message.text()
      === 'Failed to load resource: the server responded with a status of 403 (Forbidden)'
      && location !== ''
      && allowedDeniedResourcePaths.includes(new URL(location).pathname)
    if (!expectedDeniedResource) errors.push(`${message.text()} @ ${location}`)
  })
  return errors
}

async function expectDialogOwnsFocus(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true)
}

async function expectAuthorizedCatalog(page: Page, locale: Locale): Promise<void> {
  const copy = COPY[locale]
  await expect(page.getByRole('heading', { name: copy.permissionStudio })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText(copy.advancedPermissions, { exact: true })).toBeVisible()
  await expect(page.getByText(copy.knownCatalogLabel, { exact: true }).first()).toBeVisible()
}

async function expectLocalizedDenialDialog(page: Page, locale: Locale): Promise<void> {
  const copy = COPY[locale]
  const dialog = page.getByRole('dialog', { name: copy.requestTitle })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(copy.workforceLabel)
  await expect(dialog).not.toContainText('workforce.people.view')
  await expectNoHorizontalOverflow(page)
}

for (const row of MATRIX) {
  test(`real catalog is localized and fail-safe at ${row.name}`, async ({ browser }, testInfo) => {
    const copy = COPY[row.locale]
    const admin = await newPersonaPage(
      browser,
      'admin',
      row.locale,
      row.viewport,
      row.realToggle,
    )
    const operator = await newPersonaPage(
      browser,
      'operator',
      row.locale,
      row.viewport,
      row.realToggle,
    )
    const adminConsoleErrors = captureUnexpectedConsoleErrors(admin.page)
    const operatorConsoleErrors = captureUnexpectedConsoleErrors(
      operator.page,
      row.name === 'ar-375' ? ['/api/v1/books/word-templates'] : [],
    )

    try {
      if (row.name === 'en-1280') {
        let releaseCatalog!: () => void
        let catalogFinished!: () => void
        const held = new Promise<void>((resolve) => { releaseCatalog = resolve })
        const finished = new Promise<void>((resolve) => { catalogFinished = resolve })
        let catalogCalls = 0
        await admin.page.route(CATALOG_ROUTE, async (route) => {
          catalogCalls += 1
          await held
          await route.continue()
          catalogFinished()
        })

        await admin.page.goto(`/employees/attendance?date=${DAY}&shift=morning`)
        await expect(admin.page.getByTestId('attendance-register-unit')).toHaveCount(1, {
          timeout: 20_000,
        })
        await expect(admin.page.getByTestId('attendance-register-post')).toHaveCount(9)
        await expect(admin.page.getByRole('button', { name: copy.requestAccess })).toHaveCount(0)
        releaseCatalog()
        if (catalogCalls > 0) await finished
        await admin.page.unroute(CATALOG_ROUTE)
      }

      await admin.page.goto('/permissions')
      if (row.realToggle) await switchToArabic(admin.page)
      else await assertDocumentLocale(admin.page, row.locale)
      await expectAuthorizedCatalog(admin.page, row.locale)
      await expectNoHorizontalOverflow(admin.page)
      await admin.page.screenshot({
        path: testInfo.outputPath(`p3-catalog-admin-${row.name}.png`),
        fullPage: true,
      })

      await operator.page.goto(`/employees/attendance?date=${DAY}&shift=morning`)
      if (row.realToggle) await switchToArabic(operator.page)
      else await assertDocumentLocale(operator.page, row.locale)
      await expect(operator.page.getByText(copy.noAccess, { exact: true })).toBeVisible()
      await expect(operator.page.getByTestId('attendance-register-unit')).toHaveCount(0)
      const requestAccess = operator.page.getByRole('button', {
        name: copy.requestAccess,
        exact: true,
      })
      await expect(requestAccess).toBeVisible({ timeout: 15_000 })
      await expectNoHorizontalOverflow(operator.page)

      await requestAccess.focus()
      await expect(requestAccess).toBeFocused()
      await operator.page.keyboard.press('Enter')
      await expectLocalizedDenialDialog(operator.page, row.locale)
      await operator.page.screenshot({
        path: testInfo.outputPath(`p3-catalog-denied-${row.name}.png`),
        fullPage: true,
      })

      if (row.name === 'en-1280') {
        const dialog = operator.page.getByRole('dialog', { name: copy.requestTitle })
        await expectDialogOwnsFocus(operator.page)
        await operator.page.keyboard.press('Tab')
        await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
          .toBe(true)
        await operator.page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(requestAccess).toBeFocused()

        await operator.page.keyboard.press('Space')
        await expectDialogOwnsFocus(operator.page)
        const postRequest = operator.page.waitForRequest((outbound) =>
          outbound.method() === 'POST' && new URL(outbound.url()).pathname === REQUEST_PATH,
        )
        const postResponse = operator.page.waitForResponse((response) =>
          response.request().method() === 'POST'
          && new URL(response.url()).pathname === REQUEST_PATH,
        )
        const requestButton = operator.page
          .getByRole('dialog', { name: copy.requestTitle })
          .getByRole('button', { name: copy.requestSend, exact: true })
        await requestButton.focus()
        await operator.page.keyboard.press('Enter')
        const [outbound, response] = await Promise.all([postRequest, postResponse])
        expect(outbound.postDataJSON()).toEqual({ capability: 'workforce.people.view' })
        expect(response.status()).toBeGreaterThanOrEqual(200)
        expect(response.status()).toBeLessThan(300)
        await expect(operator.page.getByRole('dialog')).toHaveCount(0)
        await expect(operator.page.getByText(copy.requestSent, { exact: true })).toBeVisible()
      } else {
        await operator.page.keyboard.press('Escape')
        await expect(operator.page.getByRole('dialog')).toHaveCount(0)
        await expect(requestAccess).toBeFocused()
      }

      if (row.name === 'ar-375') {
        await operator.page.goto('/permissions')
        await assertDocumentLocale(operator.page, 'ar')
        await expect(operator.page.getByText(copy.managedByAdmin, { exact: true })).toBeVisible()
        await expect(operator.page.getByRole('heading', { name: copy.permissionStudio })).toHaveCount(0)
        await expect(operator.page.getByRole('button', { name: copy.requestAccess })).toHaveCount(0)
        await expect(operator.page.locator('body')).not.toContainText('users.manage')
        await expectNoHorizontalOverflow(operator.page)
        await operator.page.screenshot({
          path: testInfo.outputPath('p3-catalog-sensitive-ar-375.png'),
          fullPage: true,
        })

        await operator.page.goto('/application')
        await assertDocumentLocale(operator.page, 'ar')
        const deniedWordTemplates = operator.page.waitForResponse(
          (response) => new URL(response.url()).pathname === '/api/v1/books/word-templates',
        )
        await operator.page.getByRole('button', { name: /كتاب عام/ }).click()
        expect((await deniedWordTemplates).status()).toBe(403)
        await expect(operator.page.getByRole('heading', { name: /كتاب عام/ })).toBeVisible({
          timeout: 20_000,
        })
        await expect(operator.page.getByPlaceholder('البحث عن مستلم…')).toBeVisible()
        const locks = operator.page.getByRole('button', {
          name: /تعديل السجلات والمرفقات/,
        })
        await expect(locks).toHaveCount(2)
        const lock = locks.first()
        await expect(lock).toBeVisible()
        for (const inlineLock of await locks.all()) {
          const tabbableDescendants = await inlineLock.locator(
            'button, a[href], input, select, textarea, [tabindex]',
          ).evaluateAll((elements) => elements.filter((element) => {
            const htmlElement = element as HTMLElement
            const disabled = 'disabled' in htmlElement && Boolean(
              (htmlElement as HTMLElement & { disabled?: boolean }).disabled,
            )
            return htmlElement.tabIndex >= 0
              && !disabled
              && htmlElement.closest('[inert]') === null
          }).length)
          expect(tabbableDescendants, 'each inline lock must expose one wrapper tab stop').toBe(0)
        }

        await lock.focus()
        await expect(lock).toBeFocused()
        await operator.page.keyboard.press('Enter')
        await expectDialogOwnsFocus(operator.page)
        let inlineDialog = operator.page.getByRole('dialog', { name: copy.requestTitle })
        await expect(inlineDialog).toContainText('تعديل السجلات والمرفقات')
        await expect(inlineDialog).not.toContainText('books.edit')
        await operator.page.keyboard.press('Escape')
        await expect(inlineDialog).toHaveCount(0)
        await expect(lock).toBeFocused()
        await operator.page.keyboard.press('Space')
        inlineDialog = operator.page.getByRole('dialog', { name: copy.requestTitle })
        await expect(inlineDialog).toBeVisible()
        await expectDialogOwnsFocus(operator.page)
        await expectNoHorizontalOverflow(operator.page)
        await operator.page.screenshot({
          path: testInfo.outputPath('p3-catalog-inline-ar-375.png'),
          fullPage: true,
        })
        await operator.page.keyboard.press('Escape')
      }

      expect(adminConsoleErrors, `admin console errors: ${adminConsoleErrors.join(' | ')}`)
        .toHaveLength(0)
      expect(operatorConsoleErrors, `operator console errors: ${operatorConsoleErrors.join(' | ')}`)
        .toHaveLength(0)
    } finally {
      await admin.context.close()
      await operator.context.close()
    }
  })
}

test('catalog loading, errors, malformed data, unknown IDs, and false requestability fail closed', async ({ browser }) => {
  const target = realCatalog.find((entry) => entry.id === 'workforce.people.view')
  if (!target) throw new Error('real catalog omitted workforce.people.view')

  const openInterceptedDenial = async (
    handler: (route: Route) => Promise<void>,
    denialText = COPY.en.noAccess,
  ): Promise<{ context: BrowserContext; page: Page }> => {
    const fixture = await newPersonaPage(browser, 'operator', 'en', DESKTOP)
    await fixture.page.route(CATALOG_ROUTE, handler)
    await fixture.page.goto(`/employees/attendance?date=${DAY}&shift=morning`)
    await expect(fixture.page.getByText(denialText, { exact: true })).toBeVisible()
    await expect(fixture.page.getByTestId('attendance-register-unit')).toHaveCount(0)
    return fixture
  }

  let releaseCatalog!: () => void
  let catalogStarted!: () => void
  const held = new Promise<void>((resolve) => { releaseCatalog = resolve })
  const started = new Promise<void>((resolve) => { catalogStarted = resolve })
  const loading = await openInterceptedDenial(async (route) => {
    catalogStarted()
    await held
    await route.continue()
  })
  try {
    await started
    await expect(loading.page.getByRole('button', { name: COPY.en.requestAccess })).toHaveCount(0)
    releaseCatalog()
    await expect(loading.page.getByRole('button', { name: COPY.en.requestAccess })).toBeVisible()
  } finally {
    releaseCatalog()
    await loading.context.close()
  }

  let attempts = 0
  const unavailable = await openInterceptedDenial(async (route) => {
    attempts += 1
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic catalog outage' } }),
    })
  })
  try {
    await expect.poll(() => attempts, { timeout: 10_000 }).toBe(2)
    await expect(unavailable.page.getByRole('button', { name: COPY.en.requestAccess })).toHaveCount(0)
    await expect(unavailable.page.locator('body')).not.toContainText('workforce.people.view')
  } finally {
    await unavailable.context.close()
  }

  let malformedAttempts = 0
  const malformedCatalog = realCatalog.map((entry) =>
    entry.id === target.id ? { ...entry, requestable: 'yes' } : entry)
  const malformed = await openInterceptedDenial(async (route) => {
    malformedAttempts += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(malformedCatalog) })
  })
  try {
    await expect.poll(() => malformedAttempts, { timeout: 10_000 }).toBe(2)
    await expect(malformed.page.getByRole('button', { name: COPY.en.requestAccess })).toHaveCount(0)
    await expect(malformed.page.locator('body')).not.toContainText('workforce.people.view')
  } finally {
    await malformed.context.close()
  }

  const unknown = await openInterceptedDenial(async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(realCatalog.filter((entry) => entry.id !== target.id)),
    })
  })
  try {
    // A second known entry proves this catalog reached ready state; the absent
    // workforce ID must still remain unknown and therefore non-requestable.
    await unknown.page.goto('/permissions')
    await expect(unknown.page.getByText(COPY.en.managedByAdmin, { exact: true })).toBeVisible()
    await unknown.page.goto(`/employees/attendance?date=${DAY}&shift=morning`)
    await expect(unknown.page.getByRole('button', { name: COPY.en.requestAccess })).toHaveCount(0)
    await expect(unknown.page.locator('body')).not.toContainText('workforce.people.view')
  } finally {
    await unknown.context.close()
  }

  const nonRequestable = await openInterceptedDenial(
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(realCatalog.map((entry) =>
          entry.id === target.id ? { ...entry, requestable: false } : entry)),
      })
    },
    COPY.en.managedByAdmin,
  )
  try {
    await expect(nonRequestable.page.getByText(COPY.en.managedByAdmin, { exact: true })).toBeVisible()
    await expect(nonRequestable.page.getByRole('button', { name: COPY.en.requestAccess })).toHaveCount(0)
    await expect(nonRequestable.page.locator('body')).not.toContainText('workforce.people.view')
  } finally {
    await nonRequestable.context.close()
  }
})

test('logout and sign-in fetch a catalog for the new identity', async ({ browser }) => {
  const fixture = await newPersonaPage(browser, 'operator', 'en', DESKTOP)
  const { context, page } = fixture
  let catalogResponses = 0
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === CATALOG_PATH && response.status() === 200) {
      catalogResponses += 1
    }
  })

  try {
    await page.goto(`/employees/attendance?date=${DAY}&shift=morning`)
    await expect(page.getByRole('button', { name: COPY.en.requestAccess })).toBeVisible()
    await expect.poll(() => catalogResponses).toBeGreaterThanOrEqual(1)
    const operatorCatalogResponses = catalogResponses

    await page.getByRole('button', { name: 'operator@preview.local' }).click()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.locator('#login-email')).toBeVisible()
    await page.locator('#login-email').fill('admin@preview.local')
    await page.locator('#login-pwd').fill('preview-admin-pw')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('button', { name: 'admin@preview.local' })).toBeVisible({
      timeout: 15_000,
    })
    await page.goto('/permissions')
    await expect.poll(() => catalogResponses, { timeout: 15_000 })
      .toBeGreaterThan(operatorCatalogResponses)
    await expectAuthorizedCatalog(page, 'en')
    await expect(page.getByRole('button', { name: COPY.en.requestAccess })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
