import type { Locator, Page, Route, TestInfo } from '@playwright/test'
import { expect, test as base } from '@playwright/test'

const FIXED_NOW = new Date('2026-09-12T08:00:00.000Z')
const IDLE_ADVANCE_MS = 35_000
const POLL_ADVANCE_MS = 5_100
const FIXTURE_PASSWORD = 'fixture-lock-pass'
const CLASSIFICATION_CODE = '15/1'
const DESKTOP = { width: 1_280, height: 900 }
const WIDE_DESKTOP = { width: 1_440, height: 900 }
const NARROW = { width: 390, height: 844 }

// Required-field labels append a literal "*" (no space) to the accessible
// name via <span>*</span> inside the same <Label> — see TextField.tsx /
// ClassificationField.tsx. Both Classification and Subject are required in
// the real General Book schema, so their accessible names carry it too.
const COPY = {
  en: {
    classification: 'Classification*',
    create: 'Create & open in Word',
    discard: 'Discard',
    finish: 'Finish editing',
    finishedPrefix: 'Book saved',
    lock: 'App locked',
    manageTemplates: 'Manage templates',
    noSave: 'No save from Word yet',
    reserved: 'Book created — number reserved',
    saved: /Saved from Word/,
    subject: 'Subject*',
    unlock: 'Unlock',
  },
  ar: {
    classification: 'التبويب*',
    create: 'إنشاء وفتح في Word',
    discard: 'تجاهل',
    finish: 'إنهاء التحرير',
    finishedPrefix: 'تم حفظ الكتاب',
    lock: 'التطبيق مقفل',
    manageTemplates: 'إدارة القوالب',
    noSave: 'لم يصل أي حفظ من Word بعد',
    reserved: 'تم إنشاء الكتاب وحجز الرقم',
    saved: /تم الحفظ من Word/,
    subject: 'الموضوع*',
    unlock: 'إلغاء القفل',
  },
} as const

type Locale = keyof typeof COPY
type LockLayout = 'band' | 'stack' | 'console'
type VerifyOutcome =
  | 'success'
  | 'wrong-password'
  | 'network-error'
  | 'server-error'
  | { kind: 'deferred-success'; gate: Deferred<void> }

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

interface SyntheticBook {
  id: number
  ref_number: string
  category_id: string
  category: {
    id: string
    name_en: string
    name_ar: string
    prefix: string
    requires_approval: boolean
  }
  employee_id: null
  employee_name_snapshot: null
  subject: string
  direction: 'outgoing'
  stamp_style: 'Header Text (Ref: XX-0000)'
  doc_id: null
  created_at: string
  deleted_at: null
  priority: 'Normal'
  approval_state: 'none'
  classification_code: string
  voided_at: string | null
  is_draft: boolean
  edit_session: {
    user_id: number
    user_name: string
    state: 'active'
    last_put_at: string | null
    created_at: string
  } | null
  signing_path: 'in_app'
  submitted_by_user_id: number
  submitted_by_name: string
  submitted_by_g: string
  doc_manager_user_id: null
  doc_manager_name: null
  doc_manager_has_signature: false
  is_word_book: true
  approval_steps: []
  attachment_paths: []
  versions: Array<{
    id: number
    version_no: number
    trigger: string
    status: string
    template_id: 'General Book'
    document_id: number
    has_fields: false
    created_at: string
    created_by_name: string
    docx_url: null
    pdf_url: null
    manager_sig_embedded: false
    signed_pdf_url: null
    signed_source: null
    approval_steps: []
  }>
  original_creator_user_id: number
  included_papers_revision: 0
  included_papers_fixed_page_count: 0
  included_papers_total_page_count: 0
  included_papers: []
  included_papers_history: []
  sms: []
  search_snippet: null
  current_template_id: 'General Book'
  service_id: 'General Book'
}

