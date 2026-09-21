/**
 * Signature placement workspace — real browser, real pdf.js canvas, real
 * base64 image decoding, fully synthetic backend (signature-placement-repair
 * plan verification: "browser: actual ink before Save").
 *
 * Every API request is explicitly mocked via route interception (mirrors
 * `lock-word-handoff.spec.ts`'s `SyntheticApi` pattern); an unhandled
 * request aborts and fails the test at teardown — no live/proxy fallback.
 */

import type { Locator, Page, Route } from '@playwright/test'
import { expect, test as base } from '@playwright/test'

const DOCUMENT_ID = 42
const SIGNATURE_ID = 'sig-1'
const DESKTOP = { width: 1_280, height: 900 }
const NARROW = { width: 390, height: 844 }

// A real, minimal, valid single-page (US Letter, 612x792pt) PDF — pdf.js
// renders it as an ordinary page, not a stand-in/mock component.
const MINIMAL_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1NSA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDcyMCBUZCAoU2lnbmF0dXJlIFBsYWNlbWVudCBUZXN0KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDM0NiAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQxNgolJUVPRg=='

// A real, non-blank, decodable PNG (a short blue stroke) — the "actual ink".
const SIGNATURE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAYAAACtrX6oAAABzElEQVR4nO2awZXCMAwFwTWowC1tC3QP7InbhjiOLH2ZmQuPA4lGn2Al+PEAAAAAAAAAAAAAAAAAkMbs9/XpfRVM0KNlF/BuwtFrFUzU45l58hH53n9Sa6zukX4FfwuWdCU3deHsnzjP+jJcUgK+Kqoask3UFe0SHvAnwU/rlFrIduKh4hIa8F0xlZBtsA6FkMMCPhN6N+Ns2swO2QY9jt5fOdY2U/SVpijTD+rODLmprrvZ33zP+SHTZ3nAFZvi7ZHpszTgqk1Z4ZHlsyxghearHj8y5KYwaZ6RNVmbs8foZz19wqfo2aaoTdbdoZ6IkJvyenXl895XsS30iHRq1ZoSEbIFhRvh5BZwZFNWNsSCw13t5BJw9uNDr3os2WNFyE150rxzXO+/JHvQkOcd8tIpenVTFJquHnKruF6Nnsccdo1k3Z55hTwdsFJT7jTDhDxWhDwVsGJTZpphgh7eIbdqk+ZOm9IjQm4VJ83Z89vgZvRsD6//zV2naJWmrHwcWnHny7BMhfXq7k9wF/Q4chut9bljuDMhd2GPO7Rdw/XaNbJ9wDvLfwNDQ9Z/O/WrBN9P6q7iEUal+8dd7oMBAAAAAAAAAAAAAB7C/AE5fI2hnujawwAAAABJRU5ErkJggg=='

// Deliberately not a PNG — decodes as base64 fine, but the <img> itself must
// fail to load, proving the onError (not just fetch-rejection) path.
const INVALID_IMAGE_BASE64 = Buffer.from('not an image').toString('base64')

const COPY = {
  en: {
    previewLoading: 'Loading signature preview…',
    previewFailed: 'Could not load the signature preview. Retry before adjusting its position.',
    save: 'Save position',
    saved: 'Signature position saved.',
    reset: 'Reset position',
    cancel: 'Cancel',
    retry: 'Retry',
    unsavedTitle: 'Discard unsaved changes?',
    discard: 'Discard changes',
    left: 'Left (mm)',
    top: 'Top (mm)',
    signatureLabel: 'Signature — drag or use the arrow keys to move',
    identify: 'Identify signature',
  },
  ar: {
    previewLoading: 'جارٍ تحميل معاينة التوقيع…',
    previewFailed: 'تعذّر تحميل معاينة التوقيع. أعد المحاولة قبل ضبط موضعه.',
    save: 'حفظ الموضع',
    saved: 'تم حفظ موضع التوقيع.',
    reset: 'استعادة الموضع الأصلي',
    cancel: 'إلغاء',
    retry: 'إعادة المحاولة',
    unsavedTitle: 'تجاهل التغييرات غير المحفوظة؟',
    discard: 'تجاهل التغييرات',
    left: 'من اليسار (مم)',
    top: 'من الأعلى (مم)',
    signatureLabel: 'التوقيع — اسحب أو استخدم مفاتيح الأسهم للتحريك',
    identify: 'تحديد التوقيع',
  },
} as const

