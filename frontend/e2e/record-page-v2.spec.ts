/**
 * Record page v2 — browser smoke (IMPLEMENTATION-PLAN.md §7 "Browser smoke").
 *
 * Fully mocked: every `/api/` request is answered by `RecordBackend` through
 * `page.route('**\/*')` (same harness as `lock-word-handoff.spec.ts`), so no
 * backend runs. PDFs are `backend/tests/fixtures/scan_triage/returned-form-text.pdf`.
 * Routes with no explicit stub answer a SAFE empty 200 shaped from the `request<T>`
 * type in `src/lib/api.ts` and are logged (attached to the test as
 * `unstubbed-routes.txt`, and printed). Set `E2E_STRICT_UNSTUBBED=1` to fail on them.
 *
 * Covers plan §7 assertions 1-12:
 *    1 approved switcher/creator/title     2 header rows (≤768 up)   3 no horizontal overflow
 *    4 paper width (Fit)                   5 phone dock/sheet        6 delete + Undo + 6 s commit
 *    7 rail open / 52px strip / overlay    8 /books tiers (+ Aa 19/24)
 *    9 mine=1 + J/J/Back                   10 approvals sort         11 RTL (dir, dock, chevrons)
 *   12 keys (? C F Esc 0 S)
 * Screenshots: test-results/record-v2/<page>-<w>-<lang>[-aa<N>].png
 *
 * Hooks the spec depends on (grep before renaming): [data-header-row="a|b"], [data-record-header],
 * [data-records-page][data-tier], [data-records-scroller], [data-ptr-scroller], [data-book-id],
 * [data-records-rail][data-rail-tier], [data-records-pane][data-pane-mode], [data-record-dock] /
 * [data-dock-more] / [data-dock-primary], [data-record-paper], [data-record-desk],
 * [data-record-rail="open|strip|overlay"], [data-paper-switcher], data-testid record-meta |
 * record-creator | record-submitter | record-status-line | record-more-markup | queue-prev |
 * queue-next | approvals-full-log-link.
 *
 * RUN - from the worktree, never from the production checkout. No backend is needed (all /api is mocked).
 *   pnpm -C /home/amh/Projects/sentinel-record-v2/frontend exec playwright test e2e/record-page-v2.spec.ts
 * The config's webServer starts `vite dev` for this worktree on 5173, or REUSES whatever already listens
 * there. If another checkout's dev server owns 5173 (e.g. production), serve this worktree on a spare
 * port and point the run at it:
 *   pnpm -C /home/amh/Projects/sentinel-record-v2/frontend exec vite --port 5199 --strictPort    # terminal A
 *   PLAYWRIGHT_BASE_URL=http://localhost:5199 \
 *     pnpm -C /home/amh/Projects/sentinel-record-v2/frontend exec playwright test e2e/record-page-v2.spec.ts
 * (the config still probes 5173 for its own webServer; if that port is free it spawns one extra vite from
 * this worktree, which is harmless.) Filter with `-g "matrix"`, `-g "12:"` etc.
 * Optional env: E2E_REAL_CLOCK=1 (real 6.5 s waits instead of page.clock), E2E_STRICT_UNSTUBBED=1.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Locator, Page, Route, TestInfo } from '@playwright/test'
import { expect, test as base } from '@playwright/test'

import type { components } from '../src/lib/api.types'

// ─────────────────────────────── constants ────────────────────────────────

type Schemas = components['schemas']
type BookRead = Schemas['BookRead']
type BookVersionRead = Schemas['BookVersionRead']
type StepRead = Schemas['BookApprovalStepRead']
type AnnotationRead = Schemas['BookAnnotationRead']
type LogItem = Schemas['ApprovalLogItem']
type TemplateMeta = Schemas['TemplateMeta']

type Lang = 'en' | 'ar'
interface Cell {
  w: number
  h: number
}

const LANGS: Lang[] = ['en', 'ar']
const PHONE: Cell = { w: 390, h: 844 }
const TABLET: Cell = { w: 834, h: 1112 }
const LAPTOP: Cell = { w: 1180, h: 760 }
const DESKTOP: Cell = { w: 1440, h: 900 }
const CELLS: Cell[] = [PHONE, TABLET, LAPTOP, DESKTOP]

const REAL_CLOCK = process.env['E2E_REAL_CLOCK'] === '1'
const STRICT_UNSTUBBED = process.env['E2E_STRICT_UNSTUBBED'] === '1'
const COMMIT_MS = 6_000
/** Host serving the app (the config's baseURL); every other host is answered or aborted, never fetched. */
const APP_HOST = new URL(process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:5173').hostname

const SHOT_DIR = fileURLToPath(new URL('../test-results/record-v2/', import.meta.url))
const PDF_BYTES = readFileSync(
  fileURLToPath(
    new URL('../../backend/tests/fixtures/scan_triage/returned-form-text.pdf', import.meta.url),
  ),
)
const PDF_BASE64 = PDF_BYTES.toString('base64')
const API_TS = readFileSync(fileURLToPath(new URL('../src/lib/api.ts', import.meta.url)), 'utf8')

function loadLocale(lang: Lang): Record<string, unknown> {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../src/locales/${lang}.json`, import.meta.url)), 'utf8'),
  ) as Record<string, unknown>
}
const LOCALES: Record<Lang, Record<string, unknown>> = { en: loadLocale('en'), ar: loadLocale('ar') }

/** The locale string for a dotted key, with `{{var}}` substituted. */
function tr(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  let node: unknown = LOCALES[lang]
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) throw new Error(`locale key ${key} missing (${lang})`)
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node !== 'string') throw new Error(`locale key ${key} is not a string (${lang})`)
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(String(v)), node)
}

const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const BIDI_RUN = '[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]*'

/**
 * Case-insensitive RegExp for a locale string. Unfilled `{{var}}` match anything; substituted values
 * tolerate the bidi isolates the app wraps refs/names in (`bidi()` / `<bdi>`).
 */
function rx(lang: Lang, key: string, vars: Record<string, string | number> = {}, anchored = false): RegExp {
  const template = tr(lang, key)
  const pattern = template
    .split(/(\{\{\w+\}\})/)
    .map((part) => {
      const slot = /^\{\{(\w+)\}\}$/.exec(part)
      if (!slot) return escapeRe(part.replace(BIDI_MARKS, ''))
      const value = vars[slot[1]!]
      return `${BIDI_RUN}${value === undefined ? '.+?' : escapeRe(String(value))}${BIDI_RUN}`
    })
    .join('')
  return new RegExp(anchored ? `^\\s*${pattern}\\s*$` : pattern, 'i')
}

// ──────────────────────────────── fixtures ────────────────────────────────

const PEOPLE = {
  me: { id: 1, en: 'Noura Al-Falasi', ar: 'نورة الفلاسي' },
  ahmed: { id: 2, en: 'Ahmed Al-Mansoori', ar: 'أحمد المنصوري' },
  khalid: { id: 3, en: 'Khalid Al-Mazrouei', ar: 'خالد المزروعي' },
  saeed: { id: 4, en: 'Saeed Al-Ameri', ar: 'سعيد العامري' },
  mariam: { id: 5, en: 'Mariam Al-Ketbi', ar: 'مريم الكتبي' },
  fatima: { id: 6, en: 'Fatima Al-Hosani', ar: 'فاطمة الحوسني' },
  omar: { id: 7, en: 'Omar Al-Shamsi', ar: 'عمر الشامسي' },
} as const
type PersonKey = keyof typeof PEOPLE
const ME = PEOPLE.me

/** Prototype service tiles → real template ids (so the rail has real labels/artwork). */
const SERVICES = {
  leave: { id: 'Leave Application Form', cat: 'HR', en: 'Leave Application Form', ar: 'نموذج طلب إجازة' },
  cert: { id: 'General Book', cat: 'GS', en: 'General Book', ar: 'الكتاب العام' },
  permit: { id: 'Warning Form', cat: 'GS', en: 'Warning Form', ar: 'نموذج إنذار' },
  vehicle: { id: 'Material Request Form', cat: 'LOG', en: 'Material Request Form', ar: 'طلب مواد' },
} as const
type ServiceKey = keyof typeof SERVICES

type RecordState = 'none' | 'pending' | 'awaiting_scan' | 'approved' | 'returned' | 'rejected'

interface Spec {
  id: number
  ref: string
  /** prototype state label, for readable failures */
  kind: string
  state: RecordState
  svc: ServiceKey
  subj: [string, string]
  by: PersonKey
  daysAgo: number
  doc: boolean
  /** approver for pending/awaiting_scan/returned/rejected/approved */
  approver?: PersonKey
  signed?: { by: PersonKey; daysAgo: number }
  scans?: number
  note?: [string, string]
  marks?: number
  noTemplate?: boolean
  wordEditor?: PersonKey
}

const longArSubject =
  'طلب إجازة سنوية — سعيد العامري (٢١ يوماً) — يرجى التوقيع والموافقة قبل نهاية الأسبوع الجاري مع مراجعة جدول المناوبات وتأكيد الموظف البديل'

/** One book per prototype state (proto:535-545) + extras the list/queue flows need. */
const SPECS: Spec[] = [
  { id: 42, ref: '1-0042', kind: 'pending-me', state: 'pending', svc: 'leave', by: 'saeed', daysAgo: 3, doc: true, approver: 'me',
    subj: ['Annual leave request — Saeed Al-Ameri (21 days)', longArSubject] },
  { id: 43, ref: '1-0043', kind: 'pending-other', state: 'pending', svc: 'cert', by: 'fatima', daysAgo: 4, doc: true, approver: 'khalid',
    subj: ['Experience certificate — Fatima Al-Hosani', 'شهادة خبرة — فاطمة الحوسني'] },
  { id: 44, ref: '1-0044', kind: 'awaiting_scan', state: 'awaiting_scan', svc: 'permit', by: 'omar', daysAgo: 5, doc: true, approver: 'ahmed',
    subj: ['Site access permit — Omar Al-Shamsi', 'تصريح دخول موقع — عمر الشامسي'] },
  { id: 45, ref: '1-0045', kind: 'approved (signed + 1 scan)', state: 'approved', svc: 'leave', by: 'khalid', daysAgo: 7, doc: true, approver: 'ahmed',
    signed: { by: 'ahmed', daysAgo: 3 }, scans: 1,
    subj: ['Emergency leave — Khalid Al-Mazrouei', 'إجازة طارئة — خالد المزروعي'] },
  { id: 46, ref: '1-0046', kind: 'returned (3 marks)', state: 'returned', svc: 'leave', by: 'me', daysAgo: 8, doc: true, approver: 'ahmed',
    marks: 3, note: ['Dates overlap with the Eid duty roster — please move by a week.', 'التواريخ تتعارض مع جدول مناوبة العيد — يرجى التأجيل أسبوعاً.'],
    subj: ['Annual leave — Mariam Al-Ketbi (Eid period)', 'إجازة سنوية — مريم الكتبي (فترة العيد)'] },
  { id: 47, ref: '1-0047', kind: 'rejected', state: 'rejected', svc: 'vehicle', by: 'me', daysAgo: 9, doc: true, approver: 'khalid', noTemplate: true,
    note: ['Vehicle pool is frozen until Q1.', 'أسطول المركبات مجمّد حتى الربع الأول.'],
    subj: ['Vehicle allocation — imported letter', 'تخصيص مركبة — خطاب مستورد'] },
  { id: 48, ref: '1-0048', kind: 'draft', state: 'none', svc: 'cert', by: 'me', daysAgo: 1, doc: true,
    subj: ['Salary certificate — Saeed Al-Ameri', 'شهادة راتب — سعيد العامري'] },
  { id: 49, ref: '1-0049', kind: 'word-session draft', state: 'none', svc: 'permit', by: 'mariam', daysAgo: 1, doc: true, wordEditor: 'mariam',
    subj: ['Contractor permit — custom wording', 'تصريح مقاول — صياغة خاصة'] },
  { id: 50, ref: '1-0050', kind: 'draft, PDF failed to render (no doc)', state: 'none', svc: 'cert', by: 'me', daysAgo: 0, doc: false,
    subj: ['To-whom-it-may-concern letter — Omar Al-Shamsi', 'خطاب لمن يهمه الأمر — عمر الشامسي'] },
  { id: 51, ref: '1-0038', kind: 'approved (signed)', state: 'approved', svc: 'cert', by: 'ahmed', daysAgo: 15, doc: true, approver: 'khalid',
    signed: { by: 'khalid', daysAgo: 14 }, scans: 0,
    subj: ['Experience certificate — Ahmed Al-Mansoori', 'شهادة خبرة — أحمد المنصوري'] },
  { id: 52, ref: '1-0036', kind: 'approved (signed + 1 scan)', state: 'approved', svc: 'vehicle', by: 'omar', daysAgo: 17, doc: true, approver: 'ahmed',
    signed: { by: 'ahmed', daysAgo: 16 }, scans: 1,
    subj: ['Vehicle handover — fleet 14', 'تسليم مركبة — الأسطول 14'] },
  // ids 53-66: approved + created by me (the `status=approved&mine=1` list needs ≥5 rows and to scroll)
  ...Array.from({ length: 14 }, (_, i): Spec => ({
    id: 53 + i,
    ref: `2-${String(100 + i).padStart(4, '0')}`,
    kind: `approved-by-me #${i + 1}`,
    state: 'approved',
    svc: (['leave', 'cert', 'vehicle', 'permit'] as const)[i % 4]!,
    by: 'me',
    daysAgo: 20 + i,
    doc: true,
    approver: 'ahmed',
    signed: { by: 'ahmed', daysAgo: 19 + i },
    scans: i % 3 === 0 ? 1 : 0,
    subj: [`Approved record ${i + 1} — fleet allocation`, `سجل معتمد ${i + 1} — تخصيص الأسطول`],
  })),
  // a second "waiting for me" row so the received queue has a neighbour
  { id: 67, ref: '1-0067', kind: 'pending-me #2', state: 'pending', svc: 'leave', by: 'khalid', daysAgo: 2, doc: true, approver: 'me',
    subj: ['Sick leave request — Khalid Al-Mazrouei', 'طلب إجازة مرضية — خالد المزروعي'] },
]