interface SyntheticSession {
  book_id: number
  ref_number: string
  token: string
  filename: string
  word_url: string
  dav_url: string
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class SyntheticApi {
  readonly user = {
    id: 77,
    email: 'lock.fixture@example.invalid',
    employee_id: 'G-LOCK-77',
    name_en: 'Fixture Operator',
    name_ar: 'مشغل الاختبار',
    position: 'Document Controller',
    department: 'Records',
    photo_url: null,
    role: 'operator' as const,
    status: 'active' as const,
    is_admin: false,
    is_manager: false,
    has_signature: false,
    idle_lock_seconds: 30,
    lock_layout: 'band' as LockLayout,
  }

  readonly unhandledRequests: string[] = []
  readonly createdBookIds: number[] = []
  readonly createdSubjects: string[] = []
  readonly finishedBookIds: number[] = []
  readonly discardedBookIds: number[] = []
  readonly reopenedBookIds: number[] = []
  verifyRequests = 0
  getBookRequests = 0

  private readonly books = new Map<number, SyntheticBook>()
  private nextBookId = 101
  private createGate: Deferred<void> | null = null
  private finishGate: Deferred<void> | null = null
  private reopenGate: Deferred<void> | null = null
  private readonly verifyOutcomes: VerifyOutcome[] = []

  readonly existingFinishedBookId = 901

  constructor() {
    const existing = this.makeBook(
      this.existingFinishedBookId,
      '15/1/GSSG/0901',
      'Existing records handoff',
    )
    this.finishBook(existing)
    this.books.set(existing.id, existing)
  }

  async install(page: Page): Promise<void> {
    await page.route('**/*', async (route) => this.handleRoute(route))
  }

  setLayout(layout: LockLayout): void {
    this.user.lock_layout = layout
  }

  queueVerification(...outcomes: VerifyOutcome[]): void {
    this.verifyOutcomes.push(...outcomes)
  }

  deferNextVerification(): () => void {
    const gate = deferred<void>()
    this.verifyOutcomes.push({ kind: 'deferred-success', gate })
    return () => gate.resolve()
  }

  deferNextCreate(): () => void {
    const gate = deferred<void>()
    this.createGate = gate
    return () => gate.resolve()
  }

  deferNextFinish(): () => void {
    const gate = deferred<void>()
    this.finishGate = gate
    return () => gate.resolve()
  }

  deferNextReopen(): () => void {
    const gate = deferred<void>()
    this.reopenGate = gate
    return () => gate.resolve()
  }

  latestCreatedBook(): SyntheticBook {
    const id = this.createdBookIds.at(-1)
    if (id === undefined) throw new Error('No synthetic Word handoff has been created')
    const book = this.books.get(id)
    if (!book) throw new Error(`Synthetic book ${id} is missing`)
    return book
  }

  existingFinishedBook(): SyntheticBook {
    const book = this.books.get(this.existingFinishedBookId)
    if (!book) throw new Error('Synthetic Records fixture is missing')
    return book
  }

  markSaved(bookId: number): void {
    const book = this.requiredBook(bookId)
    if (!book.edit_session) throw new Error(`Synthetic book ${bookId} has no active Word session`)
    book.edit_session.last_put_at = '2026-09-12T08:35:00.000Z'
  }

  isFinished(bookId: number): boolean {
    return this.requiredBook(bookId).edit_session === null
  }

  private makeBook(id: number, ref: string, subject: string): SyntheticBook {
    return {
      id,
      ref_number: ref,
      category_id: 'GS',
      category: {
        id: 'GS',
        name_en: 'General correspondence',
        name_ar: 'المراسلات العامة',
        prefix: 'GS',
        requires_approval: false,
      },
      employee_id: null,
      employee_name_snapshot: null,
      subject,
      direction: 'outgoing',
      stamp_style: 'Header Text (Ref: XX-0000)',
      doc_id: null,
      created_at: '2026-09-12T08:00:00.000Z',
      deleted_at: null,
      priority: 'Normal',
      approval_state: 'none',
      classification_code: CLASSIFICATION_CODE,
      voided_at: null,
      is_draft: true,
      edit_session: {
        user_id: this.user.id,
        user_name: this.user.name_en,
        state: 'active',
        last_put_at: null,
        created_at: '2026-09-12T08:00:00.000Z',
      },
      signing_path: 'in_app',
      submitted_by_user_id: this.user.id,
      submitted_by_name: this.user.name_en,
      submitted_by_g: this.user.employee_id,
      doc_manager_user_id: null,
      doc_manager_name: null,
      doc_manager_has_signature: false,
      is_word_book: true,
      approval_steps: [],
      attachment_paths: [],
      versions: [],
      original_creator_user_id: this.user.id,
      included_papers_revision: 0,
      included_papers_fixed_page_count: 0,
      included_papers_total_page_count: 0,
      included_papers: [],
      included_papers_history: [],
      sms: [],
      search_snippet: null,
      current_template_id: 'General Book',
      service_id: 'General Book',
    }
  }

  private finishBook(book: SyntheticBook): void {
    book.is_draft = false
    book.edit_session = null
    book.versions.push({
      id: book.id * 10,
      version_no: book.versions.length + 1,
      trigger: 'word_finish',
      status: 'ready',
      template_id: 'General Book',
      document_id: book.id * 100,
      has_fields: false,
      created_at: '2026-09-12T08:40:00.000Z',
      created_by_name: this.user.name_en,
      docx_url: null,
      pdf_url: null,
      manager_sig_embedded: false,
      signed_pdf_url: null,
      signed_source: null,
      approval_steps: [],
    })
  }

  private requiredBook(bookId: number): SyntheticBook {
    const book = this.books.get(bookId)
    if (!book) throw new Error(`Unknown synthetic book ${bookId}`)
    return book
  }

  private sessionFor(book: SyntheticBook, sequence: number): SyntheticSession {
    return {
      book_id: book.id,
      ref_number: book.ref_number,
      token: `synthetic-session-${sequence}-${book.id}`,
      filename: `synthetic-${book.id}.docx`,
      word_url: `ms-word:ofe|u|http://lock-handoff-test.invalid/dav/${book.id}`,
      dav_url: `http://lock-handoff-test.invalid/dav/${book.id}`,
    }
  }

  private async fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(value),
    })
  }

  private async handleRoute(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())

    if (url.hostname === 'api.bigdatacloud.net') {
      await this.fulfillJson(route, {
        latitude: 24.4539,
        longitude: 54.3773,
        city: 'Abu Dhabi',
        locality: 'Abu Dhabi',
      })
      return
    }
    if (url.hostname === 'api.open-meteo.com') {
      await this.fulfillJson(route, {
        current: {
          temperature_2m: 32,
          relative_humidity_2m: 44,
          weather_code: 0,
          is_day: 1,
        },
        daily: { temperature_2m_max: [36], temperature_2m_min: [27] },
      })
      return
    }
    if (url.hostname === 'lock-handoff-test.invalid') {
      this.unhandledRequests.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('failed')
      return
    }

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
      // General Book is a quick-action-gated template: the gallery filter
      // requires documents.generate + books.view + the per-service
      // books.service.<id> capability (see isQuickActionAllowed in
      // src/lib/dashboardLayout.ts), not just the first two.
      await this.fulfillJson(route, [
        'documents.generate',
        'books.view',
        'books.service.General Book',
      ])
      return
    }
    // RequireCapability wraps every authenticated route and fetches the full
    // (admin-oriented) catalog to drive its denied/request-access fallback,
    // regardless of whether the current route is authorized — the fixture
    // user always is, so an empty catalog is a valid, unused response.
    if (method === 'GET' && path === '/auth/capabilities') {
      await this.fulfillJson(route, [])
      return
    }
    if (method === 'POST' && path === '/auth/verify-password') {
      this.verifyRequests += 1
      const outcome = this.verifyOutcomes.shift() ?? 'success'
      if (outcome === 'wrong-password') {
        await this.fulfillJson(
          route,
          { error: { code: 'INVALID_PASSWORD', message: 'Password is incorrect', details: {} } },
          401,
        )
        return
      }
      if (outcome === 'network-error') {
        await route.abort('failed')
        return
      }
      if (outcome === 'server-error') {
        await this.fulfillJson(
          route,
          { error: { code: 'VERIFY_UNAVAILABLE', message: 'Verification unavailable', details: {} } },
          503,
        )
        return
      }
      if (typeof outcome === 'object') await outcome.gate.promise
      await route.fulfill({ status: 204, body: '' })
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
    if (method === 'GET' && path === '/templates') {
      await this.fulfillJson(route, {
        items: [
          {
            id: 'General Book',
            name_en: 'General Book',
            name_ar: 'الكتاب العام',
            form_number: 'GS',
            category: 'admin',
            signing_path: 'in_app',
            has_code: false,
            feature_minted: false,
            notifies_employee: false,
          },
        ],
      })
      return
    }
    if (method === 'GET' && path === '/templates/General Book/fields') {
      await this.fulfillJson(route, {
        meta: {
          id: 'General Book',
          name_en: 'General Book',
          name_ar: 'الكتاب العام',
          form_number: 'GS',
          category: 'admin',
          signing_path: 'in_app',
          has_code: false,
          feature_minted: false,
          notifies_employee: false,
        },
        signing_path: 'in_app',
        attachment_slots: [],
        fields: [
          {
            key: 'subject',
            type: 'text',
            label_en: 'Subject',
            label_ar: 'الموضوع',
            required: true,
          },
          {
            key: 'body',
            type: 'arabic_rich_full',
            label_en: 'Body',
            label_ar: 'المتن',
            required: false,
          },
        ],
      })
      return
    }
    if (method === 'GET' && path === '/books/word-templates') {
      await this.fulfillJson(route, [])
      return
    }
    if (method === 'GET' && path === '/books/classifications') {
      await this.fulfillJson(route, {
        items: [
          {
            code: CLASSIFICATION_CODE,
            name_ar: 'المراسلات العامة',
            name_en: 'General correspondence',
            unit_ar: 'إدارة السجلات',
            unit_en: 'Records',
          },
        ],
      })
      return
    }
    if (method === 'POST' && path === '/books/word-sessions') {
      const body = request.postDataJSON() as { subject?: unknown }
      this.createdSubjects.push(typeof body.subject === 'string' ? body.subject : '')
      const requestNumber = this.createdSubjects.length
      const gate = this.createGate
      this.createGate = null
      if (gate) await gate.promise

      const id = this.nextBookId
      this.nextBookId += 1
      const ref = `${CLASSIFICATION_CODE}/GSSG/${String(id).padStart(4, '0')}`
      const book = this.makeBook(id, ref, this.createdSubjects.at(-1) ?? '')
      this.books.set(id, book)
      this.createdBookIds.push(id)
      await this.fulfillJson(route, this.sessionFor(book, requestNumber))
      return
    }
    if (method === 'GET' && path === '/books/facets') {
      const records = [...this.books.values()].filter((book) => book.voided_at === null)
      await this.fulfillJson(route, {
        total: records.length,
        states: { none: records.length },
        services: [
          { id: 'General Book', count: records.length, states: { none: records.length } },
        ],
      })
      return
    }
    if (method === 'GET' && path === '/book-categories') {
      await this.fulfillJson(route, [
        {
          id: 'GS',
          name_en: 'General correspondence',
          name_ar: 'المراسلات العامة',
          prefix: 'GS',
          requires_approval: false,
        },
      ])
      return
    }
    if (method === 'GET' && path === '/books') {
      const records = [...this.books.values()].filter((book) => book.voided_at === null)
      await this.fulfillJson(route, {
        items: records,
        total: records.length,
        limit: Number(url.searchParams.get('limit') ?? 500),
        offset: 0,
      })
      return
    }

    const previewMatch = path.match(/^\/books\/(\d+)\/word-sessions\/preview$/)
    if (method === 'GET' && previewMatch) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Synthetic preview omitted' })
      return
    }

    // Records-page preview for an already-finished document (distinct from
    // the Word-session live-preview endpoint above); reached when opening an
    // existing finished record directly, e.g. `/books?open=<id>`.
    const downloadMatch = path.match(/^\/documents\/(\d+)\/download$/)
    if (method === 'GET' && downloadMatch) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Synthetic document omitted' })
      return
    }

    const finishMatch = path.match(/^\/books\/(\d+)\/word-sessions\/finish$/)
    if (method === 'POST' && finishMatch) {
      const bookId = Number(finishMatch[1])
      this.finishedBookIds.push(bookId)
      const gate = this.finishGate
      this.finishGate = null
      if (gate) await gate.promise
      const book = this.requiredBook(bookId)
      this.finishBook(book)
      await this.fulfillJson(route, book)
      return
    }

    const wordSessionMatch = path.match(/^\/books\/(\d+)\/word-sessions$/)
    if (wordSessionMatch && method === 'DELETE') {
      const bookId = Number(wordSessionMatch[1])
      this.discardedBookIds.push(bookId)
      const book = this.requiredBook(bookId)
      book.voided_at = '2026-09-12T08:45:00.000Z'
      book.is_draft = false
      book.edit_session = null
      await this.fulfillJson(route, book)
      return
    }
    if (wordSessionMatch && method === 'POST') {
      const bookId = Number(wordSessionMatch[1])
      this.reopenedBookIds.push(bookId)
      const gate = this.reopenGate
      this.reopenGate = null
      if (gate) await gate.promise
      const book = this.requiredBook(bookId)
      book.edit_session = {
        user_id: this.user.id,
        user_name: this.user.name_en,
        state: 'active',
        last_put_at: null,
        created_at: '2026-09-12T08:50:00.000Z',
      }
      await this.fulfillJson(route, this.sessionFor(book, 900 + this.reopenedBookIds.length))
      return
    }

    const bookMatch = path.match(/^\/books\/(\d+)$/)
    if (method === 'GET' && bookMatch) {
      this.getBookRequests += 1
      await this.fulfillJson(route, this.requiredBook(Number(bookMatch[1])))
      return
    }

    this.unhandledRequests.push(`${method} ${url.pathname}${url.search}`)
    await route.abort('failed')
  }
}