type Locale = keyof typeof COPY

// Expected numeric fields for the fixture's fixed initial position
// (page 1, x=0.3, y=0.4 on a 612x792pt page) — ptToMm(0.3*612) / ptToMm(0.4*792).
const INITIAL_LEFT_MM = '64.8'
const INITIAL_TOP_MM = '111.8'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

type ImageOutcome = 'ok' | 'error' | 'invalid' | { kind: 'deferred'; gate: Deferred<void> }

class SyntheticApi {
  readonly user = {
    id: 5,
    email: 'sig-fixture@example.invalid',
    employee_id: null,
    name_en: 'Fixture Approver',
    name_ar: 'معتمد الاختبار',
    position: 'Manager',
    department: 'Records',
    photo_url: null,
    role: 'operator' as const,
    status: 'active' as const,
    is_admin: false,
    is_manager: false,
    has_signature: true,
    idle_lock_seconds: 900,
    lock_layout: 'band' as const,
  }

  readonly unhandledRequests: string[] = []
  readonly positionPuts: Array<{ page: number; x: number; y: number }> = []
  imageOutcomes: ImageOutcome[] = []
  identifyMode = false

  private revision = 3
  private readonly defaultPosition = { page: 1, x: 0.3, y: 0.4 }
  private position = { ...this.defaultPosition }
  private history: Array<Record<string, unknown>> = []

  async install(page: Page): Promise<void> {
    await page.route('**/*', (route) => this.handleRoute(route))
  }

