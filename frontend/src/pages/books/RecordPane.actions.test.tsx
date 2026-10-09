/**
 * RecordPane footer: at most two labelled workflow buttons (from
 * `recordNextStep`), "Open record" as a real link — drafts included — and the
 * More menu with the guarded, deferred Delete.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from 'i18next'
import type { BookRead } from '@/lib/api'

import { RecordPane } from './RecordPane'

const scheduleDelete = vi.hoisted(() => vi.fn())
const getBook = vi.hoisted(() => vi.fn())
const gates = vi.hoisted(() => ({ caps: new Set<string>(), role: 'admin' }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, getBook, listTemplates: vi.fn().mockResolvedValue({ items: [] }) } }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => gates.caps.has(cap) || gates.caps.has('*') }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 7, role: gates.role } }) }))
vi.mock('./RecordDeleteProvider', () => ({
  useRecordDelete: () => ({ scheduleDelete, pendingIds: new Set<number>() }),
}))
vi.mock('./RecordPaperViewer', () => ({ default: () => <div data-testid="viewer" /> }))

function makeBook(over: Record<string, unknown> = {}): BookRead {
  return {
    id: 1,
    ref_number: 'GS-0001',
    subject: 'Leave request',
    created_at: '2026-07-17T10:00:00',
    service_id: 'General Book',
    approval_state: 'none',
    classification_code: null,
    voided_at: null,
    is_draft: false,
    is_word_book: false,
    edit_session: null,
    signing_path: null,
    access_scope: 'full',
    created_by_name: 'Sara',
    created_by_g: null,
    approval_steps: [],
    attachment_paths: [],
    imported_doc: null,
    versions: [
      { id: 11, version_no: 1, document_id: 5, status: 'draft', signed_pdf_url: null, approval_steps: [] },
    ],
    ...over,
  } as unknown as BookRead
}

const onDeleted = vi.fn()

function renderPane(book: BookRead): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RecordPane
          book={book}
          mode="inline"
          size="normal"
          onSizeChange={vi.fn()}
          nav={() => ({ from: '/books', queue: [book.id], scrollY: 0 })}
          onContinueDraft={vi.fn()}
          onSubmit={vi.fn()}
          onSelectBook={vi.fn()}
          onAddToEmail={vi.fn()}
          onDeleted={onDeleted}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RecordPane footer', () => {
  beforeEach(() => {
    scheduleDelete.mockClear()
    onDeleted.mockClear()
    gates.caps = new Set(['*'])
    gates.role = 'admin'
    getBook.mockReset()
    getBook.mockRejectedValue(new Error('no detail'))
  })

  it('shows the primary and one secondary as labelled buttons, and Open record as a link — for a draft too', async () => {
    renderPane(makeBook())
    expect(await screen.findByRole('button', { name: 'Send for approval' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue editing' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open full record' })).toHaveAttribute('href', '/books/1')
  })

  it('shows who created the record, with the G-number from the detail (list rows carry none)', async () => {
    getBook.mockResolvedValue(makeBook({ created_by_g: 'G1234' }))
    renderPane(makeBook())
    const meta = (await screen.findByText(/Created by/)).closest('p')!
    expect(within(meta).getByText('Sara').tagName).toBe('BDI')
    expect(await within(meta).findByText('G1234')).toBeInTheDocument()
  })

  it('renders the returner note through Quote, not a bare <q>', async () => {
    const steps = [
      { id: 1, kind: 'approver', state: 'returned', assignee_name: 'Ahmed', decided_at: '2026-10-02T09:00:00', note: 'fix the dates' },
    ]
    renderPane(
      makeBook({
        approval_state: 'returned',
        approval_steps: steps,
        versions: [{ id: 11, version_no: 1, document_id: 5, status: 'returned', signed_pdf_url: null, approval_steps: steps }],
      }),
    )
    const note = await screen.findByText('fix the dates')
    expect(note.tagName).toBe('BDI')
    expect(note.parentElement).toHaveTextContent('“fix the dates”')
    expect(note.closest('q')).toBeNull()
  })

  it('deletes a draft from More after a confirm, deferred through scheduleDelete', async () => {
    renderPane(makeBook())
    await userEvent.click(await screen.findByRole('button', { name: /More/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete draft' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('GS-0001')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }))

    expect(scheduleDelete).toHaveBeenCalledWith([{ id: 1, ref: 'GS-0001' }])
    expect(onDeleted).toHaveBeenCalledWith(1)
  })

  it('keeps Delete visible but disabled, with the reason, once the record is signed', async () => {
    renderPane(
      makeBook({
        approval_state: 'approved',
        versions: [
          { id: 11, version_no: 1, document_id: 5, status: 'approved', signed_pdf_url: '/api/v1/books/1/signed', signed_source: 'in_app', approval_steps: [] },
        ],
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: /More/ }))
    const item = await screen.findByRole('menuitem', { name: /Delete record/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent(
      i18n.t('books.reason.inFlight', { action: i18n.t('books.stateOverride.trigger') }),
    )

    await userEvent.click(item)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(scheduleDelete).not.toHaveBeenCalled()
  })

  const signedRow = (assignee_name: string | null): BookRead =>
    makeBook({
      approval_state: 'approved',
      versions: [
        {
          id: 11,
          version_no: 1,
          document_id: 5,
          status: 'approved',
          signed_pdf_url: '/api/v1/books/1/signed',
          signed_source: 'in_app',
          approval_steps: [
            { id: 1, kind: 'approver', state: 'approved', assignee_name, decided_at: '2026-10-02T09:00:00' },
          ],
        },
      ],
      approval_steps: [
        { id: 1, kind: 'approver', state: 'approved', assignee_name, decided_at: '2026-10-02T09:00:00' },
      ],
    })

  it('never renders a dangling "by ·" when the row carries no approver name', async () => {
    renderPane(signedRow(null))
    expect(await screen.findByText(/Signed ·/)).toBeInTheDocument()
    expect(screen.queryByText(/Signed by/)).not.toBeInTheDocument()
  })

  it('uses the detail record for the signer name when the list row lacks it', async () => {
    getBook.mockResolvedValue(signedRow('Ahmed'))
    renderPane(signedRow(null))
    expect(await screen.findByText(/Signed by/)).toHaveTextContent('Ahmed')
  })

  describe('Delete gates', () => {
    async function openMore(): Promise<void> {
      await userEvent.click(await screen.findByRole('button', { name: /More/ }))
    }

    it('hides Delete without books.delete', async () => {
      gates.caps = new Set(['books.read'])
      renderPane(makeBook())
      await openMore()
      expect(screen.queryByRole('menuitem', { name: /Delete/ })).not.toBeInTheDocument()
    })

    it('hides Delete for an inmate reporter', async () => {
      gates.role = 'inmate_reporter'
      renderPane(makeBook())
      await screen.findByRole('link', { name: 'Open full record' })
      const more = screen.queryByRole('button', { name: /More/ })
      if (more) await userEvent.click(more)
      expect(screen.queryByRole('menuitem', { name: /Delete/ })).not.toBeInTheDocument()
    })

    it('hides Delete when access_scope is not full', async () => {
      renderPane(makeBook({ access_scope: 'limited' }))
      await openMore()
      expect(screen.queryByRole('menuitem', { name: /Delete/ })).not.toBeInTheDocument()
    })

    it('blocks Delete with the Word-session reason during a live edit session', async () => {
      renderPane(makeBook({ is_word_book: true, edit_session: { state: 'active' } }))
      await openMore()
      const item = await screen.findByRole('menuitem', { name: /Delete/ })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).toHaveTextContent(i18n.t('books.reason.wordSession'))
      await userEvent.click(item)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(scheduleDelete).not.toHaveBeenCalled()
    })
  })
})
