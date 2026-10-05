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

import type { BookRead } from '@/lib/api'

import { RecordPane } from './RecordPane'

const scheduleDelete = vi.hoisted(() => vi.fn())
const getBook = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, getBook, listTemplates: vi.fn().mockResolvedValue({ items: [] }) } }
})
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 7, role: 'admin' } }) }))
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
    created_by_g: 'G1234',
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
    getBook.mockReset()
    getBook.mockRejectedValue(new Error('no detail'))
  })

  it('shows the primary and one secondary as labelled buttons, and Open record as a link — for a draft too', async () => {
    renderPane(makeBook())
    expect(await screen.findByRole('button', { name: 'Send for approval' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue editing' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open full record' })).toHaveAttribute('href', '/books/1')
  })

  it('shows who created the record', async () => {
    renderPane(makeBook())
    const meta = (await screen.findByText(/Created by/)).closest('p')!
    expect(within(meta).getByText('Sara').tagName).toBe('BDI')
    expect(within(meta).getByText('G1234')).toBeInTheDocument()
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
          {
            id: 11,
            version_no: 1,
            document_id: 5,
            status: 'approved',
            signed_pdf_url: '/api/v1/books/1/signed',
            signed_source: 'in_app',
            approval_steps: [],
          },
        ],
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: /More/ }))
    const item = await screen.findByRole('menuitem', { name: /Delete record/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')

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
    expect(await screen.findByText(/Signed · /)).toBeInTheDocument()
    expect(screen.queryByText(/Signed by/)).not.toBeInTheDocument()
  })

  it('uses the detail record for the signer name when the list row lacks it', async () => {
    getBook.mockResolvedValue(signedRow('Ahmed'))
    renderPane(signedRow(null))
    expect(await screen.findByText(/Signed by/)).toHaveTextContent('Ahmed')
  })
})