  private async fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
  }

  private async fulfillBase64(route: Route, base64: string): Promise<void> {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      headers: { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' },
      body: base64,
    })
  }

  private editorPayload(): Record<string, unknown> {
    return {
      document_id: DOCUMENT_ID,
      version_id: 1,
      signature_revision: this.revision,
      package_revision: 0,
      source_sha256: 'a'.repeat(64),
      can_adjust: !this.identifyMode,
      can_identify: this.identifyMode,
      unavailable_code: null,
      measured: true,
      pdf_url: null,
      pages: [{ page: 1, width_pt: 612, height_pt: 792 }],
      signatures: this.identifyMode
        ? []
        : [
            {
              id: SIGNATURE_ID,
              role: 'manager',
              page: this.position.page,
              x: this.position.x,
              y: this.position.y,
              width_pt: 90,
              height_pt: 40,
              default_page: this.defaultPosition.page,
              default_x: this.defaultPosition.x,
              default_y: this.defaultPosition.y,
              image_url: '',
            },
          ],
      candidates: this.identifyMode
        ? [{ candidate_id: 'cand-1', width_emu: 900_000, height_emu: 400_000, thumbnail_url: '' }]
        : null,
    }
  }

  // React StrictMode double-invokes effects on mount in dev, firing two
  // concurrent requests for the same logical fetch (the first is a phantom
  // that gets abandoned client-side, but the network request still lands
  // here). Coalesce concurrent in-flight requests onto one shifted outcome
  // so a queued scenario isn't silently consumed by the phantom — the queue
  // only advances once every concurrent request for the current outcome has
  // settled (a later Retry click is a genuinely new, non-concurrent request).
  private pendingImageOutcome: ImageOutcome | null = null
  private pendingImageCount = 0

  private async serveImage(route: Route): Promise<void> {
    if (this.pendingImageOutcome === null) {
      this.pendingImageOutcome = this.imageOutcomes.shift() ?? 'ok'
    }
    this.pendingImageCount += 1
    const outcome = this.pendingImageOutcome
    try {
      if (outcome === 'error') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL', message: 'boom', details: {} } }),
        })
        return
      }
      if (outcome === 'invalid') {
        await this.fulfillBase64(route, INVALID_IMAGE_BASE64)
        return
      }
      if (typeof outcome === 'object') await outcome.gate.promise
      await this.fulfillBase64(route, SIGNATURE_PNG_BASE64)
    } finally {
      this.pendingImageCount -= 1
      if (this.pendingImageCount === 0) this.pendingImageOutcome = null
    }
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
      await this.fulfillJson(route, this.user)
      return
    }
    if (method === 'GET' && path === '/auth/me/capabilities') {
      await this.fulfillJson(route, ['documents.generate', 'books.view'])
      return
    }
    if (method === 'GET' && path === '/auth/capabilities') {
      await this.fulfillJson(route, [])
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
    if (method === 'GET' && path === '/documents/activity/me') {
      await this.fulfillJson(route, { documents_today: 0, documents_week: 0 })
      return
    }
    if (method === 'GET' && path === '/books/approval-summary') {
      await this.fulfillJson(route, {
        can_view_sent: false,
        available_received_kinds: [],
        signature: { count: 0, oldest: null },
        review: { count: 0, oldest: null },
      })
      return
    }
    if (method === 'GET' && path === '/inmate-violations/statistics/awaiting-close') {
      await this.fulfillJson(route, { months: [] })
      return
    }
    if (method === 'GET' && path === '/email/account') {
      await this.fulfillJson(route, null)
      return
    }
    if (method === 'GET' && path === '/notifications/counts') {
      await this.fulfillJson(route, { approvals: 0, leaves: 0, scans: 0, emails: 0 })
      return
    }
    if (method === 'GET' && path === '/notifications/stream') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: 'event: counts\ndata: {"approvals":0,"leaves":0,"scans":0,"emails":0}\n\n',
      })
      return
    }

    if (method === 'GET' && path === `/documents/${DOCUMENT_ID}/download`) {
      await this.fulfillBase64(route, MINIMAL_PDF_BASE64)
      return
    }
    if (method === 'GET' && path === `/documents/${DOCUMENT_ID}/signature-editor`) {
      await this.fulfillJson(route, this.editorPayload())
      return
    }
    if (method === 'GET' && path === `/documents/${DOCUMENT_ID}/signature-history`) {
      await this.fulfillJson(route, { items: this.history })
      return
    }
    if (method === 'GET' && path === `/documents/${DOCUMENT_ID}/signature-editor/background`) {
      await this.fulfillBase64(route, MINIMAL_PDF_BASE64)
      return
    }
    if (method === 'GET' && path === `/documents/${DOCUMENT_ID}/signature-editor/images/${SIGNATURE_ID}`) {
      await this.serveImage(route)
      return
    }
    if (
      method === 'GET' &&
      path === `/documents/${DOCUMENT_ID}/signature-editor/candidates/cand-1/image`
    ) {
      await this.fulfillBase64(route, SIGNATURE_PNG_BASE64)
      return
    }
    if (method === 'PUT' && path === `/documents/${DOCUMENT_ID}/signatures/${SIGNATURE_ID}/position`) {
      const body = request.postDataJSON() as { page: number; x: number; y: number }
      this.positionPuts.push({ page: body.page, x: body.x, y: body.y })
      this.revision += 1
      this.position = { page: body.page, x: body.x, y: body.y }
      this.history.push({
        revision: this.revision,
        action: 'move',
        signature_id: SIGNATURE_ID,
        before_geometry: { page: 1, x: 0.3, y: 0.4 },
        after_geometry: this.position,
        actor_user_id: this.user.id,
        created_at: '2026-09-21T08:00:00.000Z',
        pdf_download_url: null,
        docx_download_url: null,
      })
      await this.fulfillJson(route, this.editorPayload())
      return
    }

    this.unhandledRequests.push(`${method} ${path}`)
    await route.abort('failed')
  }
}