/** The newest approved fixture by submission (the "Sent / approved" log must open on it). */
const NEWEST_APPROVED_ID = 45
/** Newest "waiting for me" fixture (the dashboard widget link must open the log on it). */
const NEWEST_PENDING_ME_ID = 67
const MINE_APPROVED_IDS = SPECS.filter((s) => s.by === 'me' && s.state === 'approved').map((s) => s.id)

const daysAgoIso = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString()
const specOf = (id: number): Spec => {
  const spec = SPECS.find((s) => s.id === id)
  if (!spec) throw new Error(`no fixture ${id}`)
  return spec
}

// ────────────────────── fake backend (page.route harness) ──────────────────

interface GetShape {
  re: RegExp
  fallback: unknown
}

/** Shapes of every `request<T>('GET', path)` in api.ts, so unknown GETs answer a type-safe empty. */
function buildGetShapes(): GetShape[] {
  const shapes: GetShape[] = []
  const callRe = /request<([^\n]*?)>\(\s*'GET',\s*(`[^`]*`|'[^']*')/g
  for (const m of API_TS.matchAll(callRe)) {
    const type = m[1] ?? ''
    let path = (m[2] ?? '').slice(1, -1)
    // drop the query-string helper and everything after it, then turn `${id}` segments into wildcards
    path = path.replace(/\$\{qs\(.*$/s, '').replace(/\?.*$/s, '')
    if (!path.startsWith('/')) continue
    const pattern = path.split(/\$\{[^}]*\}/).map(escapeRe).join('[^/]+')
    let fallback: unknown = {}
    if (/\[\]\s*$/.test(type) || /^Array</.test(type)) fallback = []
    else if (/\|\s*null\s*$/.test(type)) fallback = null
    else if (/(ListResponse|PageRead|Page|ListRead|SearchResponse)\b/.test(type))
      fallback = { items: [], total: 0, limit: 50, offset: 0 }
    shapes.push({ re: new RegExp(`^${pattern}$`), fallback })
  }
  return shapes
}
const GET_SHAPES = buildGetShapes()

const CAPABILITIES = [
  'books.view', 'books.edit', 'books.create', 'books.submit', 'books.delete', 'books.approve',
  'books.override_state', 'books.templates', 'documents.generate', 'documents.scan', 'email.manage',
  'employees.view', 'ledger.view', 'settings.view', 'users.manage',
  ...Object.values(SERVICES).flatMap((s) => [`books.service.${s.id}`, `books.servicerecords.${s.id}`]),
]

interface BackendOptions {
  lang: Lang
  /** Aa font scale: 16 | 19 | 22 | 24 */
  aa: number
}

class RecordBackend {
  lang: Lang = 'en'
  aa = 16
  readonly deleted = new Set<number>()
  readonly deleteRequests: string[] = []
  readonly signRequests: string[] = []
  readonly listRequests: URL[] = []
  readonly facetRequests: URL[] = []
  readonly approvalLogRequests: URL[] = []
  readonly unstubbed: string[] = []
  readonly unhandled: string[] = []

  configure(options: BackendOptions): void {
    this.lang = options.lang
    this.aa = options.aa
  }

  async install(page: Page): Promise<void> {
    await page.route('**/*', async (route) => this.handle(route))
  }

  // ── builders ──
  private subjectOf(spec: Spec): string {
    return this.lang === 'ar' ? spec.subj[1] : spec.subj[0]
  }

  private step(spec: Spec, book: number): StepRead[] {
    if (!spec.approver) return []
    const decided = spec.state === 'approved' || spec.state === 'returned' || spec.state === 'rejected'
    const person = PEOPLE[spec.approver]
    return [
      {
        id: book * 10,
        step_order: 0,
        stage_label: 'Approve',
        assignee_user_id: person.id,
        state: spec.state === 'pending' || spec.state === 'awaiting_scan' ? 'pending' : spec.state,
        note: spec.note ? (this.lang === 'ar' ? spec.note[1] : spec.note[0]) : null,
        decided_at: decided ? daysAgoIso(Math.max(spec.daysAgo - 1, 0.2)) : null,
        kind: 'approver',
        seen_at: null,
        assignee_name: person.en,
      },
    ]
  }

  book(id: number): BookRead {
    const spec = specOf(id)
    const svc = SERVICES[spec.svc]
    const creator = PEOPLE[spec.by]
    const submitted = spec.state !== 'none'
    const versionId = id * 10 + 1
    const docId = spec.doc ? id * 100 : null
    const steps = this.step(spec, id)
    const signedUrl = spec.signed ? `/api/v1/books/${id}/versions/${versionId}/signed-document` : null
    const version: BookVersionRead = {
      id: versionId,
      version_no: 1,
      trigger: 'initial',
      status: spec.state,
      template_id: spec.noTemplate ? null : svc.id,
      document_id: docId,
      has_fields: !spec.noTemplate,
      created_at: daysAgoIso(spec.daysAgo),
      submitted_at: submitted ? daysAgoIso(spec.daysAgo - 0.04) : null,
      created_by_name: creator.en,
      docx_url: docId ? `/api/v1/documents/${docId}/download?format=docx` : null,
      pdf_url: docId ? `/api/v1/documents/${docId}/download?format=pdf` : null,
      manager_sig_embedded: false,
      signed_pdf_url: signedUrl,
      signed_source: spec.signed ? 'in_app' : null,
      approval_steps: steps,
    }
    const pendingMe = spec.state === 'pending' && spec.approver === 'me'
    const book: BookRead = {
      id,
      ref_number: spec.ref,
      category_id: svc.cat,
      category: { id: svc.cat, name_en: svc.cat, name_ar: svc.cat, prefix: svc.cat, requires_approval: true },
      employee_id: null,
      employee_name_snapshot: null,
      subject: this.subjectOf(spec),
      direction: 'outgoing',
      stamp_style: 'Header Text (Ref: XX-0000)',
      doc_id: null,
      created_at: daysAgoIso(spec.daysAgo),
      deleted_at: null,
      priority: 'Normal',
      approval_state: spec.state,
      access_scope: 'full',
      selected_version_id: versionId,
      can_sign: pendingMe,
      can_review: false,
      classification_code: svc.id === 'General Book' ? '15/1' : null,
      voided_at: null,
      is_draft: spec.state === 'none',
      edit_session: spec.wordEditor
        ? {
            user_id: PEOPLE[spec.wordEditor].id,
            user_name: PEOPLE[spec.wordEditor].en,
            state: 'active',
            last_put_at: daysAgoIso(0.05),
            created_at: daysAgoIso(0.2),
          }
        : null,
      signing_path: 'in_app',
      submitted_by_user_id: submitted ? creator.id : null,
      submitted_by_name: submitted ? creator.en : null,
      submitted_by_g: null,
      created_by_user_id: creator.id,
      created_by_name: creator.en,
      created_by_g: 'G1000',
      submitted_at: submitted ? daysAgoIso(spec.daysAgo - 0.04) : null,
      doc_manager_user_id: null,
      doc_manager_name: null,
      doc_manager_has_signature: false,
      is_word_book: Boolean(spec.wordEditor),
      your_step_kind: pendingMe ? 'approver' : null,
      approval_steps: steps,
      attachment_paths: Array.from({ length: spec.scans ?? 0 }, (_, i) => `book_attachments/${id}/scan-${i + 1}.pdf`),
      versions: [version],
      original_creator_user_id: creator.id,
      included_papers_revision: 0,
      included_papers_fixed_page_count: 0,
      included_papers_total_page_count: 0,
      included_papers: [],
      included_papers_history: [],
      sms: [],
      search_snippet: null,
      current_template_id: spec.noTemplate ? null : svc.id,
      service_id: svc.id,
    }
    return book
  }

  private liveSpecs(): Spec[] {
    return SPECS.filter((s) => !this.deleted.has(s.id))
  }

  /** `/books` order: created_at DESC, id DESC. */
  private listOrder(specs: Spec[]): Spec[] {
    return [...specs].sort((a, b) => a.daysAgo - b.daysAgo || b.id - a.id)
  }

  private annotations(bookId: number): AnnotationRead[] {
    const spec = specOf(bookId)
    const positions = [{ x: 0.3, y: 0.38 }, { x: 0.62, y: 0.46 }, { x: 0.44, y: 0.7 }]
    const texts = ['Start date clashes with roster', 'Handover person missing', 'Needs line manager initials']
    return Array.from({ length: spec.marks ?? 0 }, (_, i) => ({
      id: bookId * 10 + i,
      version_id: bookId * 10 + 1,
      page: 1,
      kind: 'pin',
      geometry: positions[i] ?? positions[0]!,
      comment: texts[i] ?? null,
      author_user_id: PEOPLE.ahmed.id,
      author_name: PEOPLE.ahmed.en,
      created_at: daysAgoIso(spec.daysAgo - 1),
    }))
  }

  private logItem(spec: Spec, scope: 'sent' | 'received'): LogItem {
    const book = this.book(spec.id)
    const version = book.versions![0]!
    const svc = SERVICES[spec.svc]
    const status = scope === 'received' && spec.state === 'pending' ? 'pending' : spec.state
    return {
      book_id: spec.id,
      ref_number: spec.ref,
      subject: book.subject,
      category_name_en: svc.en,
      category_name_ar: svc.ar,
      status,
      record_status: spec.state,
      priority: 'Normal',
      submitted_by_user_id: PEOPLE[spec.by].id,
      submitted_by_name: PEOPLE[spec.by].en,
      doc_manager_user_id: null,
      doc_manager_name: null,
      approver_name: spec.approver ? PEOPLE[spec.approver].en : null,
      reviewer_names: [],
      submitted_at: version.submitted_at ?? null,
      decided_at: spec.state === 'approved' ? daysAgoIso(spec.signed?.daysAgo ?? 1) : null,
      verdict: spec.state === 'approved' ? 'approved' : spec.state === 'returned' ? 'returned' : spec.state === 'rejected' ? 'rejected' : null,
      document_id: version.document_id ?? null,
      version_id: version.id,
      version_no: 1,
      assignment_version_no: 1,
      assigned_signer_user_id: spec.approver ? PEOPLE[spec.approver].id : null,
      access_scope: 'full',
    }
  }

  private logSpecs(params: URLSearchParams): Spec[] {
    const scope = params.get('scope') === 'sent' ? 'sent' : 'received'
    const status = params.get('status') ?? (scope === 'received' ? 'pending' : 'all')
    let specs = this.liveSpecs().filter((s) => s.state !== 'none')
    if (scope === 'received') specs = specs.filter((s) => s.approver === 'me')
    if (status !== 'all') specs = specs.filter((s) => s.state === status)
    // The backend default is newest (plan §1g); oldest only when asked.
    const submittedAt = (s: Spec): number => s.daysAgo
    return [...specs].sort((a, b) =>
      params.get('sort') === 'oldest' ? submittedAt(b) - submittedAt(a) : submittedAt(a) - submittedAt(b),
    )
  }

  private facets(created: boolean): unknown {
    const specs = this.liveSpecs().filter((s) => !created || s.by === 'me')
    const states: Record<string, number> = {}
    const services = new Map<string, { id: string; count: number; states: Record<string, number> }>()
    for (const s of specs) {
      states[s.state] = (states[s.state] ?? 0) + 1
      const id = SERVICES[s.svc].id
      const entry = services.get(id) ?? { id, count: 0, states: {} }
      entry.count += 1
      entry.states[s.state] = (entry.states[s.state] ?? 0) + 1
      services.set(id, entry)
    }
    return { total: specs.length, states, services: [...services.values()] }
  }

  private json(route: Route, value: unknown, status = 200): Promise<void> {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
  }

  private error(route: Route, status: number, code: string, message: string): Promise<void> {
    return this.json(route, { error: { code, message, details: {} } }, status)
  }

  private pdf(route: Route, url: URL): Promise<void> {
    if (url.searchParams.get('encoding') === 'base64') {
      return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: PDF_BASE64 })
    }
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF_BYTES })
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()

    if (url.hostname === 'api.bigdatacloud.net') {
      return void (await this.json(route, { latitude: 24.4539, longitude: 54.3773, city: 'Abu Dhabi', locality: 'Abu Dhabi' }))
    }
    if (url.hostname === 'api.open-meteo.com') {
      return void (await this.json(route, {
        current: { temperature_2m: 32, relative_humidity_2m: 44, weather_code: 0, is_day: 1 },
        daily: { temperature_2m_max: [36], temperature_2m_min: [27] },
      }))
    }
    if (url.hostname !== APP_HOST) {
      // fonts / telemetry etc.: never reach the network
      return void (await route.abort('failed'))
    }
    if (!url.pathname.startsWith('/api/')) return void (await route.continue())
    if (!url.pathname.startsWith('/api/v1/')) {
      this.unhandled.push(`${method} ${url.pathname}`)
      return void (await route.abort('failed'))
    }

    const path = decodeURIComponent(url.pathname.slice('/api/v1'.length))
    const q = url.searchParams

    // ── auth / shell ──
    if (method === 'GET' && path === '/auth/me') {
      return void (await this.json(route, {
        id: ME.id, email: 'me@example.invalid', employee_id: 'G1001', name_en: ME.en, name_ar: ME.ar,
        position: 'Records Officer', department: 'Records', photo_url: null, role: 'admin', status: 'active',
        is_admin: true, is_manager: true, has_signature: true, idle_lock_seconds: 1800, lock_layout: 'band',
      }))
    }
    if (method === 'GET' && path === '/auth/me/capabilities') return void (await this.json(route, CAPABILITIES))
    if (method === 'GET' && path === '/auth/capabilities') return void (await this.json(route, []))
    if (method === 'GET' && path === '/auth/users') return void (await this.json(route, []))
    if (method === 'GET' && path === '/system/migration-status') {
      return void (await this.json(route, { has_db: true, has_data: true, v3_data_dir_detected: null, last_migration: null }))
    }
    if (method === 'GET' && path === '/settings') {
      return void (await this.json(route, {
        stamp_style: 'Header Text (Ref: XX-0000)', default_manager_id: null, manager_hand_sign_default: false,
        theme: 'light', language: this.lang, font_scale: this.aa, sig_personnel_path: null, sig_admin_path: null,
        legacy_signature_path: null, admin_gate_enabled: false, sentry_opt_in: false, sms_autosend_enabled: false,
        email_signature: '', signature_size_mm: 28, signature_boldness: 1, inmate_reporter_manager_user_id: null,
      }))
    }
    if (method === 'PATCH' && path === '/settings') return void (await this.json(route, {}))
    if (method === 'GET' && path === '/documents/activity/me') {
      return void (await this.json(route, { documents_today: 0, documents_week: 0 }))
    }
    if (method === 'GET' && path === '/email/account') return void (await this.json(route, null))
    if (method === 'GET' && path === '/notifications/counts') {
      return void (await this.json(route, { approvals: 0, leaves: 0, scans: 0, emails: 0 }))
    }
    if (method === 'GET' && path === '/notifications/stream') {
      return void (await route.fulfill({
        status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' },
        body: 'event: counts\ndata: {"approvals":0,"leaves":0,"scans":0,"emails":0}\n\n',
      }))
    }
    if (method === 'GET' && path === '/scan-inbox/count') {
      return void (await this.json(route, { awaiting_confirmation: 0, unrouted: 0, total: 0 }))
    }
    if (method === 'GET' && path === '/ledger/unread-recent') return void (await this.json(route, { items: [], total_unread: 0 }))
    if (method === 'GET' && /^\/ledger\/(unread-count|flag-count)$/.test(path)) return void (await this.json(route, { count: 0 }))
    if (method === 'GET' && path === '/expiry/summary') return void (await this.json(route, { expired: 0, critical: 0, urgent: 0 }))
    if (method === 'GET' && path === '/expiry') return void (await this.json(route, []))
    if (method === 'GET' && path === '/workforce/access/me') {
      return void (await this.json(route, { workforce_access_tier: 'none', scopes: [] }))
    }
    if (method === 'GET' && path === '/dashboard/layout') return void (await this.json(route, null))
    if (method === 'GET' && path === '/dashboard/summary') {
      return void (await this.json(route, {
        totals: { employees_active: 0, on_leave_today: 0, present_today: 0, forms_this_month: 0, open_violations_count: 0 },
        on_leave_today: [], upcoming_leave_ends: [], recent_documents: [], recent_ledger: [],
        email_sync: { last_synced_at: null, enabled: false, interval_minutes: 15, incoming_today: 0 },
      }))
    }
    if (method === 'GET' && path === '/inmate-violations/statistics/awaiting-close') {
      return void (await this.json(route, { months: [] }))
    }
    if (method === 'GET' && path === '/templates') {
      const items: TemplateMeta[] = Object.values(SERVICES).map((s) => ({
        id: s.id, name_en: s.en, name_ar: s.ar, form_number: s.cat, category: 'admin', signing_path: 'in_app',
        has_code: false, feature_minted: false, notifies_employee: false,
      }))
      return void (await this.json(route, { items }))
    }
    const editorMatch = path.match(/^\/documents\/(\d+)\/signature-editor$/)
    if (method === 'GET' && editorMatch) {
      // Probed by the "Adjust signature" trigger; the fixtures have no placeable signature.
      return void (await this.json(route, {
        document_id: Number(editorMatch[1]), version_id: 0, signature_revision: 0, package_revision: 0,
        source_sha256: null, can_adjust: false, can_identify: false, unavailable_code: 'NO_SIGNATURE',
        measured: false, pdf_url: null, pages: [], signatures: [], candidates: null,
      }))
    }

    // ── books: static segments first ──
    if (method === 'GET' && path === '/book-categories') {
      const cats = [...new Set(Object.values(SERVICES).map((s) => s.cat))]
      return void (await this.json(route, cats.map((id) => ({ id, name_en: id, name_ar: id, prefix: id, requires_approval: true }))))
    }
    if (method === 'GET' && path === '/books/classifications') {
      return void (await this.json(route, { items: [{ code: '15/1', tab: 15, name_ar: 'المراسلات العامة', name_en: 'General correspondence', unit_ar: 'إدارة السجلات' }] }))
    }
    if (method === 'GET' && path === '/books/facets') {
      this.facetRequests.push(url)
      return void (await this.json(route, this.facets(q.get('created_by_me') === 'true')))
    }
    if (method === 'GET' && path === '/books/approval-summary') {
      const pending = this.listOrder(this.liveSpecs()).filter((s) => s.state === 'pending' && s.approver === 'me')
      const newest = pending[0] ? this.logItem(pending[0], 'received') : null
      return void (await this.json(route, {
        can_view_sent: true,
        available_received_kinds: ['approver'],
        signature: { count: pending.length, oldest: newest },
        review: { count: 0, oldest: null },
        sent: { count: this.liveSpecs().filter((s) => s.state !== 'none').length, oldest: null },
        returned_count: this.liveSpecs().filter((s) => s.state === 'returned').length,
        actionable_count: pending.length,
      }))
    }
    if (method === 'GET' && path === '/books/approval-log') {
      this.approvalLogRequests.push(url)
      const specs = this.logSpecs(q)
      const scope = q.get('scope') === 'sent' ? 'sent' : 'received'
      const offset = Number(q.get('offset') ?? 0)
      const limit = Number(q.get('limit') ?? 100)
      return void (await this.json(route, {
        items: specs.slice(offset, offset + limit).map((s) => this.logItem(s, scope)),
        total: specs.length, limit, offset,
      }))
    }
    const neighborsMatch = path.match(/^\/books\/approval-log\/(\d+)\/neighbors$/)
    if (method === 'GET' && neighborsMatch) {
      const scope = q.get('scope') === 'sent' ? 'sent' : 'received'
      const specs = this.logSpecs(q)
      const index = specs.findIndex((s) => s.id === Number(neighborsMatch[1]))
      const at = (i: number): LogItem | null => (specs[i] ? this.logItem(specs[i]!, scope) : null)
      return void (await this.json(route, {
        position: index >= 0 ? index + 1 : null, total: specs.length,
        previous: index > 0 ? at(index - 1) : null, next: index >= 0 ? at(index + 1) : null,
      }))
    }
    if (method === 'GET' && path === '/books/awaiting') {
      return void (await this.json(route, this.liveSpecs().filter((s) => s.state === 'pending' && s.approver === 'me').map((s) => this.book(s.id))))
    }
    if (method === 'GET' && path === '/books/awaiting-scan') return void (await this.json(route, []))
    if (method === 'GET' && /^\/books\/(approvers|reviewer-candidates|word-templates)$/.test(path)) {
      return void (await this.json(route, path === '/books/approvers'
        ? [{ id: PEOPLE.ahmed.id, name: PEOPLE.ahmed.en, has_signature: true, is_default: true }]
        : []))
    }
    if (method === 'GET' && path === '/books') {
      this.listRequests.push(url)
      let specs = this.liveSpecs()
      if (q.get('created_by_me') === 'true') specs = specs.filter((s) => s.by === 'me')
      const text = (q.get('q') ?? '').trim().toLowerCase()
      if (text) specs = specs.filter((s) => `${s.ref} ${s.subj.join(' ')}`.toLowerCase().includes(text))
      const state = q.get('approval_state')
      if (state) specs = specs.filter((s) => s.state === state)
      const service = q.get('service_id')
      if (service) specs = specs.filter((s) => SERVICES[s.svc].id === service)
      const ordered = this.listOrder(specs)
      const offset = Number(q.get('offset') ?? 0)
      const limit = Number(q.get('limit') ?? 500)
      return void (await this.json(route, {
        items: ordered.slice(offset, offset + limit).map((s) => this.book(s.id)),
        total: ordered.length, limit, offset,
      }))
    }

    // ── per-book ──
    const bookMatch = path.match(/^\/books\/(\d+)$/)
    if (bookMatch) {
      const id = Number(bookMatch[1])
      const known = SPECS.some((s) => s.id === id)
      if (method === 'GET') {
        if (!known || this.deleted.has(id)) return void (await this.error(route, 404, 'BOOK_NOT_FOUND', 'Book not found'))
        return void (await this.json(route, this.book(id)))
      }
      if (method === 'DELETE') {
        this.deleteRequests.push(`${method} ${url.pathname}`)
        this.deleted.add(id)
        return void (await route.fulfill({ status: 204, body: '' }))
      }
    }
    const bookSub = path.match(/^\/books\/(\d+)\/(.+)$/)
    if (bookSub) {
      const id = Number(bookSub[1])
      const rest = bookSub[2]!
      if (method === 'POST' && rest === 'seen') return void (await route.fulfill({ status: 204, body: '' }))
      if (method === 'POST' && rest === 'sign') {
        this.signRequests.push(`${method} ${url.pathname}`)
        return void (await this.json(route, this.book(id)))
      }
      if (method === 'GET' && /^versions\/\d+\/annotations$/.test(rest)) return void (await this.json(route, this.annotations(id)))
      if (method === 'GET' && /^versions\/\d+\/signed-document$/.test(rest)) return void (await this.pdf(route, url))
      if (method === 'GET' && /^attachments\/\d+$/.test(rest)) return void (await this.pdf(route, url))
      if (method === 'GET' && rest === 'revision-access') return void (await this.json(route, []))
    }
    if (method === 'GET' && /^\/documents\/\d+\/download$/.test(path)) return void (await this.pdf(route, url))

    // ── unknown: safe empty 200 + logged ──
    const label = `${method} ${url.pathname}${url.search}`
    this.unstubbed.push(label)
    if (method === 'GET') {
      const shape = GET_SHAPES.find((s) => s.re.test(path))
      return void (await this.json(route, shape ? shape.fallback : []))
    }
    return void (await this.json(route, {}))
  }
}

const test = base.extend<{ backend: RecordBackend }>({
  // `use` is renamed: react-hooks' /^use[A-Z]?/ heuristic flags the Playwright default name.
  backend: async ({ page }, runTest, testInfo: TestInfo) => {
    const backend = new RecordBackend()
    await backend.install(page)
    await runTest(backend)
    const unstubbed = [...new Set(backend.unstubbed)]
    if (unstubbed.length > 0) {
      const body = unstubbed.join('\n')
      await testInfo.attach('unstubbed-routes.txt', { body, contentType: 'text/plain' })
      console.warn(`[record-v2 e2e] ${testInfo.title}: unstubbed routes answered with safe empties:\n${body}`)
      if (STRICT_UNSTUBBED) expect(unstubbed, 'every API route must be stubbed').toEqual([])
    }
    expect(backend.unhandled, 'non-/api/v1 API requests').toEqual([])
  },
})

test.use({ serviceWorkers: 'block' })
test.describe.configure({ timeout: 90_000 })

// ───────────────────────────────── helpers ────────────────────────────────

interface BootOptions {
  lang?: Lang
  aa?: number
  cell?: Cell
  path?: string
  /** Install `page.clock` before the first navigation (deferred-delete timing). */
  clock?: boolean
}

async function boot(page: Page, backend: RecordBackend, options: BootOptions = {}): Promise<Lang> {
  const lang = options.lang ?? 'en'
  const aa = options.aa ?? 16
  backend.configure({ lang, aa })
  const cell = options.cell ?? DESKTOP
  await page.setViewportSize({ width: cell.w, height: cell.h })
  if (options.clock && !REAL_CLOCK) await page.clock.install({ time: new Date() })
  await page.addInitScript(
    ({ language, scale }: { language: string; scale: number }) => {
      // Reset once per tab; keep sessionStorage (focus mode) across in-test navigations.
      if (!window.sessionStorage.getItem('__e2e_init')) {
        window.localStorage.clear()
        window.sessionStorage.clear()
        window.sessionStorage.setItem('__e2e_init', '1')
      }
      window.localStorage.setItem('gssg.lang', language)
      window.localStorage.setItem('gssg.font-scale', String(scale))
    },
    { language: lang, scale: aa },
  )
  await page.goto(options.path ?? '/books')
  await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${lang}`))
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
  await expect(page.locator('html')).toHaveAttribute('data-font-scale', String(aa))
  return lang
}

