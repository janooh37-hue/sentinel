import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { BooksPage } from './BooksPage'
import { RecordDeleteProvider } from './RecordDeleteProvider'

vi.mock('@/lib/api', () => ({
  api: {
    getBookFacets: vi.fn().mockResolvedValue({ total: 1, services: [] }),
    listBooks: vi.fn().mockResolvedValue({ items: [{ id: 42, ref_number: 'GS-0042', subject: 'abc match', approval_state: 'pending', category: { name_en: 'General', name_ar: 'عام' }, direction: 'incoming', created_at: '2026-01-01', is_draft: false }] }),
    listBookCategories: vi.fn().mockResolvedValue([]),
  },
  apiErrorMessage: (error: unknown) => String(error),
  ApiError: class ApiError extends Error {},
}))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
const viewport = vi.hoisted(() => ({ mobile: false, role: 'admin' }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { role: viewport.role } }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => viewport.mobile }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('./StatusSpine', () => ({ StatusSpine: ({ active, onChange }: { active: string; onChange: (state: string) => void }) => <button aria-label="status-filter" onClick={() => onChange('approved')}>{active}</button> }))
vi.mock('./FormRail', () => ({
  FormRail: ({ mine }: { mine?: { pressed: boolean; onToggle: () => void } }) =>
    mine ? <button aria-label="mine-toggle" aria-pressed={mine.pressed} onClick={mine.onToggle} /> : null,
  MineChip: () => null,
}))
vi.mock('./RecordsList', () => ({ RecordsList: () => null }))
vi.mock('./RecordPane', () => ({ RecordPane: ({ book }: { book: { id: number } | null }) => <div data-testid="record-pane">{book?.id ?? 'none'}</div> }))
vi.mock('@/pages/scanBack/ScanBackEntry', () => ({ ScanBackEntry: () => null }))
vi.mock('@/components/refresh/RefreshButton', () => ({ RefreshButton: () => null }))
vi.mock('@/components/refresh/PullToRefresh', () => ({ PullToRefresh: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="url">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>back</button><button onClick={() => navigate('/away')}>go-away</button></>
}

function setup(entry = '/books?status=pending&q=abc&open=42') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/elsewhere', entry]} initialIndex={1}><LocationProbe /><RecordDeleteProvider><Routes><Route path="/books" element={<BooksPage />} /><Route path="/away" element={<div data-testid="away" />} /></Routes></RecordDeleteProvider></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  viewport.mobile = false
  viewport.role = 'admin'
  vi.mocked(api.listBooks).mockClear()
  vi.mocked(api.getBookFacets).mockClear()
})

describe('Books URL state', () => {
  it('restores filter, search, selection from URL and replaces filter changes', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('record-pane')).toHaveTextContent('42'))
    expect(screen.getByLabelText('status-filter')).toHaveTextContent('pending')
    expect(screen.getByTestId('records-search')).toHaveValue('abc')
    await userEvent.click(screen.getByLabelText('status-filter'))
    expect(new URLSearchParams(screen.getByTestId('url').textContent?.split('?')[1]).get('status')).toBe('approved')
    await userEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/elsewhere$/)
  })

  it('mine=1 reaches the list, the facets and the search with created_by_me', async () => {
    setup('/books?mine=1&q=abc')
    await waitFor(() =>
      expect(api.listBooks).toHaveBeenCalledWith({ q: 'abc', limit: 500, created_by_me: true }),
    )
    expect(api.listBooks).toHaveBeenCalledWith({ limit: 500, created_by_me: true })
    expect(api.getBookFacets).toHaveBeenCalledWith({ created_by_me: true })
    expect(api.getBookFacets).not.toHaveBeenCalledWith({})
  })

  it('without mine, list and search stay unscoped and the badge query still runs', async () => {
    setup('/books?q=abc')
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith({ q: 'abc', limit: 500 }))
    expect(api.listBooks).toHaveBeenCalledWith({ limit: 500 })
    expect(api.listBooks).not.toHaveBeenCalledWith(expect.objectContaining({ created_by_me: true }))
    // Page facets (unscoped) and the always-on badge query (created_by_me).
    await waitFor(() => expect(api.getBookFacets).toHaveBeenCalledWith({}))
    expect(api.getBookFacets).toHaveBeenCalledWith({ created_by_me: true })
  })

  it('shares one badge request with the page facets while mine is on', async () => {
    setup('/books?mine=1')
    await waitFor(() => expect(api.getBookFacets).toHaveBeenCalled())
    expect(vi.mocked(api.getBookFacets).mock.calls).toEqual([[{ created_by_me: true }]])
  })

  it('the Created-by-me toggle writes mine=1, refetches the list and the facets, and toggles back', async () => {
    setup('/books')
    const search = (): URLSearchParams =>
      new URLSearchParams(screen.getByTestId('url').textContent?.split('?')[1])
    const toggle = await screen.findByLabelText('mine-toggle')
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith({ limit: 500 }))
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(search().get('mine')).toBeNull()

    await userEvent.click(toggle)
    expect(search().get('mine')).toBe('1')
    await waitFor(() =>
      expect(api.listBooks).toHaveBeenCalledWith({ limit: 500, created_by_me: true }),
    )
    expect(api.getBookFacets).toHaveBeenCalledWith({ created_by_me: true })
    expect(screen.getByLabelText('mine-toggle')).toHaveAttribute('aria-pressed', 'true')

    vi.mocked(api.listBooks).mockClear()
    await userEvent.click(screen.getByLabelText('mine-toggle'))
    expect(search().get('mine')).toBeNull()
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith({ limit: 500 }))
  })

  it('never scopes inmate reporters to "created by me": no badge query, no scoped list, even with mine=1', async () => {
    viewport.role = 'inmate_reporter'
    setup('/books?mine=1')
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith({ limit: 500 }))
    await waitFor(() => expect(api.getBookFacets).toHaveBeenCalledWith({}))
    expect(api.getBookFacets).not.toHaveBeenCalledWith({ created_by_me: true })
    expect(api.listBooks).not.toHaveBeenCalledWith(expect.objectContaining({ created_by_me: true }))
  })

  it('phone filters survive a remount', async () => {
    viewport.mobile = true
    setup('/books')
    await userEvent.click(await screen.findByRole('button', { name: 'books.direction.incoming' }))
    fireEvent.change(screen.getByTestId('date-from'), { target: { value: '2026-01-05' } })
    const search = () => new URLSearchParams(screen.getByTestId('url').textContent?.split('?')[1])
    expect(search().get('direction')).toBe('incoming')
    expect(search().get('from')).toBe('2026-01-05')
    // Unmount the page (route change), then come back to the same entry.
    await userEvent.click(screen.getByText('go-away'))
    await waitFor(() => expect(screen.getByTestId('away')).toBeInTheDocument())
    await userEvent.click(screen.getByText('back'))
    expect(await screen.findByRole('button', { name: 'books.direction.incoming' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('date-from')).toHaveValue('2026-01-05')
  })
})