const test = base.extend<{ backend: SyntheticApi }>({
  // Playwright's fixture teardown parameter is conventionally named `use`,
  // which collides with react-hooks' `/^use[A-Z]?/` Hook-name heuristic and
  // is flagged as a rule violation even though this isn't a component or a
  // React hook. Renamed to sidestep the false positive; Playwright binds the
  // fixture callback's second parameter positionally, not by name.
  backend: async ({ page }, runTest) => {
    const backend = new SyntheticApi()
    await backend.install(page)
    await runTest(backend)
    expect(
      backend.unhandledRequests,
      'Every API request must be explicitly synthetic; live/proxy fallback is forbidden',
    ).toEqual([])
  },
})

async function prepareApp(
  page: Page,
  backend: SyntheticApi,
  options: {
    locale?: Locale
    layout?: LockLayout
    path?: string
    viewport?: { width: number; height: number }
  } = {},
): Promise<Locale> {
  const locale = options.locale ?? 'en'
  backend.setLayout(options.layout ?? 'band')
  await page.setViewportSize(options.viewport ?? DESKTOP)
  await page.clock.install({ time: FIXED_NOW })
  await page.addInitScript((language: Locale) => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.localStorage.setItem('gssg.lang', language)
  }, locale)
  await page.goto(options.path ?? '/application?form=general_book')
  await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${locale}`))
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
  await expect(page.locator('#main-content')).toBeVisible()
  return locale
}

async function fillGeneralBook(page: Page, locale: Locale, subject: string): Promise<void> {
  const copy = COPY[locale]
  const subjectInput = page.getByRole('textbox', { name: copy.subject, exact: true })
  await expect(subjectInput).toBeVisible()
  await subjectInput.fill(subject)
  await page.getByRole('combobox', { name: copy.classification, exact: true }).click()
  await page.getByRole('option', { name: new RegExp(`^${CLASSIFICATION_CODE.replace('/', '\\/')}`) }).click()
}

async function createHandoff(
  page: Page,
  backend: SyntheticApi,
  locale: Locale,
  subject: string,
): Promise<SyntheticBook> {
  await fillGeneralBook(page, locale, subject)
  await page.getByRole('button', { name: COPY[locale].create, exact: true }).click()
  await expect.poll(() => backend.createdBookIds.length).toBeGreaterThan(0)
  const book = backend.latestCreatedBook()
  await expectHandoff(page, locale, book.ref_number)
  return book
}

function lockDialog(page: Page, locale: Locale): Locator {
  return page.getByRole('dialog', { name: COPY[locale].lock, exact: true })
}

function handoffDialog(page: Page, locale: Locale): Locator {
  return page.getByRole('dialog', { name: COPY[locale].reserved, exact: true })
}

async function expectHandoff(page: Page, locale: Locale, ref: string): Promise<Locator> {
  const dialog = handoffDialog(page, locale)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(ref, { exact: true })).toBeVisible()
  return dialog
}

async function idleLock(page: Page, locale: Locale, layout: LockLayout): Promise<Locator> {
  await page.clock.fastForward(IDLE_ADVANCE_MS)
  const lock = lockDialog(page, locale)
  await expect(lock).toBeVisible()
  await expect(lock).toHaveAttribute('data-layout', layout)
  await expect(page.locator('#lock-pwd')).toBeFocused()
  return lock
}

async function typePassword(page: Page, password = FIXTURE_PASSWORD): Promise<Locator> {
  const input = page.locator('#lock-pwd')
  await expect(input).toBeVisible()
  await expect(input).toBeEnabled()
  await input.click()
  await expect(input).toBeFocused()
  await page.keyboard.type(password)
  await expect(input).toHaveValue(password)
  return input
}

async function replacePassword(page: Page, password: string): Promise<void> {
  const input = page.locator('#lock-pwd')
  await input.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(password)
  await expect(input).toHaveValue(password)
}

async function unlockWithKeyboard(page: Page, locale: Locale): Promise<void> {
  await typePassword(page)
  await page.keyboard.press('Enter')
  await expect(lockDialog(page, locale)).toBeHidden()
}

async function attachPasswordSafeScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const input = page.locator('#lock-pwd')
  if ((await input.count()) > 0) await expect(input).toHaveValue('')
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
}

async function expectClickBlocked(locator: Locator): Promise<void> {
  let blocked = false
  try {
    await locator.click({ timeout: 400 })
  } catch {
    blocked = true
  }
  expect(blocked, 'the active privacy lock must intercept a real background click').toBe(true)
}

async function expectFocusInside(page: Page, selector: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((rootSelector) => {
        const active = document.activeElement
        return active instanceof HTMLElement && active.closest(rootSelector) !== null
      }, selector),
    )
    .toBe(true)
}

async function expectLockUsable(page: Page): Promise<void> {
  const result = await page.locator('.lock-overlay').evaluate((element) => {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const controls = [
      element.querySelector<HTMLInputElement>('#lock-pwd'),
      element.querySelector<HTMLButtonElement>('.lock-submit'),
      element.querySelector<HTMLButtonElement>('.lock-signout'),
    ]
    return {
      horizontalOverflow: element.scrollWidth - element.clientWidth,
      controls: controls.map((control) => {
        const rect = control?.getBoundingClientRect()
        return rect
          ? {
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              viewportHeight,
              viewportWidth,
            }
          : null
      }),
    }
  })
  expect(result.horizontalOverflow).toBeLessThanOrEqual(1)
  for (const control of result.controls) {
    expect(control).not.toBeNull()
    expect(control!.left).toBeGreaterThanOrEqual(0)
    expect(control!.right).toBeLessThanOrEqual(control!.viewportWidth)
    expect(control!.top).toBeGreaterThanOrEqual(0)
    expect(control!.bottom).toBeLessThanOrEqual(control!.viewportHeight)
  }
}

async function setHeapMarker(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as typeof window & { __lockWordHandoffMarker?: string }).__lockWordHandoffMarker =
      'retained'
  })
}

async function expectHeapMarker(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __lockWordHandoffMarker?: string })
            .__lockWordHandoffMarker,
      ),
    )
    .toBe('retained')
}

test('main reported path: password input works above an existing Word handoff and retains it through Finish', async ({
  page,
  backend,
}, testInfo) => {
  const locale = await prepareApp(page, backend, { locale: 'en', layout: 'band' })
  const book = await createHandoff(page, backend, locale, 'Main retained handoff')
  const waiting = handoffDialog(page, locale)
  await expect(waiting.getByRole('button', { name: COPY.en.finish, exact: true })).toBeDisabled()
  await setHeapMarker(page)

  await idleLock(page, locale, 'band')
  await expectLockUsable(page)
  await attachPasswordSafeScreenshot(page, testInfo, 'locked-en-band')

  const hiddenDiscard = page.locator('button').filter({ hasText: COPY.en.discard }).first()
  await expectClickBlocked(hiddenDiscard)
  expect(backend.discardedBookIds).toEqual([])

  await unlockWithKeyboard(page, locale)
  await expectHandoff(page, locale, book.ref_number)
  await expect(page).toHaveURL(/\/application(?:\?|$)/)
  await expectHeapMarker(page)
  await expect(waiting.getByText(COPY.en.noSave, { exact: true })).toBeVisible()
  await expect(waiting.getByRole('button', { name: COPY.en.finish, exact: true })).toBeDisabled()

  backend.markSaved(book.id)
  await page.clock.fastForward(POLL_ADVANCE_MS)
  await expect(waiting.getByText(COPY.en.saved)).toBeVisible()
  const finish = waiting.getByRole('button', { name: COPY.en.finish, exact: true })
  await expect(finish).toBeEnabled()
  await finish.click()

  const finished = page.getByRole('dialog', {
    name: new RegExp(`^${COPY.en.finishedPrefix}.*${book.ref_number.replaceAll('/', '\\/')}`),
  })
  await expect(finished).toBeVisible()
  await expectHeapMarker(page)
  expect(backend.createdBookIds).toEqual([book.id])
  expect(backend.finishedBookIds).toEqual([book.id])
  expect(backend.discardedBookIds).toEqual([])
  await attachPasswordSafeScreenshot(page, testInfo, 'unlocked-en-finished-handoff')
})

test('save while locked and repeated console-layout cycles keep one session and one Finish', async ({
  page,
  backend,
}) => {
  const locale = await prepareApp(page, backend, {
    locale: 'en',
    layout: 'console',
    viewport: WIDE_DESKTOP,
  })
  const book = await createHandoff(page, backend, locale, 'Save while locked')
  const firstPollCount = backend.getBookRequests

  await idleLock(page, locale, 'console')
  await expectLockUsable(page)
  backend.markSaved(book.id)
  await page.clock.fastForward(POLL_ADVANCE_MS)
  await expect.poll(() => backend.getBookRequests).toBeGreaterThan(firstPollCount)
  await unlockWithKeyboard(page, locale)

  const handoff = await expectHandoff(page, locale, book.ref_number)
  await expect(handoff.getByText(COPY.en.saved)).toBeVisible()
  await idleLock(page, locale, 'console')
  await unlockWithKeyboard(page, locale)
  await page.clock.fastForward(1_000)
  await expect(lockDialog(page, locale)).toBeHidden()
  await expectHandoff(page, locale, book.ref_number)

  await handoff.getByRole('button', { name: COPY.en.finish, exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: new RegExp(`^${COPY.en.finishedPrefix}`) }),
  ).toBeVisible()
  expect(backend.createdBookIds).toEqual([book.id])
  expect(backend.finishedBookIds).toEqual([book.id])
  expect(backend.reopenedBookIds).toEqual([])
})

test('incorrect password and a settled network error stay locked, allow editable retry, and suppress double-submit', async ({
  page,
  backend,
}) => {
  const locale = await prepareApp(page, backend)
  const book = await createHandoff(page, backend, locale, 'Retry retained handoff')
  await idleLock(page, locale, 'band')
  backend.queueVerification('wrong-password', 'network-error')

  await typePassword(page, 'wrong-fixture-password')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toHaveText('Password is incorrect')
  await expect(page.locator('#lock-pwd')).toBeEnabled()
  await expect(lockDialog(page, locale)).toBeVisible()

  await replacePassword(page, 'network-fixture-password')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Failed to fetch')
  await expect(page.locator('#lock-pwd')).toBeEnabled()
  await expect(lockDialog(page, locale)).toBeVisible()

  const releaseVerification = backend.deferNextVerification()
  await replacePassword(page, FIXTURE_PASSWORD)
  await page.keyboard.press('Enter')
  await expect.poll(() => backend.verifyRequests).toBe(3)
  await expect(page.locator('#lock-pwd')).toBeDisabled()
  await page.keyboard.press('Enter')
  await expect.poll(() => backend.verifyRequests, { timeout: 500 }).toBe(3)
  releaseVerification()

  await expect(lockDialog(page, locale)).toBeHidden()
  const handoff = await expectHandoff(page, locale, book.ref_number)
  await expect(handoff.getByText(COPY.en.noSave, { exact: true })).toBeVisible()
  await expect(handoff.getByRole('button', { name: COPY.en.finish, exact: true })).toBeDisabled()
  expect(backend.finishedBookIds).toEqual([])
  expect(backend.discardedBookIds).toEqual([])

  const storedValues = await page.evaluate(() => [
    ...Object.values(window.localStorage),
    ...Object.values(window.sessionStorage),
  ])
  expect(storedValues.join('\n')).not.toContain(FIXTURE_PASSWORD)
  expect(storedValues.join('\n')).not.toContain('wrong-fixture-password')
  expect(storedValues.join('\n')).not.toContain('network-fixture-password')
})

test('nested discard confirmation survives Escape, focus traversal, and application shortcuts while locked', async ({
  page,
  backend,
}) => {
  const locale = await prepareApp(page, backend)
  const book = await createHandoff(page, backend, locale, 'Nested confirmation retained')
  const handoff = handoffDialog(page, locale)
  await handoff.getByRole('button', { name: COPY.en.discard, exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: COPY.en.discard, exact: true })
  await expect(confirmation).toBeVisible()
  const confirmationText = 'The book will be voided; its number stays in the register. Continue?'
  await expect(confirmation).toContainText(confirmationText)

  await idleLock(page, locale, 'band')
  const rawConfirmation = page.locator('[role="dialog"]').filter({ hasText: confirmationText })
  await expect(rawConfirmation).toHaveCount(1)

  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Tab')
    await expectFocusInside(page, '.lock-overlay')
  }
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Shift+Tab')
    await expectFocusInside(page, '.lock-overlay')
  }

  await page.keyboard.press('Escape')
  await expect(lockDialog(page, locale)).toBeVisible()
  await expect(rawConfirmation).toHaveCount(1)
  expect(backend.discardedBookIds).toEqual([])

  const password = page.locator('#lock-pwd')
  await password.click()
  await page.keyboard.press('Control+n')
  await page.keyboard.press('Control+k')
  await page.keyboard.press('Control+/')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)

  const showPassword = lockDialog(page, locale).getByRole('button', { name: 'Show password' })
  await showPassword.focus()
  await page.keyboard.press('Control+n')
  await expect(lockDialog(page, locale)).toBeVisible()
  expect(backend.createdBookIds).toEqual([book.id])
  expect(backend.discardedBookIds).toEqual([])

  await replacePassword(page, FIXTURE_PASSWORD)
  await page.keyboard.press('Enter')
  await expect(lockDialog(page, locale)).toBeHidden()
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText(confirmationText)
  await expectFocusInside(page, '[role="dialog"]')
  expect(backend.verifyRequests).toBe(1)
  expect(backend.finishedBookIds).toEqual([])
  expect(backend.discardedBookIds).toEqual([])
})

test('Finish completing while locked retains the finished view without a duplicate Finish', async ({
  page,
  backend,
}) => {
  const locale = await prepareApp(page, backend)
  const book = await createHandoff(page, backend, locale, 'Finish settles under lock')
  backend.markSaved(book.id)
  await page.clock.fastForward(POLL_ADVANCE_MS)
  const handoff = handoffDialog(page, locale)
  const finish = handoff.getByRole('button', { name: COPY.en.finish, exact: true })
  await expect(finish).toBeEnabled()

  const releaseFinish = backend.deferNextFinish()
  await finish.click()
  await expect.poll(() => backend.finishedBookIds).toEqual([book.id])
  await expect(finish).toBeDisabled()
  await idleLock(page, locale, 'band')

  releaseFinish()
  await expect.poll(() => backend.isFinished(book.id)).toBe(true)
  await expect(page.locator('#lock-pwd')).toBeFocused()
  await expect(lockDialog(page, locale)).toBeVisible()
  expect(backend.finishedBookIds).toEqual([book.id])

  await unlockWithKeyboard(page, locale)
  await expect(
    page.getByRole('dialog', { name: new RegExp(`^${COPY.en.finishedPrefix}`) }),
  ).toBeVisible()
  expect(backend.finishedBookIds).toEqual([book.id])
  expect(backend.createdBookIds).toEqual([book.id])
})

test('late create response replaces the prior token only after unlock and does not mount over the lock', async ({
  page,
  backend,
}) => {
  const locale = await prepareApp(page, backend)
  const first = await createHandoff(page, backend, locale, 'First token')
  const firstDialog = handoffDialog(page, locale)
  await firstDialog.getByRole('button', { name: COPY.en.discard, exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: COPY.en.discard, exact: true })
  await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(firstDialog).toBeHidden()
  expect(backend.discardedBookIds).toEqual([first.id])

  const releaseCreate = backend.deferNextCreate()
  const subject = page.getByRole('textbox', { name: COPY.en.subject, exact: true })
  await subject.fill('Replacement token arrives while locked')
  await page.getByRole('button', { name: COPY.en.create, exact: true }).click()
  await expect.poll(() => backend.createdSubjects.length).toBe(2)
  await idleLock(page, locale, 'band')

  releaseCreate()
  await expect.poll(() => backend.createdBookIds.length).toBe(2)
  const replacement = backend.latestCreatedBook()
  await expect(page.locator('#lock-pwd')).toBeFocused()
  await expect(handoffDialog(page, locale)).toHaveCount(0)
  await expect(page.getByText(replacement.ref_number, { exact: true })).toBeHidden()

  await unlockWithKeyboard(page, locale)
  const replacementDialog = await expectHandoff(page, locale, replacement.ref_number)
  await expect(replacementDialog.getByText(first.ref_number, { exact: true })).toHaveCount(0)
  await expectFocusInside(page, '[role="dialog"]')
  expect(backend.createdBookIds).toEqual([first.id, replacement.id])
  expect(backend.createdSubjects).toEqual(['First token', 'Replacement token arrives while locked'])
  expect(backend.finishedBookIds).toEqual([])
})

test('late Records reopen response stays behind the lock and presents once after unlock', async ({
  page,
  backend,
}) => {
  const existing = backend.existingFinishedBook()
  const locale = await prepareApp(page, backend, {
    path: `/books?open=${existing.id}`,
    viewport: DESKTOP,
  })
  await expect(page.getByText(existing.ref_number, { exact: true }).first()).toBeVisible()

  const releaseReopen = backend.deferNextReopen()
  await page
    .getByRole('button', { name: 'Edit in Word (creates a new version)', exact: true })
    .click()
  await expect.poll(() => backend.reopenedBookIds).toEqual([existing.id])
  await idleLock(page, locale, 'band')

  releaseReopen()
  await expect.poll(() => backend.getBookRequests).toBeGreaterThan(0)
  await expect(page.locator('#lock-pwd')).toBeFocused()
  await expect(handoffDialog(page, locale)).toHaveCount(0)
  expect(backend.reopenedBookIds).toEqual([existing.id])

  await unlockWithKeyboard(page, locale)
  await expectHandoff(page, locale, existing.ref_number)
  await expect(page).toHaveURL(/\/books(?:\?|$)/)
  await expectFocusInside(page, '[role="dialog"]')
  expect(backend.reopenedBookIds).toEqual([existing.id])
  expect(backend.createdBookIds).toEqual([])
})

test('Arabic narrow stack layout works with no background dialog and preserves an ordinary dialog on the next cycle', async ({
  page,
  backend,
}, testInfo) => {
  const locale = await prepareApp(page, backend, {
    locale: 'ar',
    layout: 'stack',
    viewport: NARROW,
  })
  await fillGeneralBook(page, locale, 'اختبار واجهة عربية ضيقة')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await idleLock(page, locale, 'stack')
  await expectLockUsable(page)
  await attachPasswordSafeScreenshot(page, testInfo, 'locked-ar-narrow-stack')
  await unlockWithKeyboard(page, locale)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectFocusInside(page, '#main-content')
  await attachPasswordSafeScreenshot(page, testInfo, 'unlocked-ar-narrow-form')

  await page.getByRole('button', { name: COPY.ar.manageTemplates, exact: true }).click()
  const ordinaryDialog = page.getByRole('dialog', {
    name: COPY.ar.manageTemplates,
    exact: true,
  })
  await expect(ordinaryDialog).toBeVisible()
  await idleLock(page, locale, 'stack')
  await page.keyboard.press('Escape')
  await expect(lockDialog(page, locale)).toBeVisible()
  await unlockWithKeyboard(page, locale)
  await expect(ordinaryDialog).toBeVisible()
  await expectFocusInside(page, '[role="dialog"]')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  expect(backend.createdBookIds).toEqual([])
  expect(backend.finishedBookIds).toEqual([])
  expect(backend.discardedBookIds).toEqual([])
})
