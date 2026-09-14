/**
 * Attendance corrections through the real browser, API, SQLite, and query cache.
 *
 * Workforce datetimes are stored and returned as UTC-naive ISO strings. The
 * correction form must show those instants in Dubai wall time, while a
 * presence-only edit must send timezone-aware representations of those same
 * instants. This test fixes the browser timezone so it fails if a naive value is
 * parsed as browser-local time instead of UTC.
 */

import type { Cookie, Locator, Page, Response } from '@playwright/test'
import { expect, request, test } from '@playwright/test'

const DAY = '2026-08-19'
const DESKTOP = { width: 1280, height: 900 }
const MOBILE = { width: 375, height: 812 }

interface EffectiveAttendance {
  adjustment_id?: number | null
  presence_state: string | null
  first_in_at: string | null
  latest_in_at: string | null
  final_out_at: string | null
  late_minutes: number | null
  early_exit_minutes: number | null
  missing_checkout: boolean | null
}

interface Adjustment {
  id: number
  reason: string
  revoked_at: string | null
}

interface AttendanceCase {
  id: number
  employee_id: string
  name_en: string
  name_ar: string | null
  shift_code_snapshot: string
  effective: EffectiveAttendance
  adjustments: Adjustment[]
}

interface AttendanceDayRow {
  case_id: number
}

interface VersionedCase {
  body: AttendanceCase
  etag: string
}

let sessionCookies: Cookie[] = []

test.use({ timezoneId: 'Asia/Dubai' })

test.beforeAll(async ({ baseURL }) => {
  const context = await request.newContext({ baseURL })
  const response = await context.post('/api/v1/auth/login', {
    data: { email: 'admin@preview.local', password: 'preview-admin-pw' },
  })
  expect(response.status(), 'preview admin must authenticate').toBe(200)
  sessionCookies = (await context.storageState()).cookies as Cookie[]
  await context.dispose()
})

async function login(page: Page): Promise<void> {
  await page.context().addCookies(sessionCookies)
}

async function readCase(page: Page, caseId: number): Promise<VersionedCase> {
  const response = await page.request.get(`/api/v1/workforce/attendance/cases/${caseId}`)
  expect(response.status()).toBe(200)
  const etag = response.headers()['etag']
  expect(etag, 'attendance case reads must carry a concurrency version').toBeTruthy()
  return { body: await response.json() as AttendanceCase, etag }
}

function isUtcNaive(value: string | null): value is string {
  return value !== null && !/[zZ]$|[+-]\d\d:\d\d$/.test(value)
}

async function findPristineTimestampCase(page: Page): Promise<VersionedCase> {
  const response = await page.request.get(
    `/api/v1/workforce/attendance/day?operational_date=${DAY}&limit=200`,
  )
  expect(response.status()).toBe(200)
  const attendance = await response.json() as { items: AttendanceDayRow[] }
  expect(attendance.items, 'mutating regression requires the exact 80-case factory fixture')
    .toHaveLength(80)
  const cases: VersionedCase[] = []
  for (const item of attendance.items) {
    cases.push(await readCase(page, item.case_id))
  }
  const expectedIdentities = Array.from({ length: 40 }, (_, offset) => {
    const index = offset + 1
    return [`G-${9000 + index}`, `Factory Person ${index}`, `شخص ${index}`].join('\u0000')
  }).sort()
  const identityCounts = new Map<string, number>()
  for (const candidate of cases) {
    const identity = [
      candidate.body.employee_id,
      candidate.body.name_en,
      candidate.body.name_ar,
    ].join('\u0000')
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1)
  }
  expect(
    [...identityCounts.keys()].sort(),
    'mutating regression refuses any database other than the named 40-person factory fixture',
  ).toEqual(expectedIdentities)
  expect(
    [...identityCounts.values()].sort((left, right) => left - right),
    'each synthetic employee must have exactly two attendance cases',
  ).toEqual(Array.from({ length: 40 }, () => 2))

  for (const candidate of cases) {
    const effective = candidate.body.effective
    if (
      candidate.body.adjustments.length === 0
      && candidate.body.shift_code_snapshot === 'morning'
      && effective.presence_state !== 'absent'
      && isUtcNaive(effective.first_in_at)
      && isUtcNaive(effective.latest_in_at)
      && isUtcNaive(effective.final_out_at)
    ) {
      return candidate
    }
  }
  throw new Error('synthetic attendance day has no pristine exception with UTC-naive timestamps')
}

async function gotoAttendance(page: Page): Promise<void> {
  await page.goto(`/employees/attendance?date=${DAY}`)
  await expect(page.getByTestId('attendance-register-unit').first()).toBeVisible({ timeout: 15_000 })
}