const isPhone = (cell: Cell): boolean => cell.w < 768

async function shot(page: Page, name: string, cell: Cell, lang: Lang, aa = 16): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true })
  if (name.startsWith('record')) {
    // The paper must have rendered (not a spinner) before the picture is taken.
    await page.waitForFunction(
      () => {
        const c = document.querySelector<HTMLCanvasElement>('[data-record-paper] canvas')
        const r = c?.getBoundingClientRect()
        return Boolean(r && r.width > 0 && r.height > 0)
      },
      undefined,
      { timeout: 15_000 },
    )
  }
  await page.waitForTimeout(350)
  const suffix = aa === 16 ? '' : `-aa${aa}`
  await page.screenshot({ path: `${SHOT_DIR}${name}-${cell.w}-${lang}${suffix}.png`, animations: 'disabled' })
}

/** 3. No horizontal page overflow. */
async function expectNoHorizontalOverflow(page: Page, what: string): Promise<void> {
  const m = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }))
  expect(Math.max(m.html, m.body), `horizontal overflow on ${what}`).toBeLessThanOrEqual(m.inner + 1)
}

const scrollerOf = (page: Page): Locator => page.locator('[data-records-scroller], [data-ptr-scroller]').first()
const rowOf = (page: Page, id: number): Locator => page.locator(`[data-book-id="${id}"]`).first()