const test = base.extend<{ backend: SyntheticApi }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright binds positionally
  backend: async ({ page }, runTest) => {
    const backend = new SyntheticApi()
    await backend.install(page)
    await runTest(backend)
    expect(
      backend.unhandledRequests,
      'every API request must be explicitly synthetic; live/proxy fallback is forbidden',
    ).toEqual([])
  },
})

test.use({ serviceWorkers: 'block' })
test.describe.configure({ timeout: 45_000 })

async function prepareApp(
  page: Page,
  locale: Locale,
  viewport: { width: number; height: number } = DESKTOP,
): Promise<void> {
  await page.setViewportSize(viewport)
  await page.addInitScript((language: string) => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.localStorage.setItem('gssg.lang', language)
  }, locale)
  await page.goto(`/documents/${DOCUMENT_ID}/signature-placement`)
  await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${locale}`))
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
}

function draggableOverlay(page: Page, locale: Locale): Locator {
  return page.getByRole('img', { name: COPY[locale].signatureLabel })
}

const VIEWPORTS = [
  { name: 'desktop', size: DESKTOP },
  { name: 'narrow', size: NARROW },
] as const

for (const viewport of VIEWPORTS) {
  for (const locale of ['en', 'ar'] as const) {
    test(`${viewport.name}/${locale}: preview gates interaction until real ink loads, then edits without a premature PUT`, async ({
      page,
      backend,
    }, testInfo) => {
      const copy = COPY[locale]
      const release = deferred<void>()
      backend.imageOutcomes = [{ kind: 'deferred', gate: release }]
      await prepareApp(page, locale, viewport.size)

      // Loading: visible status; editing/Save/Reset disabled; overlay not
      // yet focusable (unready) — never a silently invisible draggable area.
      await expect(page.getByText(copy.previewLoading)).toBeVisible()
      const saveButton = page.getByRole('button', { name: copy.save })
      await expect(saveButton).toBeDisabled()
      await expect(page.getByRole('button', { name: copy.reset })).toBeDisabled()
      const leftInput = page.getByLabel(copy.left)
      await expect(leftInput).toBeDisabled()
      await expect(leftInput).toHaveValue(INITIAL_LEFT_MM) // draft is set even while unready
      const overlay = draggableOverlay(page, locale)
      await expect(overlay).toHaveAttribute('tabindex', '-1')

      // Release: the actual ink appears at the measured position before Save.
      release.resolve()
      await expect(page.getByText(copy.previewLoading)).toBeHidden()
      await expect(overlay.locator('img')).toBeVisible()
      await expect(overlay).toHaveAttribute('tabindex', '0')
      expect(backend.positionPuts).toEqual([])
      await testInfo.attach(`ready-${viewport.name}-${locale}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      })

      // A permanent selection outline is visible once ready (box-shadow ring
      // — never padding/border that would change the measured rect).
      const boxShadow = await overlay.evaluate((el) => getComputedStyle(el).boxShadow)
      expect(boxShadow).not.toBe('none')

      // Drag moves the draft locally; no PUT until Save.
      await overlay.scrollIntoViewIfNeeded()
      const box = await overlay.boundingBox()
      if (!box) throw new Error('overlay has no bounding box')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 15, { steps: 5 })
      await page.mouse.up()
      expect(backend.positionPuts).toEqual([])
      await expect(leftInput).not.toHaveValue(INITIAL_LEFT_MM)

      // Keyboard nudge (Shift = 10pt, ~3.5mm — safely distinguishable after
      // rounding) also updates the draft locally, no PUT.
      const afterDrag = await leftInput.inputValue()
      await overlay.focus()
      await page.keyboard.press('Shift+ArrowRight')
      expect(backend.positionPuts).toEqual([])
      await expect(leftInput).not.toHaveValue(afterDrag)

      // Numeric field change updates the draft too, still no PUT.
      const topInput = page.getByLabel(copy.top)
      await topInput.fill('50')
      await expect(leftInput).toBeEnabled() // still enabled; unready never returns mid-session
      expect(backend.positionPuts).toEqual([])

      // Save sends exactly the displayed (moved) draft — not the original.
      await expect(saveButton).toBeEnabled()
      await saveButton.click()
      await expect(page.getByText(copy.saved)).toBeVisible()
      expect(backend.positionPuts.length).toBe(1)
      expect(backend.positionPuts[0]).not.toEqual({ page: 1, x: 0.3, y: 0.4 })

      // The PDF canvas column stays physically LTR regardless of UI language
      // (approval-signature-placement plan §9.9) — RTL changes only chrome.
      const direction = await page
        .locator('div[style*="direction"]')
        .first()
        .evaluate((el) => getComputedStyle(el).direction)
      expect(direction).toBe('ltr')
    })
  }
}

