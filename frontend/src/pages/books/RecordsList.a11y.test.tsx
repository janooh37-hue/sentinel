/**
 * RecordsList — row structure: the checkbox is its own labelled control (never
 * nested in the select button), the ref is a real link carrying the list's nav
 * state, the creator renders (or "Not recorded"), Enter on a row opens it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi, type Mock } from 'vitest'

import type { BookRead } from '@/lib/api'

import { RecordsList } from './RecordsList'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, listTemplates: vi.fn().mockResolvedValue({ items: [] }) } }
})

function makeBook(id: number, over: Partial<BookRead> = {}): BookRead {
  return {
    id,
    ref_number: `GS-000${id}`,
    subject: 'موضوع عام',
    created_at: '2026-07-17T10:00:00',
    service_id: 'General Book',
    approval_state: 'pending',
    classification_code: null,
    voided_at: null,
    is_draft: false,
    edit_session: null,
    signing_path: null,
    versions: [],
    attachment_paths: [],
    imported_doc: null,
    created_by_name: null,
    ...over,
  } as unknown as BookRead
}

function Probe(): React.JSX.Element {
  const location = useLocation()
  return (
    <output data-testid="loc">
      {location.pathname}|{JSON.stringify(location.state)}
    </output>
  )
}

function setup(
  rows: BookRead[],
  props: Partial<React.ComponentProps<typeof RecordsList>> = {},
): { onSelect: Mock; onToggleSelect: Mock } {
  const onSelect = vi.fn()
  const onToggleSelect = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/books?status=pending&open=1']}>
        <RecordsList
          rows={rows}
          selectedId={null}
          onSelect={onSelect}
          selected={new Set()}
          onToggleSelect={onToggleSelect}
          nav={(scrollY = 0) => ({
            from: '/books?status=pending&open=1',
            queue: rows.map((row) => row.id),
            scrollY,
          })}
          isInmateReporter={false}
          {...props}
        />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onSelect, onToggleSelect }
}

const rowOf = (id: number): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[data-book-id="${id}"]`)
  if (!row) throw new Error(`no row ${id}`)
  return row
}

describe('RecordsList row a11y', () => {
  it('keeps the checkbox out of the select button and labels it with the ref', async () => {
    const { onSelect, onToggleSelect } = setup([makeBook(1)])
    const checkbox = screen.getByRole('checkbox', { name: /^Select \u2068GS-0001\u2069$/ })
    expect(checkbox.closest('button')).toBeNull()

    await userEvent.click(checkbox)
    expect(onToggleSelect).toHaveBeenCalledWith(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('advertises Enter only on the selected row link, without remounting it on selection change', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const nav = (scrollY = 0) => ({ from: '/books', queue: [1, 2], scrollY })
    const tree = (selectedId: number): React.JSX.Element => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/books']}>
          <RecordsList
            rows={[makeBook(1), makeBook(2)]}
            selectedId={selectedId}
            onSelect={vi.fn()}
            selected={new Set()}
            onToggleSelect={vi.fn()}
            nav={nav}
            isInmateReporter={false}
          />
        </MemoryRouter>
      </QueryClientProvider>
    )
    const { rerender } = render(tree(1))
    const link1 = within(rowOf(1)).getByRole('link', { name: 'GS-0001' })
    const link2 = within(rowOf(2)).getByRole('link', { name: 'GS-0002' })
    expect(link1).toHaveAttribute('aria-keyshortcuts', 'Enter')
    expect(link2).not.toHaveAttribute('aria-keyshortcuts')

    rerender(tree(2))
    expect(within(rowOf(1)).getByRole('link', { name: 'GS-0001' })).toBe(link1)
    expect(within(rowOf(2)).getByRole('link', { name: 'GS-0002' })).toBe(link2)
    expect(link1).not.toHaveAttribute('aria-keyshortcuts')
    expect(link2).toHaveAttribute('aria-keyshortcuts', 'Enter')
  })

  it('renders the ref as a link to the record that carries the list nav state', async () => {
    setup([makeBook(1), makeBook(2)])
    const link = within(rowOf(2)).getByRole('link', { name: 'GS-0002' })
    expect(link).toHaveAttribute('href', '/books/2')

    await userEvent.click(link)
    const [path, state] = screen.getByTestId('loc').textContent!.split('|')
    expect(path).toBe('/books/2')
    // `open` is stripped from `from`; the queue is the displayed order.
    expect(JSON.parse(state)).toEqual({ from: '/books?status=pending', queue: [1, 2], scrollY: 0 })
  })

  it('selects on a row click without navigating, and opens on Enter', async () => {
    const { onSelect } = setup([makeBook(1)])
    const button = within(rowOf(1)).getByRole('button')

    await userEvent.click(button)
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(screen.getByTestId('loc').textContent).toMatch(/^\/books\|/)

    fireEvent.keyDown(button, { key: 'Enter' })
    const [path, state] = screen.getByTestId('loc').textContent!.split('|')
    expect(path).toBe('/books/1')
    expect(JSON.parse(state)).toMatchObject({ from: '/books?status=pending', queue: [1] })
  })

  it('shows who created each record, or "Not recorded"', () => {
    setup([makeBook(1, { created_by_name: 'Sara Al-Mansoori' }), makeBook(2)])
    const named = within(rowOf(1)).getByText('Sara Al-Mansoori')
    expect(named.tagName).toBe('BDI')
    expect(within(rowOf(1)).getByText('Created by', { exact: false })).toHaveClass('sr-only')
    expect(within(rowOf(2)).getByText('Not recorded')).toBeInTheDocument()
  })

  it('marks the scroller and the rows for return-focus and e2e hooks', () => {
    setup([makeBook(1)])
    expect(document.querySelector('[data-records-scroller]')).toContainElement(rowOf(1))
  })

  it('shows the page-provided empty state when there are no rows', () => {
    setup([], { empty: <p>nothing here</p> })
    expect(screen.getByText('nothing here')).toBeInTheDocument()
  })

  describe('paper count', () => {
    const signedWithScans = (): BookRead =>
      makeBook(1, {
        approval_state: 'approved',
        versions: [
          { version_no: 1, document_id: 5, status: 'approved', signed_pdf_url: '/signed.pdf' },
        ],
        attachment_paths: ['a/1.pdf', 'a/2.pdf'],
      } as unknown as Partial<BookRead>)

    it('staff: signed copy, original and both scans', () => {
      setup([signedWithScans()])
      expect(within(rowOf(1)).getByText('4 papers')).toBeInTheDocument()
    })

    it('inmate reporters: only the signed copy, matching the pane and the phone list', () => {
      setup([signedWithScans()], { isInmateReporter: true })
      expect(within(rowOf(1)).getByText('1 paper')).toBeInTheDocument()
    })
  })
})