async function waitForList(page: Page, expectedId: number): Promise<void> {
  await expect(rowOf(page, expectedId)).toBeVisible({ timeout: 20_000 })
}

async function waitForRecord(page: Page, lang: Lang, id: number): Promise<void> {
  const spec = specOf(id)
  await expect(page).toHaveURL(new RegExp(`/books/${id}(\\?|$)`))
  await expect(page.locator('h1').filter({ hasText: spec.subj[lang === 'ar' ? 1 : 0].slice(0, 24) }).first()).toBeVisible({
    timeout: 20_000,
  })
}

async function openRecord(page: Page, lang: Lang, id: number): Promise<void> {
  await page.goto(`/books/${id}`)
  await waitForRecord(page, lang, id)
}

/** Open a record by clicking its ref link in the list (carries RecordNavState). */
async function openFromList(page: Page, lang: Lang, id: number): Promise<void> {
  await waitForList(page, id)
  await rowOf(page, id).scrollIntoViewIfNeeded()
  const link = scrollerOf(page).locator(`a[href="/books/${id}"], a[href^="/books/${id}?"]`).first()
  await link.click()
  await waitForRecord(page, lang, id)
}

const backButton = (page: Page, lang: Lang): Locator =>
  page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'books.record.back').replace(BIDI_MARKS, ''))}`) }).first()

async function elapse(page: Page, ms: number): Promise<void> {
  if (REAL_CLOCK) await page.waitForTimeout(ms)
  else await page.clock.fastForward(ms)
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('element has no bounding box')
  return b
}

const paperLocator = (page: Page): Locator =>
  page.locator('[data-record-paper]').or(page.locator('.print-paper canvas')).first()

async function paperWidth(page: Page): Promise<number> {
  const paper = paperLocator(page)
  await expect(paper).toBeVisible({ timeout: 20_000 })
  // let a pending zoom/fit settle
  await page.waitForTimeout(500)
  return (await box(paper)).width
}

const dockOf = (page: Page): Locator => page.locator('[data-record-dock]').first()

/** A row in the phone More sheet (a button or a menu item, enabled or aria-disabled). */
const sheetItem = (sheet: Locator, name: RegExp): Locator =>
  sheet.getByRole('button', { name }).or(sheet.getByRole('menuitem', { name })).first()

async function expectStatusLine(page: Page, lang: Lang, key: string, vars: Record<string, string> = {}): Promise<void> {
  const line = page.getByTestId('record-status-line').first()
  await expect(line).toBeVisible()
  await expect(line).toContainText(rx(lang, key, vars))
}

// ─────────────────────── 3 + screenshots: every cell ──────────────────────

test.describe('matrix: screenshots + no horizontal overflow (3)', () => {
  for (const cell of CELLS) {
    for (const lang of LANGS) {
      test(`${cell.w}x${cell.h} ${lang}`, async ({ page, backend }) => {
        await boot(page, backend, { lang, cell, path: '/books' })

        await waitForList(page, 50)
        await expectNoHorizontalOverflow(page, `list ${cell.w} ${lang}`)
        await shot(page, 'list', cell, lang)

        await openRecord(page, lang, 42)
        await expectNoHorizontalOverflow(page, `record(decide) ${cell.w} ${lang}`)
        await shot(page, 'record', cell, lang)

        await openRecord(page, lang, 45)
        await expectNoHorizontalOverflow(page, `record(approved) ${cell.w} ${lang}`)
        await shot(page, 'record-approved', cell, lang)

        await page.goto('/books/approvals?tab=sent&status=approved')
        await expect(page.locator('[data-book-id]').first()).toBeVisible({ timeout: 20_000 })
        await expectNoHorizontalOverflow(page, `approvals ${cell.w} ${lang}`)
        await shot(page, 'approvals', cell, lang)

        // 11: RTL document + (phone) the dock reads from the inline-end
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
      })
    }
  }

  for (const aa of [19, 24]) {
    test(`1440x900 en at Aa ${aa}: list`, async ({ page, backend }) => {
      await boot(page, backend, { lang: 'en', aa, cell: DESKTOP, path: '/books' })
      await waitForList(page, 50)
      await expectNoHorizontalOverflow(page, `list 1440 Aa ${aa}`)
      await shot(page, 'list', DESKTOP, 'en', aa)
    })
  }
})

// ───────────────────────── 1: approved record ─────────────────────────────

/** Visible switcher entries in DOM order, reduced to a kind. */
async function switcherEntries(page: Page, lang: Lang): Promise<{ kind: string; selected: boolean }[]> {
  const switcher = page.locator('[data-paper-switcher]:visible').first()
  await expect(switcher).toBeVisible({ timeout: 20_000 })
  const patterns: [string, RegExp][] = [
    ['signed', rx(lang, 'books.paper.signed', {}, true)],
    ['original', rx(lang, 'books.paper.original', {}, true)],
    ['scan', rx(lang, 'books.paper.scan', {}, false)],
  ]
  const raw = await switcher.locator('[data-paper-key], [role="tab"], [role="radio"], button').evaluateAll((els) =>
    els.map((el) => {
      const html = el as HTMLElement
      const selected = ['aria-selected', 'aria-pressed', 'aria-checked', 'aria-current'].some(
        (a) => html.getAttribute(a) === 'true',
      ) || ['active', 'on', 'checked'].includes(html.getAttribute('data-state') ?? '')
      return { label: (html.getAttribute('aria-label') ?? html.textContent ?? '').replace(/[\u200e\u200f]/g, '').trim(), selected }
    }),
  )
  const entries: { kind: string; selected: boolean }[] = []
  for (const item of raw) {
    const kind = patterns.find(([, re]) => re.test(item.label))?.[0]
    if (kind) entries.push({ kind, selected: item.selected })
  }
  return entries
}

test.describe('1: approved record', () => {
  for (const lang of LANGS) {
    test(`switcher order, selection, creator meta, title (${lang})`, async ({ page, backend }) => {
      await boot(page, backend, { lang, cell: DESKTOP, path: '/books/45' })
      await waitForRecord(page, lang, 45)
      const spec = specOf(45)

      const entries = await switcherEntries(page, lang)
      expect(entries.map((e) => e.kind), 'Signed copy, Original (unsigned), Scan 1').toEqual(['signed', 'original', 'scan'])
      expect(entries.find((e) => e.selected)?.kind, 'Signed copy is selected').toBe('signed')

      const meta = page.getByTestId('record-meta').first()
      await expect(meta).toBeVisible()
      await expect(meta).toContainText(rx(lang, 'books.record.createdBy'))
      await expect(page.getByTestId('record-creator').first()).toContainText(PEOPLE[spec.by].en)
      // the submitter equals the creator here, so "Submitted by" is not repeated
      await expect(page.getByTestId('record-submitter')).toHaveCount(0)

      await expect(page).toHaveTitle(new RegExp(`^${escapeRe(spec.ref)}`))
    })
  }
})

// ───────────────────────────── 2: header rows ─────────────────────────────

test.describe('2: header rows from 768 up', () => {
  for (const cell of [TABLET, LAPTOP, DESKTOP]) {
    for (const lang of LANGS) {
      test(`${cell.w} ${lang}: ≤2 rows, row A controls share one top`, async ({ page, backend }) => {
        // pending-decide fixture; its Arabic subject is the longest one
        await boot(page, backend, { lang, cell, path: '/books/42' })
        await waitForRecord(page, lang, 42)
        await expect(page.locator('[data-header-row="a"]')).toBeVisible()

        const rows = page.locator('[data-header-row]')
        expect(await rows.count(), '[data-header-row] count').toBeLessThanOrEqual(2)

        const tops = await page.locator('[data-header-row="a"]').evaluate((row) => {
          const heading = row.querySelector('h1')
          // the identity block is the direct child of row A that holds the h1
          let identity: Element | null = heading
          while (identity && identity.parentElement !== row) identity = identity.parentElement
          return [...row.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')]
            .filter((el) => !(identity && identity.contains(el)))
            .filter((el) => {
              const r = el.getBoundingClientRect()
              return r.width > 0 && r.height > 0
            })
            .map((el) => ({ label: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName, top: el.getBoundingClientRect().top }))
        })
        expect(tops.length, 'row A has controls').toBeGreaterThan(0)
        const min = Math.min(...tops.map((t) => t.top))
        const max = Math.max(...tops.map((t) => t.top))
        expect(max - min, `row A control tops: ${JSON.stringify(tops)}`).toBeLessThanOrEqual(4)
      })
    }
  }
})

// ─────────────────────────────── 4: paper width ───────────────────────────

test.describe('4: paper width in Fit mode', () => {
  for (const lang of LANGS) {
    test(`1440 ${lang}: ≈880px`, async ({ page, backend }) => {
      await boot(page, backend, { lang, cell: DESKTOP, path: '/books/42' })
      await waitForRecord(page, lang, 42)
      const width = await paperWidth(page)
      expect(width, `paper width ${width}`).toBeGreaterThanOrEqual(872)
      expect(width, `paper width ${width}`).toBeLessThanOrEqual(888)
    })

    test(`1180 ${lang}: ≈760px or the desk width, whichever is smaller`, async ({ page, backend }) => {
      await boot(page, backend, { lang, cell: LAPTOP, path: '/books/42' })
      await waitForRecord(page, lang, 42)
      const width = await paperWidth(page)
      const deskContent = await page.locator('[data-record-desk]').first().evaluate((el) => {
        const style = getComputedStyle(el)
        return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      })
      const expected = Math.min(760, deskContent)
      expect(Math.abs(width - expected), `paper ${width} vs min(760, desk ${deskContent})`).toBeLessThanOrEqual(8)
    })
  }
})

// ──────────────────────────── 5: phone dock + sheet ───────────────────────

test.describe('5: phone 390', () => {
  for (const lang of LANGS) {
    test(`dock order, More sheet, Delete reason, header (${lang})`, async ({ page, backend }) => {
      await boot(page, backend, { lang, cell: PHONE, path: '/books/48' })

      // no Tools control anywhere on the phone record page
      const tools = (): Locator => page.getByRole('button', { name: rx(lang, 'books.record.tools', {}, true) })

      for (const id of [48, 42, 45] as const) {
        await openRecord(page, lang, id)
        const dock = dockOf(page)
        await expect(dock, `dock for ${specOf(id).kind}`).toBeVisible()
        const controls = dock.locator('button, a[href]')
        const count = await controls.count()
        expect(count, 'dock controls').toBeGreaterThanOrEqual(2)
        // DOM order: More first, the primary last
        await expect(controls.first(), 'More is first in DOM order').toHaveAttribute('data-dock-more', /.*/)
        await expect(controls.last(), 'the primary is last in DOM order').toHaveAttribute('data-dock-primary', /.*/)
        await expect(tools()).toHaveCount(0)

        // the header carries the status line
        const key = id === 48 ? 'books.status.draft' : id === 42 ? 'books.status.pendingMine' : 'books.status.approved'
        await expectStatusLine(page, lang, key, id === 45 ? { name: PEOPLE.ahmed.en } : {})

        if (id === 42) {
          // More exists in decide, and Mark up lives in its sheet
          await controls.first().click()
          const sheet = page.getByRole('dialog').first()
          await expect(sheet).toBeVisible()
          await expect(sheet.getByTestId('record-more-markup')).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(sheet).toBeHidden()
        }
        if (id === 48) {
          await controls.first().click()
          const sheet = page.getByRole('dialog').first()
          await expect(sheet.getByText(rx(lang, 'books.record.deleteDraft', {}, true)).first()).toBeVisible()
          const item = sheetItem(sheet, rx(lang, 'books.record.deleteDraft'))
          await expect(item, 'Delete is enabled for the draft').not.toHaveAttribute('aria-disabled', 'true')
          await page.keyboard.press('Escape')
          await expect(sheet).toBeHidden()
        }
        if (id === 45) {
          await controls.first().click()
          const sheet = page.getByRole('dialog').first()
          const item = sheetItem(sheet, rx(lang, 'books.record.delete'))
          await expect(item, 'Delete is present for approved').toBeVisible()
          await expect(item, 'Delete is disabled for approved').toHaveAttribute('aria-disabled', 'true')
          await expect(sheet.getByText(rx(lang, 'books.reason.inFlight')).first(), 'the reason is visible').toBeVisible()
          await page.keyboard.press('Escape')
          await expect(sheet).toBeHidden()
        }
      }
    })
  }
})

// ───────────────────── 6: delete → Undo / 6 s commit ──────────────────────

const deleteCases: { cell: Cell; lang: Lang }[] = [
  { cell: DESKTOP, lang: 'en' },
  { cell: PHONE, lang: 'ar' },
]

/** From the list, open the draft (id 48) and run Delete → confirm. */
async function deleteDraftFromList(page: Page, lang: Lang, cell: Cell): Promise<void> {
  await waitForList(page, 48)
  await openFromList(page, lang, 48)
  if (isPhone(cell)) {
    await dockOf(page).locator('[data-dock-more]').first().click()
    await sheetItem(page.getByRole('dialog').first(), rx(lang, 'books.record.deleteDraft')).click()
  } else {
    await page.getByRole('button', { name: rx(lang, 'books.record.tools', {}, true) }).first().click()
    await page.getByRole('menuitem', { name: rx(lang, 'books.record.deleteDraft') }).first().click()
  }
  const confirm = page
    .getByRole('dialog')
    .or(page.getByRole('alertdialog'))
    .filter({ hasText: rx(lang, 'books.record.deleteTitle', { ref: specOf(48).ref }) })
    .last()
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button').filter({ hasNotText: rx(lang, 'common.cancel') }).first().click()
}

test.describe('6: delete with Undo and the 6 s commit', () => {
  for (const { cell, lang } of deleteCases) {
    test(`${cell.w} ${lang}: Undo restores, no DELETE`, async ({ page, backend }) => {
      await boot(page, backend, { lang, cell, path: '/books', clock: true })
      await deleteDraftFromList(page, lang, cell)

      // back on the originating list, the row is gone
      await expect(page).toHaveURL(/\/books(\?|$)/)
      await expect(page.locator('[data-records-scroller], [data-ptr-scroller]').first()).toBeVisible()
      await expect(rowOf(page, 48)).toHaveCount(0)
      await expect(page.getByText(rx(lang, 'books.record.deleted', { ref: specOf(48).ref })).first()).toBeVisible()
      // a menu → confirm dialog → navigate flow must not leave Radix's body pointer-events lock behind
      await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none')

      await page.getByRole('button', { name: rx(lang, 'common.undo', {}, true) }).first().click()
      await expect(page.getByText(rx(lang, 'books.record.restored', { ref: specOf(48).ref })).first()).toBeVisible()
      await expect(rowOf(page, 48)).toBeVisible()
      expect(backend.deleteRequests, 'no DELETE right after Undo').toEqual([])

      await elapse(page, COMMIT_MS + 500)
      await page.waitForTimeout(300)
      expect(backend.deleteRequests, 'no DELETE after the commit window either').toEqual([])
      await expect(rowOf(page, 48)).toBeVisible()
    })

    test(`${cell.w} ${lang}: exactly one DELETE after 6 s`, async ({ page, backend }) => {
      await boot(page, backend, { lang, cell, path: '/books', clock: true })
      await deleteDraftFromList(page, lang, cell)

      await expect(page).toHaveURL(/\/books(\?|$)/)
      await expect(rowOf(page, 48)).toHaveCount(0)
      expect(backend.deleteRequests, 'nothing is sent before the window closes').toEqual([])

      await elapse(page, COMMIT_MS + 500)
      await expect.poll(() => backend.deleteRequests.length, { timeout: 15_000 }).toBe(1)
      expect(backend.deleteRequests[0]).toMatch(/^DELETE \/api\/v1\/books\/48$/)
      await page.waitForTimeout(500)
      expect(backend.deleteRequests, 'exactly one DELETE').toHaveLength(1)
      await expect(rowOf(page, 48)).toHaveCount(0)
    })
  }

  test('1440 en: delete from the list pane More menu leaves the page clickable; Undo works', async ({ page, backend }) => {
    await boot(page, backend, { lang: 'en', cell: DESKTOP, path: '/books', clock: true })
    await waitForList(page, 48)
    await rowOf(page, 48).locator('button').first().click()
    const pane = page.locator('[data-records-pane]:visible').first()
    await expect(pane).toContainText(specOf(48).ref)
    await pane.getByRole('button', { name: rx('en', 'books.pane.more', {}, true) }).click()
    await page.getByRole('menuitem', { name: rx('en', 'books.record.deleteDraft') }).first().click()
    const confirm = page
      .getByRole('dialog')
      .or(page.getByRole('alertdialog'))
      .filter({ hasText: rx('en', 'books.record.deleteTitle', { ref: specOf(48).ref }) })
      .last()
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button').filter({ hasNotText: rx('en', 'common.cancel') }).first().click()
    await expect(rowOf(page, 48)).toHaveCount(0)
    await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none')
    await page.getByRole('button', { name: rx('en', 'common.undo', {}, true) }).first().click()
    await expect(rowOf(page, 48)).toBeVisible()
    expect(backend.deleteRequests).toEqual([])
  })
})

// ───────────────────────────────── 7: rail ────────────────────────────────

test.describe('7: record rail', () => {
  for (const lang of LANGS) {
    test(`1440 ${lang}: open (15rem)`, async ({ page, backend }) => {
      await boot(page, backend, { lang, cell: DESKTOP, path: '/books/42' })
      await waitForRecord(page, lang, 42)
      const rail = page.locator('[data-record-rail="open"]')
      await expect(rail).toBeVisible()
      const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
      const width = (await box(rail)).width
      expect(Math.abs(width - 15 * rem), `rail ${width}px vs 15rem=${15 * rem}px`).toBeLessThanOrEqual(8)
      await expect(page.getByRole('button', { name: rx(lang, 'books.record.hideProgress', {}, true) }).first()).toHaveAttribute('aria-expanded', 'true')
    })

    for (const cell of [LAPTOP, TABLET]) {
      test(`${cell.w} ${lang}: 52px strip${cell === LAPTOP ? ', toggle opens the overlay' : ''}`, async ({ page, backend }) => {
        await boot(page, backend, { lang, cell, path: '/books/42' })
        await waitForRecord(page, lang, 42)
        const strip = page.locator('[data-record-rail="strip"]')
        await expect(strip).toBeVisible()
        await expect(page.locator('[data-record-rail="open"]')).toHaveCount(0)
        expect(Math.abs((await box(strip)).width - 52), 'strip width').toBeLessThanOrEqual(4)

        if (cell === LAPTOP) {
          const url = page.url()
          const toggle = page.getByRole('button', { name: rx(lang, 'books.record.showProgress', {}, true) }).first()
          await expect(toggle).toHaveAttribute('aria-expanded', 'false')
          await toggle.click()
          const overlay = page.locator('[data-record-rail="overlay"]')
          await expect(overlay).toBeVisible()
          await expect.poll(async () => (await box(overlay)).width).toBeGreaterThan(270)
          const overlayWidth = (await box(overlay)).width
          expect(Math.abs(overlayWidth - 280), `overlay width ${overlayWidth}`).toBeLessThanOrEqual(8)
          // Esc closes the overlay first (plan §2 precedence) and stays on the record
          await page.keyboard.press('Escape')
          await expect(overlay).toHaveCount(0)
          expect(page.url()).toBe(url)
        }
      })
    }
  }
})

// ───────────────────────────── 8: /books tiers ────────────────────────────

type Tier = 'full' | 'icons' | 'drawer'

async function expectTier(page: Page, tier: Tier, cell: Cell): Promise<void> {
  const rail = page.locator('[data-records-rail]')
  const pane = page.locator('[data-records-pane]')
  await waitForList(page, 50)
  await expect(page.locator('[data-records-page]')).toHaveAttribute('data-tier', tier)
  if (tier === 'drawer') {
    await expect(page.locator('[data-records-rail]:visible'), 'no rail in the drawer tier (it is CSS-hidden)').toHaveCount(0)
    await expect(page.locator('[data-records-pane]:visible'), 'no inline pane before a row is opened').toHaveCount(0)
    const scrollerWidth = (await box(scrollerOf(page))).width
    expect(scrollerWidth, 'full-width list').toBeGreaterThan(cell.w * 0.8)
    // row click opens the drawer
    await rowOf(page, 50).locator('button').first().click()
    const drawer = pane.first()
    await expect(drawer, 'drawer pane opens on row click').toBeVisible()
    await expect(drawer).toHaveAttribute('data-pane-mode', 'drawer')
    await expect(drawer).toContainText(specOf(50).ref)
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
  } else {
    await expect(rail.first()).toHaveAttribute('data-rail-tier', tier)
    const width = (await box(rail.first())).width
    const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
    if (tier === 'full') expect(width, `full rail ${width}px`).toBeGreaterThanOrEqual(11 * rem)
    else expect(width, `icon rail ${width}px`).toBeLessThanOrEqual(5 * rem)
    // an inline pane sits beside the list in both inline tiers
    await expect(pane.first()).toHaveAttribute('data-pane-mode', 'inline')
  }
}

test.describe('8: /books tiers', () => {
  const cases: { cell: Cell; aa: number; tier: Tier }[] = [
    { cell: TABLET, aa: 16, tier: 'drawer' },
    { cell: LAPTOP, aa: 16, tier: 'icons' },
    { cell: DESKTOP, aa: 16, tier: 'full' },
    { cell: DESKTOP, aa: 19, tier: 'icons' },
    { cell: DESKTOP, aa: 24, tier: 'drawer' },
  ]
  for (const { cell, aa, tier } of cases) {
    test(`${cell.w}${aa === 16 ? '' : ` @ Aa ${aa}`} → ${tier}`, async ({ page, backend }) => {
      await boot(page, backend, { lang: 'en', aa, cell, path: '/books' })
      await expectTier(page, tier, cell)
      await expectNoHorizontalOverflow(page, `tier ${tier}`)
    })
  }
})

// ───────────────────── 9: mine=1, J/J/Back, history ───────────────────────

test.describe('9: /books?status=approved&mine=1', () => {
  const cases: { cell: Cell; lang: Lang }[] = [
    { cell: DESKTOP, lang: 'en' },
    { cell: PHONE, lang: 'ar' },
  ]
  for (const { cell, lang } of cases) {
    test(`${cell.w} ${lang}: created_by_me requests; 3rd row, J, J, Back`, async ({ page, backend }) => {
      await boot(page, backend, { lang, cell, path: '/books?status=approved&mine=1' })
      const ids = [...MINE_APPROVED_IDS].sort((a, b) => specOf(a).daysAgo - specOf(b).daysAgo)
      const [, , third, , fifth] = ids as [number, number, number, number, number]
      await waitForList(page, third)

      // list + facets requests carry created_by_me=true; the badge query (facets, mine) is on
      expect(backend.listRequests.length).toBeGreaterThan(0)
      for (const u of backend.listRequests) expect(u.searchParams.get('created_by_me'), u.toString()).toBe('true')
      expect(backend.facetRequests.length).toBeGreaterThan(0)
      for (const u of backend.facetRequests) expect(u.searchParams.get('created_by_me'), u.toString()).toBe('true')
      await expect(scrollerOf(page).locator('[data-book-id]')).toHaveCount(ids.length)

      // Align the 3rd row near the top, so the 5th is on screen without any scrolling: the restored
      // scroll position then has to match what the reader left, not just reveal the current row.
      const scroller = scrollerOf(page)
      await scroller.evaluate((el, id) => {
        const row = el.querySelector<HTMLElement>(`[data-book-id="${id}"]`)
        if (!row) throw new Error('3rd row missing')
        el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - 2
      }, third)
      await page.waitForTimeout(200)
      const before = await scroller.evaluate((el) => el.scrollTop)
      expect(before, 'the list is scrolled before opening a record').toBeGreaterThan(0)
      const preBox = await box(rowOf(page, fifth))
      const preScroll = await box(scroller)
      const expectedAfter = before + Math.max(0, preBox.y + preBox.height - (preScroll.y + preScroll.height))
      const listUrl = new URL(page.url())
      await openFromList(page, lang, third)
      const historyAfterOpen = await page.evaluate(() => window.history.length)

      // (focus stays on the document after the link click, so bare keys reach the record page)
      await page.keyboard.press('KeyJ')
      await waitForRecord(page, lang, ids[3]!)
      await page.keyboard.press('KeyJ')
      await waitForRecord(page, lang, fifth)
      expect(await page.evaluate(() => window.history.length), 'J/K navigate with replace: history did not grow').toBe(historyAfterOpen)

      await backButton(page, lang).click()
      await expect(page).toHaveURL(/\/books\?/)
      const back = new URL(page.url())
      expect(back.pathname).toBe('/books')
      expect(back.searchParams.has('open'), 'the list URL has no `open`').toBe(false)
      expect(back.searchParams.get('status')).toBe(listUrl.searchParams.get('status'))
      expect(back.searchParams.get('mine')).toBe(listUrl.searchParams.get('mine'))

      const row = rowOf(page, fifth)
      await expect(row, 'the current (5th) record is in view').toBeVisible()
      const rowBox = await box(row)
      const scrollBox = await box(scrollerOf(page))
      expect(rowBox.y).toBeGreaterThanOrEqual(scrollBox.y - 8)
      expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(scrollBox.y + scrollBox.height + 8)
      if (!isPhone(cell)) {
        // desktop: the 5th row is selected (aria-current) and the pane shows it
        await expect(row.locator('[aria-current="true"]').first()).toBeVisible()
        await expect(page.locator('[data-records-pane]').first()).toContainText(specOf(fifth).ref)
      }
      const after = await scrollerOf(page).evaluate((el) => el.scrollTop)
      // Restored to the saved scrollY, then revealed minimally (never re-centred): when the 5th row was already
      // fully on screen nothing moves, otherwise the list scrolls just enough to bring its bottom edge in.
      expect(Math.abs(after - expectedAfter), `scroll restored (before ${before}, expected ${expectedAfter}, after ${after})`).toBeLessThanOrEqual(24)

      // no redirect back into the record
      await page.waitForTimeout(700)
      expect(new URL(page.url()).pathname).toBe('/books')
    })
  }

  test('1440 en: the badge query is always on (created_by_me=true even without mine)', async ({ page, backend }) => {
    await boot(page, backend, { lang: 'en', cell: DESKTOP, path: '/books' })
    await waitForList(page, 50)
    await expect.poll(() => backend.facetRequests.some((u) => u.searchParams.get('created_by_me') === 'true')).toBe(true)
    expect(backend.facetRequests.some((u) => !u.searchParams.has('created_by_me')), 'the unfiltered facets query').toBe(true)
    expect(backend.listRequests.every((u) => !u.searchParams.has('created_by_me'))).toBe(true)
  })
})

// ───────────────────────── 10: approvals sort order ───────────────────────

test.describe('10: approvals log', () => {
  test('1440 en: Sent/approved opens on the newest; the dashboard widget links with sort=newest', async ({ page, backend }) => {
    await boot(page, backend, { lang: 'en', cell: DESKTOP, path: '/books/approvals?tab=sent&status=approved' })
    const rows = page.locator('[data-book-id]')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    expect(await rows.first().getAttribute('data-book-id'), 'first row is the newest approved fixture').toBe(String(NEWEST_APPROVED_ID))
    const ids = await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-book-id'))))
    const expected = SPECS.filter((s) => s.state === 'approved').sort((a, b) => a.daysAgo - b.daysAgo).map((s) => s.id)
    expect(ids).toEqual(expected)
    for (const u of backend.approvalLogRequests) expect(u.searchParams.get('sort') ?? 'newest', u.toString()).toBe('newest')

    // dashboard widget → log
    await page.goto('/')
    const link = page.getByTestId('approvals-full-log-link').first()
    await expect(link).toBeVisible({ timeout: 20_000 })
    expect(await link.getAttribute('href')).toContain('sort=newest')
    await link.click()
    await expect(page).toHaveURL(/\/books\/approvals\?/)
    expect(new URL(page.url()).searchParams.get('sort')).toBe('newest')
    await expect(page.locator('[data-book-id]').first()).toBeVisible({ timeout: 20_000 })
    expect(await page.locator('[data-book-id]').first().getAttribute('data-book-id')).toBe(String(NEWEST_PENDING_ME_ID))
  })
})

// ───────────────────────────── 11: RTL specifics ──────────────────────────

test.describe('11: Arabic / RTL', () => {
  for (const lang of LANGS) {
    test(`390 ${lang}: dir=${lang === 'ar' ? 'rtl' : 'ltr'}, dock primary at inline-end`, async ({ page, backend }) => {
      await boot(page, backend, { lang, cell: PHONE, path: '/books/42' })
      await waitForRecord(page, lang, 42)
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
      const dock = dockOf(page)
      await expect(dock).toBeVisible()
      const more = await box(dock.locator('[data-dock-more]').first())
      const primary = await box(dock.locator('[data-dock-primary]').first())
      const moreX = more.x + more.width / 2
      const primaryX = primary.x + primary.width / 2
      // More is first in DOM, so the primary is at inline-end: left in RTL, right in LTR.
      if (lang === 'ar') expect(primaryX, 'AR: primary sits at the inline-end (left of More)').toBeLessThan(moreX)
      else expect(primaryX, 'EN: primary sits at the inline-end (right of More)').toBeGreaterThan(moreX)
    })

    test(`1440 ${lang}: queue chevrons ${lang === 'ar' ? 'are mirrored' : 'are not mirrored'}`, async ({ page, backend }) => {
      await boot(page, backend, { lang, cell: DESKTOP, path: '/books' })
      await openFromList(page, lang, 48)
      const prev = page.getByTestId('queue-prev').first()
      const next = page.getByTestId('queue-next').first()
      await expect(prev).toBeVisible()
      const mirrored = await prev.locator('svg').first().evaluate((svg) => {
        const style = getComputedStyle(svg)
        const matrix = /matrix\(([^,]+),/.exec(style.transform)
        const scaleX = style.scale !== 'none' ? Number(style.scale.split(' ')[0]) : matrix ? Number(matrix[1]) : 1
        return scaleX < 0
      })
      const prevLeftOfNext = (await box(prev)).x < (await box(next)).x
      expect(mirrored, `chevron mirrored in ${lang}`).toBe(lang === 'ar')
      expect(prevLeftOfNext, 'the header flows with the page direction').toBe(lang === 'en')
    })
  }
})

// ─────────────────────────────────── 12: keys ─────────────────────────────

test.describe('12: keys (1440 en)', () => {
  test('? C F Esc Esc 0 S', async ({ page, backend, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await boot(page, backend, { lang: 'en', cell: DESKTOP, path: '/books' })
    await openFromList(page, 'en', 42)
    const spec = specOf(42)
    const recordUrl = page.url()

    // ? → help with a Records section
    await page.keyboard.press('Shift+Slash')
    const help = page.getByRole('dialog').first()
    await expect(help).toBeVisible()
    await expect(help).toContainText(tr('en', 'shortcuts.records.group'))
    await page.keyboard.press('Escape')
    await expect(help).toBeHidden()

    // C → "Copied"
    await page.keyboard.press('KeyC')
    await expect(page.getByText(rx('en', 'books.record.copiedRef', { ref: spec.ref })).first()).toBeVisible()

    // 0 → Fit (after zooming in with =)
    const fit = await paperWidth(page)
    await page.keyboard.press('Equal')
    await page.keyboard.press('Equal')
    await expect.poll(() => paperWidth(page)).toBeGreaterThan(fit + 20)
    await page.keyboard.press('Digit0')
    await expect.poll(() => paperWidth(page)).toBeLessThanOrEqual(fit + 8)
    expect(Math.abs((await paperWidth(page)) - fit)).toBeLessThanOrEqual(8)

    // S → the sign confirm opens; no sign request
    await page.keyboard.press('KeyS')
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).first()
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText(rx('en', 'books.approval.signConfirmTitle'))
    await page.keyboard.press('Escape')
    await expect(confirm).toBeHidden()
    expect(backend.signRequests, 'S only opens the confirm').toEqual([])

    // F → focus; Esc exits focus with the URL unchanged; the second Esc goes Back
    await page.keyboard.press('KeyF')
    await expect(page.locator('[data-record-header="focus"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-record-header="focus"]')).toHaveCount(0)
    expect(page.url(), 'Esc out of focus keeps the URL').toBe(recordUrl)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/books(\?|$)/)
    expect(new URL(page.url()).pathname).toBe('/books')
  })
})
