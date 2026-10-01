import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as ApiModule from '@/lib/api'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { LeavesPage } from './LeavesPage'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof ApiModule>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listLeaves: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getLeave: vi.fn().mockResolvedValue({
        id: 7, employee_id: 'G7', employee_name: 'Test Employee', leave_type: 'Annual Leave',
        start_date: '2026-09-01', end_date: '2026-09-02', status: 'Pending', days: 2,
      }),
      leaveBalance: vi.fn().mockResolvedValue([]),
    },
  }
})

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(['leaves.create', 'leaves.view']), isLoading: false, has: () => true }),
}))
vi.mock('@/components/notify/SendButton', () => ({ SendButton: () => null }))
vi.mock('@/components/notify/NotifyEmployeeToggle', () => ({ NotifyEmployeeToggle: () => null }))
vi.mock('./NationalServiceDialog', () => ({
  NationalServiceDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <div role="dialog" aria-label="National Service"><button onClick={onClose}>Close service</button></div> : null,
}))
vi.mock('./report/LeavesReport', () => ({ LeavesReport: () => null }))

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Back</button></>
}

function renderLeaves(initialEntry: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Routes><Route path="/leaves" element={<LeavesPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('Leaves URL state', () => {
  it('opens the National Service dialog from action and closes without leaving Leaves', async () => {
    renderLeaves('/leaves?action=ns-new')
    expect(await screen.findByRole('dialog', { name: 'National Service' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close service' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/leaves$/))
  })

  it('keeps the requested filters when loaded from a URL', async () => {
    renderLeaves('/leaves?status=Approved&q=care')
    await waitFor(() => expect(api.listLeaves).toHaveBeenCalledWith(expect.objectContaining({ status: 'Approved', q: 'care' })))
  })

  it('keeps the requested tab when loaded from a URL', () => {
    renderLeaves('/leaves?tab=balance')
    expect(screen.getByRole('tab', { name: /balance/i })).toHaveAttribute('aria-selected', 'true')
  })
})
