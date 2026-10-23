import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { useLeaveReport } from './useLeaveReport'

const listLeaves = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { listLeaves } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }))
const row = { id: 1, employee_id: 'G1', employee_name: 'Aisha', employee_name_en: 'Aisha', employee_name_ar: 'عائشة', leave_type: 'Annual Leave', start_date: '2026-10-01', end_date: '2026-10-23', status: 'Approved', days: 23, has_certificate: false }

beforeEach(() => {
  listLeaves.mockReset()
  listLeaves.mockResolvedValueOnce({ items: [row], total: 2 }).mockResolvedValueOnce({ items: [{ ...row, id: 2, employee_id: 'G2' }], total: 2 })
})

it.each([
  ['on=2026-10-23', { on_date: '2026-10-23' }],
  ['end_from=2026-10-23&end_to=2026-10-30', { end_from: '2026-10-23', end_to: '2026-10-30' }],
])('applies the dashboard %s predicate on every desktop report page', async (search, expected) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { result } = renderHook(() => useLeaveReport(), { wrapper: ({ children }) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/leaves?status=Approved&${search}`]}>{children}</MemoryRouter></QueryClientProvider> })
  await waitFor(() => expect(result.current.isPending).toBe(false))
  expect(result.current.tableRows).toHaveLength(2)
  expect(listLeaves).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'Approved', ...expected, limit: 500 }))
  expect(listLeaves).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'Approved', ...expected, limit: 500, offset: 1 }))
})
