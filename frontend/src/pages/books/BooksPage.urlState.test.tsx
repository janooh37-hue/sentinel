import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BooksPage } from './BooksPage'
import { RecordDeleteProvider } from './RecordDeleteProvider'

vi.mock('@/lib/api', () => ({
  api: {
    getBookFacets: vi.fn().mockResolvedValue({ total: 1, services: [] }),
    listBooks: vi.fn().mockResolvedValue({ items: [{ id: 42, ref_number: 'GS-0042', subject: 'abc match', approval_state: 'pending', created_at: '2026-01-01', is_draft: false }] }),
    listBookCategories: vi.fn().mockResolvedValue([]),
  },
  apiErrorMessage: (error: unknown) => String(error),
  ApiError: class ApiError extends Error {},
}))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('./StatusSpine', () => ({ StatusSpine: ({ active, onChange }: { active: string; onChange: (state: string) => void }) => <button aria-label="status-filter" onClick={() => onChange('approved')}>{active}</button> }))
vi.mock('./FormRail', () => ({ FormRail: () => null }))
vi.mock('./RecordsList', () => ({ RecordsList: () => null }))
vi.mock('./RecordPane', () => ({ RecordPane: ({ book }: { book: { id: number } | null }) => <div data-testid="record-pane">{book?.id ?? 'none'}</div> }))
vi.mock('@/pages/scanBack/ScanBackEntry', () => ({ ScanBackEntry: () => null }))
vi.mock('@/components/refresh/RefreshButton', () => ({ RefreshButton: () => null }))
vi.mock('@/components/refresh/PullToRefresh', () => ({ PullToRefresh: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="url">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>back</button></>
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/elsewhere', '/books?status=pending&q=abc&open=42']} initialIndex={1}><LocationProbe /><RecordDeleteProvider><Routes><Route path="/books" element={<BooksPage />} /></Routes></RecordDeleteProvider></MemoryRouter></QueryClientProvider>)
}

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
})
