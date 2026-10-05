/**
 * The record desk's paper model (plan S3): signed-first default, the `?paper=`
 * selection (read, and written with `replace`), no switcher for one paper, the
 * inmate-reporter filter, and the Word banner / live-draft gating.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookRead } from '@/lib/api'
import { RecordChromeProvider } from './RecordChrome'
import { RecordDesk } from './RecordDesk'
import type { RecordActions, RecordCaps, RecordView } from './recordActions'

vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: ({ pdfUrl }: { pdfUrl: string }) => <div data-testid="doc-pdf-canvas" data-url={pdfUrl} />,
}))

const SIGNED_URL = '/api/v1/documents/10/signed'
const ORIGINAL_URL = '/api/v1/documents/10/download?format=pdf&original=true'

function makeBook(overrides: Record<string, unknown> = {}): BookRead {
  return {
    id: 1,
    ref_number: 'GS-0001',
    approval_state: 'approved',
    access_scope: 'full',
    attachment_paths: ['vault/scan-a.pdf'],
    imported_doc: null,
    edit_session: null,
    voided_at: null,
    versions: [
      {
        id: 5,
        version_no: 1,
        status: 'approved',
        document_id: 10,
        signed_pdf_url: SIGNED_URL,
        docx_url: null,
        approval_steps: [],
      },
    ],
    ...overrides,
  } as unknown as BookRead
}

function makeCaps(overrides: Partial<RecordCaps> = {}): RecordCaps {
  return { isInmateReporter: false, canEdit: true, canRevise: false, ...overrides } as RecordCaps
}

function makeView(book: BookRead, overrides: Partial<RecordView> = {}): RecordView {
  const version = book.versions?.[book.versions.length - 1]
  return {
    bookId: book.id,
    isMobile: false,
    isAr: false,
    isPending: false,
    state: book.approval_state ?? 'none',
    action: 'none',
    decision: null,
    busy: false,
    current: version,
    liveVersion: version,
    currentSteps: [{ state: 'approved', decided_at: '2026-08-01T09:00:00Z' }],
    pdfUrl: null,
    userId: 1,
    armed: false,
    annotatable: false,
    annMode: 'view',
    annotations: [],
    markBusy: false,
    pendingAct: null,
    decisionReasonFormProps: {},
    ...overrides,
  } as unknown as RecordView
}

const actions = {
  setArmedFor: vi.fn(),
  handleRevise: vi.fn(),
  requestSignConfirm: vi.fn(),
  openMobileDecision: vi.fn(),
  createMark: vi.fn(),
  deleteMark: vi.fn(),
  onPdfReady: vi.fn(),
  mobileInlineSignRef: { current: null },
  decisionPanelRef: { current: null },
  panelReturnButtonRef: { current: null },
  panelRejectButtonRef: { current: null },
} as unknown as RecordActions

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  const navType = useNavigationType()
  return (
    <>
      <output data-testid="loc">{`${location.pathname}${location.search}|${navType}`}</output>
      <output data-testid="loc-state">{JSON.stringify(location.state)}</output>
    </>
  )
}

function renderDesk(
  book: BookRead,
  {
    caps = makeCaps(),
    view = makeView(book),
    url = '/books/1',
    state = undefined as unknown,
  } = {},
): void {
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: url.split('?')[0],
          search: url.includes('?') ? `?${url.split('?')[1]}` : '',
          state,
        },
      ]}
    >
      <RecordChromeProvider>
        <RecordDesk book={book} caps={caps} view={view} actions={actions} />
        <LocationProbe />
      </RecordChromeProvider>
    </MemoryRouter>,
  )
}

function switcher(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-paper-switcher]')
}

beforeEach(() => {
  localStorage.clear()
})

describe('RecordDesk papers', () => {
  it('opens an approved record on the Signed copy, switcher ordered signed → original → scan', async () => {
    renderDesk(makeBook())

    const names = within(switcher()!)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(names).toEqual(['Signed copy', 'Original (unsigned)', 'Scan 1'])
    expect(within(switcher()!).getByRole('button', { name: 'Signed copy' })).toHaveAttribute('aria-pressed', 'true')
    expect((await screen.findByTestId('doc-pdf-canvas')).dataset.url).toBe(SIGNED_URL)
    // the signed copy says when it was signed, in words
    // (rendered in the toolbar and in the phone row; CSS shows one per breakpoint)
    expect(screen.getAllByText(/Signed copy ·/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^\d{4}-\d{2}-\d{2}$/, { selector: 'bdi' }).length).toBeGreaterThan(0)
  })

  it('keeps the record nav state (queue / Back target) when a paper is picked', async () => {
    const user = userEvent.setup()
    const navState = { from: '/books?status=pending', queue: [1, 2, 3], scrollY: 120 }
    renderDesk(makeBook(), { url: '/books/1?paper=generated', state: navState })
    await screen.findByTestId('doc-pdf-canvas')
    await user.click(within(switcher()!).getByRole('button', { name: 'Signed copy' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('paper=signed|REPLACE')
    expect(JSON.parse(screen.getByTestId('loc-state').textContent ?? 'null')).toEqual(navState)
  })

  it('honours ?paper= and writes a pick back with replace, leaving other params alone', async () => {
    const user = userEvent.setup()
    renderDesk(makeBook(), { url: '/books/1?paper=generated&from=list' })

    expect((await screen.findByTestId('doc-pdf-canvas')).dataset.url).toBe(ORIGINAL_URL)
    expect(within(switcher()!).getByRole('button', { name: 'Original (unsigned)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('loc')).toHaveTextContent('/books/1?paper=generated&from=list|POP')

    await user.click(within(switcher()!).getByRole('button', { name: 'Signed copy' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/books/1?paper=signed&from=list|REPLACE')
    expect((await screen.findByTestId('doc-pdf-canvas')).dataset.url).toBe(SIGNED_URL)
  })

  it('falls back to the default paper for a key that is not on the list', async () => {
    renderDesk(makeBook(), { url: '/books/1?paper=scan-9' })
    expect((await screen.findByTestId('doc-pdf-canvas')).dataset.url).toBe(SIGNED_URL)
  })

  it('shows no switcher for a single paper', async () => {
    const book = makeBook({
      approval_state: 'pending',
      attachment_paths: [],
      versions: [
        { id: 5, version_no: 1, status: 'pending', document_id: 10, signed_pdf_url: null, approval_steps: [] },
      ],
    })
    renderDesk(book, { view: makeView(book, { state: 'pending' }) })

    expect(await screen.findByTestId('doc-pdf-canvas')).toBeInTheDocument()
    expect(switcher()).toBeNull()
    // …but the one paper is still named, with its state caption
    expect(screen.getAllByText('Original (unsigned)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unsigned — awaiting signature').length).toBeGreaterThan(0)
  })

  it('never offers scans or an original=true paper to an inmate reporter', async () => {
    renderDesk(makeBook(), { caps: makeCaps({ isInmateReporter: true }) })

    // signed only: one paper, so no switcher, and the viewer shows the signed copy
    expect(switcher()).toBeNull()
    expect((await screen.findByTestId('doc-pdf-canvas')).dataset.url).toBe(SIGNED_URL)
    expect(screen.queryByText('Scan 1')).not.toBeInTheDocument()
  })

  it('pins an older revision to just that revision’s document', async () => {
    const book = makeBook()
    const older = { ...book.versions![0], version_no: 1 }
    const live = { ...older, id: 6, version_no: 2, signed_pdf_url: null, status: 'pending' }
    const withTwo = makeBook({ approval_state: 'pending', versions: [older, live] })
    renderDesk(withTwo, {
      view: makeView(withTwo, { current: older as never, liveVersion: live as never, pdfUrl: '/old.pdf' }),
    })

    expect((await screen.findByTestId('doc-pdf-canvas')).dataset.url).toBe('/old.pdf')
    expect(switcher()).toBeNull()
  })
})

describe('RecordDesk Word banner', () => {
  const session = {
    user_id: 7,
    user_name: 'Operator',
    state: 'active',
    last_put_at: '2026-08-01T09:30:00Z',
    created_at: '2026-08-01T09:00:00Z',
  }
  function wordBook(overrides: Record<string, unknown> = {}): BookRead {
    return makeBook({
      approval_state: 'none',
      attachment_paths: [],
      edit_session: session,
      versions: [
        { id: 5, version_no: 1, status: 'draft', document_id: 10, signed_pdf_url: null, approval_steps: [] },
      ],
      ...overrides,
    })
  }

  it('shows the banner to everyone but the live-draft toggle only to editors with full access', () => {
    const book = wordBook()
    const { unmount } = render(
      <MemoryRouter>
        <RecordChromeProvider>
          <RecordDesk
            book={book}
            caps={makeCaps({ canEdit: false })}
            view={makeView(book, { state: 'none' })}
            actions={actions}
          />
        </RecordChromeProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('note')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show live draft' })).not.toBeInTheDocument()
    unmount()

    const restricted = wordBook({ access_scope: 'assigned_revision' })
    renderDesk(restricted, { view: makeView(restricted, { state: 'none' }) })
    expect(screen.getByRole('note')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show live draft' })).not.toBeInTheDocument()
  })

  it('swaps the desk to the live draft only on request, and back', async () => {
    const user = userEvent.setup()
    const book = wordBook()
    renderDesk(book, { view: makeView(book, { state: 'none' }) })

    // saved version first — the live preview is never fetched on its own
    expect((await screen.findByTestId('doc-pdf-canvas')).dataset.url).toContain('/api/v1/documents/10/download')

    await user.click(screen.getByRole('button', { name: 'Show live draft' }))
    const live = await screen.findByTestId('doc-pdf-canvas')
    expect(live.dataset.url).toContain('/books/1/word-sessions/preview?ts=')
    expect(screen.getAllByText('Live draft').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Show saved version' }))
    expect((await screen.findByTestId('doc-pdf-canvas')).dataset.url).toContain('/api/v1/documents/10/download')
  })

  it('returns to a saved paper when the switcher is used while the live draft is on', async () => {
    const user = userEvent.setup()
    const book = wordBook({ attachment_paths: ['vault/scan-a.pdf'] })
    renderDesk(book, { view: makeView(book, { state: 'none' }) })

    await user.click(screen.getByRole('button', { name: 'Show live draft' }))
    expect((await screen.findByTestId('doc-pdf-canvas')).dataset.url).toContain('/word-sessions/preview')

    await user.click(within(switcher()!).getByRole('button', { name: 'Scan 1' }))
    expect(screen.getByTestId('doc-pdf-canvas').dataset.url).not.toContain('/word-sessions/preview')
    expect(screen.getByRole('button', { name: 'Show live draft' })).toBeInTheDocument()
  })

  it('offers Expand only while the desk shows a saved paper, never the live draft', async () => {
    const user = userEvent.setup()
    const book = wordBook()
    renderDesk(book, { view: makeView(book, { state: 'none' }) })

    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show live draft' }))
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument()
  })

  it('offers no Expand when there is no paper at all', () => {
    const book = wordBook({
      versions: [{ id: 5, version_no: 1, status: 'draft', document_id: null, signed_pdf_url: null, approval_steps: [] }],
    })
    renderDesk(book, { view: makeView(book, { state: 'none' }) })
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument()
  })
})

describe('RecordDesk zoom', () => {
  it('ignores a stored numeric zoom for an image scan, which has no zoom controls', async () => {
    localStorage.setItem('gssg.books.record.zoom', JSON.stringify(3))
    const book = makeBook({ attachment_paths: ['vault/scan-a.png'] })
    renderDesk(book, { url: '/books/1?paper=scan-0' })

    expect(await screen.findByRole('img')).toBeInTheDocument()
    const paper = document.querySelector<HTMLElement>('[data-record-paper]')!
    expect(paper.style.width).toBe('100%')
  })

  it('still applies the stored zoom to a PDF', async () => {
    localStorage.setItem('gssg.books.record.zoom', JSON.stringify(2))
    renderDesk(makeBook())
    await screen.findByTestId('doc-pdf-canvas')
    expect(document.querySelector<HTMLElement>('[data-record-paper]')!.style.width).toBe('1588px')
  })
})