async function openReview(page: Page, employeeName: string): Promise<Locator> {
  const isArabic = await page.locator('html').getAttribute('lang') === 'ar'
  const reviewLabel = `${isArabic ? 'مراجعة' : 'Review'} ${employeeName}`
  const shiftLabel = isArabic ? 'الصباحية' : 'Morning'
  const review = page
    .getByTestId('attendance-attention-queue')
    .locator('li')
    .filter({ hasText: employeeName })
    .filter({ hasText: shiftLabel })
    .getByRole('button', { name: reviewLabel, exact: true })
  await review.click()
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible()
  return dialog
}

async function closeReview(page: Page): Promise<void> {
  await page.getByRole('dialog').first().getByRole('button', { name: /^(Close|إغلاق)$/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function switchLanguage(page: Page, language: 'Arabic' | 'English'): Promise<void> {
  await page.getByRole('button', { name: `Switch to ${language}` }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', language === 'Arabic' ? 'ar' : 'en')
  await expect(page.locator('html')).toHaveAttribute('dir', language === 'Arabic' ? 'rtl' : 'ltr')
}

function dubaiInputValue(utcNaive: string): string {
  const instant = new Date(`${utcNaive}Z`).getTime()
  return new Date(instant + 4 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

function replacementPayload(effective: EffectiveAttendance, reason: string): Record<string, unknown> {
  const submissionTimestamp = (value: string | null): string | null =>
    value === null || /[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`
  return {
    replacement_presence_state: effective.presence_state,
    replacement_first_in_at: submissionTimestamp(effective.first_in_at),
    replacement_latest_in_at: submissionTimestamp(effective.latest_in_at),
    replacement_final_out_at: submissionTimestamp(effective.final_out_at),
    replacement_late_minutes: effective.late_minutes,
    replacement_early_exit_minutes: effective.early_exit_minutes,
    replacement_missing_checkout: effective.missing_checkout,
    reason,
  }
}

async function expectMutation(
  responsePromise: Promise<Response>,
  expectedStatus: number,
): Promise<Response> {
  const response = await responsePromise
  expect(response.status(), await response.text()).toBe(expectedStatus)
  return response
}

test('presence-only correction preserves naive timestamps, persists, conflicts, revokes, and remains bilingual', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize(DESKTOP)
  await login(page)

  const pristine = await findPristineTimestampCase(page)
  const setup = await page.request.post(
    `/api/v1/workforce/attendance/cases/${pristine.body.id}/adjustments`,
    {
      headers: { 'If-Match': pristine.etag },
      data: {
        ...replacementPayload(pristine.body.effective, 'Browser exception setup'),
        replacement_presence_state: 'on_duty',
        replacement_missing_checkout: true,
      },
    },
  )
  expect(setup.status(), await setup.text()).toBe(201)
  const original = await readCase(page, pristine.body.id)
  const employee = original.body
  const originalEffective = employee.effective
  expect(originalEffective.presence_state).toBe('on_duty')
  expect(originalEffective.missing_checkout).toBe(true)
  await gotoAttendance(page)
  const rawTimes = [
    originalEffective.first_in_at,
    originalEffective.latest_in_at,
    originalEffective.final_out_at,
  ] as const
  expect(rawTimes.every(isUtcNaive), 'fixture timestamps must be existing UTC-naive values').toBe(true)

  let dialog = await openReview(page, employee.name_en)
  await expect(dialog.getByText('Correction', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('First in')).toHaveValue(dubaiInputValue(rawTimes[0]!))
  await expect(dialog.getByLabel('Latest in')).toHaveValue(dubaiInputValue(rawTimes[1]!))
  await expect(dialog.getByLabel('Final out')).toHaveValue(dubaiInputValue(rawTimes[2]!))
  const desktopEnglishBox = await dialog.boundingBox()
  expect(desktopEnglishBox?.width).toBeLessThanOrEqual(577)

  await dialog.getByLabel('Correction presence').selectOption('completed')
  await dialog.getByLabel('Correction reason').fill('Browser presence-only correction')
  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && response.url().endsWith(`/attendance/cases/${employee.id}/adjustments`),
  )
  await dialog.getByRole('button', { name: 'Save correction' }).click()
  const created = await expectMutation(createResponsePromise, 201)
  const createBody = created.request().postDataJSON() as Record<string, unknown>
  expect(createBody).toEqual({
    ...replacementPayload(originalEffective, 'Browser presence-only correction'),
    replacement_presence_state: 'completed',
  })
  const createdId = (await created.json() as { id: number }).id
  await expect(dialog.getByRole('status')).toContainText('Correction saved.')

  const persisted = await readCase(page, employee.id)
  expect(persisted.etag).not.toBe(original.etag)
  expect(persisted.body.effective).toMatchObject({
    adjustment_id: createdId,
    presence_state: 'completed',
    first_in_at: originalEffective.first_in_at,
    latest_in_at: originalEffective.latest_in_at,
    final_out_at: originalEffective.final_out_at,
    late_minutes: originalEffective.late_minutes,
    early_exit_minutes: originalEffective.early_exit_minutes,
    missing_checkout: originalEffective.missing_checkout,
  })

  await closeReview(page)
  dialog = await openReview(page, employee.name_en)
  await expect(dialog.getByText('Browser presence-only correction', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Completed', { exact: true }).first()).toBeVisible()
  await closeReview(page)

  await switchLanguage(page, 'Arabic')
  dialog = await openReview(page, employee.name_ar ?? employee.name_en)
  await expect(dialog.getByText('تصحيح الحضور', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('أول دخول')).toHaveValue(dubaiInputValue(rawTimes[0]!))
  const desktopArabicBox = await dialog.boundingBox()
  expect(desktopArabicBox?.width).toBeLessThanOrEqual(577)
  expect(desktopArabicBox?.x).toBeLessThanOrEqual(1)
  await closeReview(page)

  await page.setViewportSize(MOBILE)
  dialog = await openReview(page, employee.name_ar ?? employee.name_en)
  await expect(dialog.getByLabel('حالة التصحيح')).toHaveValue('completed')
  const mobileArabicBox = await dialog.boundingBox()
  expect(mobileArabicBox?.x).toBe(0)
  expect(mobileArabicBox?.width).toBe(MOBILE.width)
  expect(await dialog.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(MOBILE.width)
  await closeReview(page)

  await page.setViewportSize(DESKTOP)
  await switchLanguage(page, 'English')
  await page.setViewportSize(MOBILE)
  dialog = await openReview(page, employee.name_en)
  await expect(dialog.getByLabel('Correction presence')).toHaveValue('completed')
  const mobileEnglishBox = await dialog.boundingBox()
  expect(mobileEnglishBox?.x).toBe(0)
  expect(mobileEnglishBox?.width).toBe(MOBILE.width)
  expect(await dialog.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(MOBILE.width)
  await closeReview(page)

  await page.setViewportSize(DESKTOP)
  dialog = await openReview(page, employee.name_en)
  await dialog.getByLabel('Correction presence').selectOption('absent')
  await dialog.getByLabel('Correction reason').fill('Preserved browser draft')

  const current = await readCase(page, employee.id)
  const concurrentPayload = replacementPayload(current.body.effective, 'Concurrent supervisor correction')
  concurrentPayload['replacement_late_minutes'] = (current.body.effective.late_minutes ?? 0) + 1
  const concurrent = await page.request.post(
    `/api/v1/workforce/attendance/cases/${employee.id}/adjustments`,
    { headers: { 'If-Match': current.etag }, data: concurrentPayload },
  )
  expect(concurrent.status(), await concurrent.text()).toBe(201)
  const concurrentId = (await concurrent.json() as { id: number }).id

  const conflictResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && response.url().endsWith(`/attendance/cases/${employee.id}/adjustments`),
  )
  await dialog.getByRole('button', { name: 'Save correction' }).click()
  const conflict = await expectMutation(conflictResponsePromise, 409)
  expect((await conflict.json() as { error: { code: string } }).error.code)
    .toBe('ATTENDANCE_CASE_VERSION_CONFLICT')
  await expect(dialog.getByRole('alert')).toContainText('This attendance case changed')
  await expect(dialog.getByLabel('Correction presence')).toHaveValue('absent')
  await expect(dialog.getByLabel('Correction reason')).toHaveValue('Preserved browser draft')

  await dialog.getByLabel('Revoke reason').fill('Concurrent correction was only a conflict probe')
  await dialog.getByRole('button', { name: 'Revoke correction' }).click()
  const revokeResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && response.url().endsWith(`/adjustments/${concurrentId}/revoke`),
  )
  await page.getByRole('button', { name: 'Confirm revoke' }).click()
  await expectMutation(revokeResponsePromise, 200)
  await expect(dialog.getByRole('status')).toContainText('Correction revoked.')

  const afterRevoke = await readCase(page, employee.id)
  expect(afterRevoke.body.effective.adjustment_id).toBe(createdId)
  expect(afterRevoke.body.effective.presence_state).toBe('completed')
  expect(afterRevoke.body.adjustments.find((item) => item.id === concurrentId)?.revoked_at).not.toBeNull()
})