test('a failed image fetch shows a retryable error with Save disabled; Retry restores the image and keeps the draft', async ({
  page,
  backend,
}) => {
  const copy = COPY.en
  backend.imageOutcomes = ['error', 'ok']
  await prepareApp(page, 'en', DESKTOP)

  await expect(page.getByText(copy.previewFailed)).toBeVisible()
  await expect(page.getByRole('button', { name: copy.save })).toBeDisabled()
  const leftInput = page.getByLabel(copy.left)
  await expect(leftInput).toBeDisabled()
  await expect(leftInput).toHaveValue(INITIAL_LEFT_MM) // draft preserved through the failure

  await page.getByRole('button', { name: copy.retry }).click()
  await expect(page.getByText(copy.previewFailed)).toBeHidden()
  await expect(draggableOverlay(page, 'en').locator('img')).toBeVisible()
  await expect(leftInput).toHaveValue(INITIAL_LEFT_MM) // unchanged by the retry
  await expect(leftInput).toBeEnabled()
  expect(backend.positionPuts).toEqual([])
})

test('invalid image bytes (decodable base64, not a real image) also surface a retryable error', async ({
  page,
  backend,
}) => {
  const copy = COPY.en
  backend.imageOutcomes = ['invalid', 'ok']
  await prepareApp(page, 'en', DESKTOP)

  await expect(page.getByText(copy.previewFailed)).toBeVisible()
  await expect(page.getByRole('button', { name: copy.save })).toBeDisabled()

  await page.getByRole('button', { name: copy.retry }).click()
  await expect(page.getByText(copy.previewFailed)).toBeHidden()
  await expect(draggableOverlay(page, 'en').locator('img')).toBeVisible()
})

test('cancelling a dirty draft discards it without saving', async ({ page, backend }) => {
  const copy = COPY.en
  await prepareApp(page, 'en', DESKTOP)
  const overlay = draggableOverlay(page, 'en')
  await expect(overlay.locator('img')).toBeVisible()

  await overlay.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.getByLabel(copy.left)).not.toHaveValue(INITIAL_LEFT_MM)

  await page.getByRole('button', { name: copy.cancel }).click()
  const dialog = page.getByRole('dialog', { name: copy.unsavedTitle })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: copy.discard }).click()
  await expect(dialog).toBeHidden()
  expect(backend.positionPuts).toEqual([]) // discarded, never sent
})

test('legacy candidate thumbnails decode and display through the repaired shared transport', async ({
  page,
  backend,
}) => {
  backend.identifyMode = true
  await prepareApp(page, 'en', DESKTOP)
  await expect(page.getByRole('heading', { name: COPY.en.identify })).toBeVisible()
  // CandidateThumb fetches via the same base64 transport as the tracked
  // signature image — a real decoded <img>, not a loading spinner left behind.
  const thumb = page.locator('button', { hasText: /×/ }).locator('img')
  await expect(thumb).toBeVisible()
})
