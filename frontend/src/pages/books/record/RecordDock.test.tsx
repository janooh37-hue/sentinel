/**
 * RecordDock — phone workflow bar + More sheet (record-polish plan S2).
 * Drives the dock with the real `recordNextStep`, so the per-state button sets
 * under test are the ones users get.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookApprovalStepRead, BookRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { RecordDeleteProvider } from '../RecordDeleteProvider'
import { recordNextStep, type NextStepContext } from '../recordNextStep'
import type { RecordActions, RecordCaps, RecordView } from './recordActions'
import { RecordDock } from './RecordDock'

const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }))
vi.mock('sonner', () => ({
  toast: Object.assign(toastFn, { success: vi.fn(), error: vi.fn() }),
}))

const ADMIN_CAPS = [
  'books.edit',
  'books.submit',
  'books.approve',
  'books.delete',
  'books.override_state',
  'documents.scan',
  'documents.generate',
]

const NOW = Date.parse('2026-10-05T12:00:00Z')

function stepOf(over: Partial<BookApprovalStepRead> = {}): BookApprovalStepRead {
  return {
    id: 1,
    step_order: 1,
    stage_label: 'Manager',
    assignee_user_id: 7,
    state: 'pending',
    note: null,
    decided_at: null,
    kind: 'approver',
    assignee_name: 'Khalid',
    ...over,
  }
}

function bookOf(state: string, over: Record<string, unknown> = {}): BookRead {
  const { signedPdfUrl, steps, ...rest } = over as {
    signedPdfUrl?: string | null
    steps?: BookApprovalStepRead[]
  }
  return {
    id: 1,
    ref_number: 'HR-1',
    subject: 'Subject',
    approval_state: state,
    access_scope: 'full',
    voided_at: null,
    edit_session: null,
    submitted_at: '2026-10-03T12:00:00',
    versions: [
      {
        id: 10,
        version_no: 1,
        status: state,
        template_id: 'tpl',
        has_fields: true,
        document_id: 5,
        signed_pdf_url: signedPdfUrl ?? null,
        approval_steps: steps ?? [],
      },
    ],
    ...rest,
  } as unknown as BookRead
}

interface Setup {
  decider?: boolean
  caps?: string[]
  canMark?: boolean
  dockHidden?: boolean
  isMobile?: boolean
  isAr?: boolean
  wordTrigger?: boolean
  canManageSignedPaper?: boolean
}

function mount(book: BookRead, s: Setup = {}) {
  const capList = s.caps ?? ADMIN_CAPS
  const has = (cap: string): boolean => capList.includes(cap)
  const ctx: NextStepContext = {
    has,
    canEdit: has('books.edit'),
    canGenerate: has('documents.generate'),
    canMutateCurrent: true,
    isInmateReporter: false,
    inmateAction: 'read-only',
    isAssignee: Boolean(s.decider),
    isReviewer: false,
    hasDocument: true,
    canManageIncludedPapers: true,
    now: NOW,
    locale: 'en',
  }
  const nextStep = recordNextStep(book, ctx)
  const current = book.versions?.[0]
  const caps = {
    has,
    canEdit: ctx.canEdit,
    canMutateCurrent: true,
    isInmateReporter: false,
    isInmateReport: false,
    canOverrideState: has('books.override_state'),
    canManageRevisionAccess: false,
    canManageIncludedPapers: true,
    canManageSignedPaper: Boolean(s.canManageSignedPaper),
    canRevise: true,
    canMark: Boolean(s.canMark),
    showSendForApproval: true,
    showFileSigned: false,
  } as RecordCaps
  const view = {
    bookId: book.id,
    isMobile: s.isMobile ?? true,
    isAr: Boolean(s.isAr),
    state: book.approval_state,
    busy: false,
    current,
    nextStep,
    dockHidden: Boolean(s.dockHidden),
    recordHasPapers: true,
    emailingRecord: false,
    scanBusy: false,
    armed: false,
    wordReopenTrigger: s.wordTrigger
      ? { label: 'Edit in Word (creates a new version)', icon: null, disabled: true, onClick: vi.fn() }
      : null,
    adjustSigTrigger: null,
  } as unknown as RecordView
  const actions = {
    back: vi.fn(),
    openOverlay: vi.fn(),
    handleRevise: vi.fn(),
    requestSignConfirm: vi.fn(),
    openMobileDecision: vi.fn(),
    submitReport: vi.fn(),
    emailViaOutlook: vi.fn(),
    setUnfileOpen: vi.fn(),
    setArmedFor: vi.fn(),
    mobileDockSignRef: { current: null },
    fileSignedRef: { current: null },
    replaceSignedRef: { current: null },
  } as unknown as RecordActions
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RecordDeleteProvider>
          <RecordDock book={book} caps={caps} view={view} actions={actions} />
        </RecordDeleteProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { actions, view }
}

const dockEl = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-record-dock]')
  if (!el) throw new Error('dock not rendered')
  return el
}
const dockLabels = (): string[] =>
  Array.from(dockEl().children).map((c) => (c.textContent ?? '').trim())

describe('RecordDock', () => {
  beforeEach(async () => {
    toastFn.mockClear()
    await i18n.changeLanguage('en')
  })

  it('renders nothing off the phone', () => {
    mount(bookOf('none'), { isMobile: false })
    expect(document.querySelector('[data-record-dock]')).toBeNull()
  })

  it.each([
    ['draft', bookOf('none'), {}, ['More', 'Continue editing', 'Send for approval']],
    [
      'decide',
      bookOf('pending', { steps: [stepOf()] }),
      { decider: true },
      ['More', 'Return', 'Reject', 'Sign & approve'],
    ],
    [
      'awaiting a signed scan',
      bookOf('awaiting_scan'),
      {},
      ['More', 'Scan signed copy'],
    ],
    [
      'approved with a signed copy',
      bookOf('approved', { signedPdfUrl: '/signed.pdf', steps: [stepOf({ state: 'approved' })] }),
      {},
      ['More', 'Download signed PDF'],
    ],
    ['returned', bookOf('returned', { steps: [stepOf({ state: 'returned' })] }), {}, ['More', 'Revise & resubmit']],
    [
      'waiting on someone else',
      bookOf('pending', { steps: [stepOf({ assignee_user_id: 99 })] }),
      {},
      ['More', 'Change approver…'],
    ],
  ] as Array<[string, BookRead, Setup, string[]]>)(
    '%s: More first, the primary last',
    (_name, book, setup, expected) => {
      mount(book, setup)
      expect(dockLabels()).toEqual(expected)
    },
  )

  it('Word session: More first, labelled Finish editing and Discard draft…', () => {
    mount(bookOf('none', { edit_session: { state: 'active', user_name: 'Sara' } }))
    const dock = within(dockEl())
    expect(dockEl().firstElementChild).toHaveTextContent('More')
    expect(dock.getByRole('button', { name: 'Finish editing' })).toBeVisible()
    expect(dock.getByRole('button', { name: /Discard draft/ })).toBeVisible()
  })

  it.each(['returned', 'approved'])(
    'Word session re-opened on a %s record: Finish editing / Discard draft… are still on the dock',
    (state) => {
      mount(bookOf(state, { edit_session: { state: 'active', user_name: 'Sara' } }))
      const dock = within(dockEl())
      expect(dock.getByRole('button', { name: 'Finish editing' })).toBeVisible()
      expect(dock.getByRole('button', { name: /Discard draft/ })).toBeVisible()
    },
  )

  it('labelled dock buttons are at least 46px tall and the primary grows', () => {
    mount(bookOf('pending', { steps: [stepOf()] }), { decider: true })
    const sign = within(dockEl()).getByRole('button', { name: 'Sign & approve' })
    expect(sign.className).toContain('min-h-[46px]')
    expect(sign.className).toContain('flex-1')
    expect(dockEl().parentElement?.className).toContain('bottom-[calc(5.5rem+var(--safe-bottom))]')
  })

  it('sets the document direction from the language', () => {
    mount(bookOf('none'), { isAr: true })
    expect(dockEl().parentElement).toHaveAttribute('dir', 'rtl')
  })

  it('the sign-area observer hides only the decide buttons, never More', () => {
    mount(bookOf('pending', { steps: [stepOf()] }), { decider: true, dockHidden: true })
    expect(screen.getByRole('button', { name: 'More' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Sign & approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
  })

  it('the decide buttons call the page handlers', async () => {
    const { actions } = mount(bookOf('pending', { steps: [stepOf()] }), { decider: true })
    const dock = within(dockEl())
    await userEvent.click(dock.getByRole('button', { name: 'Reject' }))
    expect(actions.openMobileDecision).toHaveBeenCalledWith('reject')
    await userEvent.click(dock.getByRole('button', { name: 'Sign & approve' }))
    expect(actions.requestSignConfirm).toHaveBeenCalledTimes(1)
  })

  describe('More sheet', () => {
    it('opens from More with the Tools groups', async () => {
      mount(bookOf('none'))
      await userEvent.click(screen.getByRole('button', { name: 'More' }))
      const sheet = await screen.findByRole('dialog', { name: 'More' })
      expect(within(sheet).getByText('Document')).toBeVisible()
      expect(within(sheet).getByRole('button', { name: /Print/ })).toBeVisible()
      expect(within(sheet).getByText('Prints the paper you are viewing')).toBeVisible()
    })

    it('has Mark up for a decider only', async () => {
      const { actions } = mount(bookOf('pending', { steps: [stepOf()] }), { decider: true, canMark: true })
      await userEvent.click(screen.getByRole('button', { name: 'More' }))
      const sheet = await screen.findByRole('dialog')
      await userEvent.click(within(sheet).getByRole('button', { name: /Mark up/ }))
      expect(actions.setArmedFor).toHaveBeenCalledWith(1)
    })

    it('has no Mark up when the viewer is not deciding', async () => {
      mount(bookOf('none'), { canMark: true })
      await userEvent.click(screen.getByRole('button', { name: 'More' }))
      const sheet = await screen.findByRole('dialog')
      expect(within(sheet).queryByRole('button', { name: /Mark up/ })).toBeNull()
    })

    it('Delete is the last row for a draft: confirm schedules the delete and goes back', async () => {
      const { actions } = mount(bookOf('none'))
      await userEvent.click(screen.getByRole('button', { name: 'More' }))
      const sheet = await screen.findByRole('dialog')
      const rows = within(sheet).getAllByRole('button')
      const del = within(sheet).getByRole('button', { name: /Delete draft/ })
      expect(rows[rows.length - 1]).toBe(del)

      await userEvent.click(del)
      const confirm = await screen.findByRole('dialog', { name: /Delete record/ })
      expect(within(confirm).getByText(/Delete record/)).toBeVisible()
      await userEvent.click(within(confirm).getByRole('button', { name: 'Delete draft' }))

      expect(actions.back).toHaveBeenCalledTimes(1)
      expect(toastFn).toHaveBeenCalledWith(expect.stringContaining('deleted'), expect.anything())
    })

    it('shows why Delete is unavailable, as text, and does not act on it', async () => {
      const { actions } = mount(bookOf('pending', { steps: [stepOf()] }))
      await userEvent.click(screen.getByRole('button', { name: 'More' }))
      const sheet = await screen.findByRole('dialog')
      const del = within(sheet).getByRole('button', { name: /Delete record/ })
      expect(del).toHaveAttribute('aria-disabled', 'true')
      expect(within(sheet).getByText(/In-flight or signed records/)).toBeVisible()
      await userEvent.click(del)
      expect(screen.queryByRole('dialog', { name: /Delete record/ })).toBeNull()
      expect(actions.back).not.toHaveBeenCalled()
    })

    it('shows the Edit in Word reason inline on a phone', async () => {
      mount(bookOf('returned', { steps: [stepOf({ state: 'returned' })] }), { wordTrigger: true })
      await userEvent.click(screen.getByRole('button', { name: 'More' }))
      const sheet = await screen.findByRole('dialog')
      expect(
        within(sheet).getByText('Editing in Word needs a PC with Word installed'),
      ).toBeVisible()
      expect(within(sheet).getByRole('button', { name: /Edit in Word/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    })
  })
})
