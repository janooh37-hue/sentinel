/**
 * RecordPane — which paper the viewer opens on, and when that choice resets:
 * an approved in-app signed record opens on the signed copy; an explicit pick
 * survives re-renders of the same record but is dropped when the record's state
 * or paper set changes (same id) or another record is selected.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookRead } from '@/lib/api'

import { RecordPane } from './RecordPane'
import { RecordDeleteProvider } from './RecordDeleteProvider'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, getBook: vi.fn().mockRejectedValue(new Error('no detail')), listTemplates: vi.fn().mockResolvedValue({ items: [] }) } }
})
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 7, role: 'admin' } }) }))

interface ViewerProps {
  papers: { kind: string; attachmentIndex?: number }[]
  selectedKey: string | null
  onSelectKey: (key: string) => void
  mode: string
}
// The real viewer pulls pdf.js; the pane's contract with it is (papers, selectedKey, onSelectKey).
vi.mock('./RecordPaperViewer', () => ({
  default: ({ papers, selectedKey, onSelectKey, mode }: ViewerProps) => (
    <div data-testid={`viewer-${mode}`} data-selected={selectedKey ?? ''}>
      <span data-testid="keys">
        {papers.map((p) => (p.kind === 'scan' ? `scan-${p.attachmentIndex}` : p.kind)).join(',')}
      </span>
      <button type="button" onClick={() => onSelectKey('scan-0')}>
        pick-scan
      </button>
    </div>
  ),
}))

function makeBook(over: Record<string, unknown> = {}): BookRead {
  return {
    id: 1,
    ref_number: 'GS-0001',
    subject: 'Leave request',
    created_at: '2026-07-17T10:00:00',
    service_id: 'General Book',
    approval_state: 'approved',
    classification_code: null,
    voided_at: null,
    is_draft: false,
    is_word_book: false,
    edit_session: null,
    signing_path: 'in_app',
    access_scope: 'full',
    created_by_name: 'Sara',
    approval_steps: [],
    attachment_paths: ['scans/a.pdf'],
    imported_doc: null,
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
    ...over,
  } as unknown as BookRead
}

function pane(book: BookRead): React.JSX.Element {
  return (
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
      onDeleted={vi.fn()}
    />
  )
}

function renderPane(book: BookRead): (next: BookRead) => void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (b: BookRead): React.JSX.Element => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RecordDeleteProvider>{pane(b)}</RecordDeleteProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  const view = render(wrap(book))
  return (next) => view.rerender(wrap(next))
}

const selected = async (): Promise<string | null> =>
  (await screen.findByTestId('viewer-pane')).getAttribute('data-selected')

describe('RecordPane default paper', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('opens an approved in-app signed record on the signed copy, ahead of the original and scans', async () => {
    renderPane(makeBook())
    expect(await selected()).toBe('signed')
    expect(screen.getByTestId('keys')).toHaveTextContent('signed,generated,scan-0')
  })

  it('keeps an explicit pick across re-renders of the same record', async () => {
    const rerender = renderPane(makeBook())
    await userEvent.click(await screen.findByRole('button', { name: 'pick-scan' }))
    expect(await selected()).toBe('scan-0')

    rerender(makeBook()) // same id, state and papers: a refetch, not a change
    expect(await selected()).toBe('scan-0')
  })

  it('re-picks the default when the same record changes state', async () => {
    const pending = makeBook({
      approval_state: 'pending',
      versions: [
        { id: 11, version_no: 1, document_id: 5, status: 'pending', signed_pdf_url: null, approval_steps: [] },
      ],
    })
    const rerender = renderPane(pending)
    expect(await selected()).toBe('generated')
    await userEvent.click(screen.getByRole('button', { name: 'pick-scan' }))
    expect(await selected()).toBe('scan-0')

    rerender(makeBook()) // same id 1, now approved with a signed copy
    expect(await selected()).toBe('signed')
  })

  it('re-picks the default when another record is selected', async () => {
    const rerender = renderPane(makeBook())
    await userEvent.click(await screen.findByRole('button', { name: 'pick-scan' }))
    expect(await selected()).toBe('scan-0')

    rerender(makeBook({ id: 2, ref_number: 'GS-0002' }))
    expect(await selected()).toBe('signed')
  })
})
