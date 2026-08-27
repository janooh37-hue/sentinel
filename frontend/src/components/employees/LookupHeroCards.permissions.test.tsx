import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(), isLoading: false, has: () => false }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    getExpiry: vi.fn(),
    getEmployeesCompleteness: vi.fn(),
  },
}))
vi.mock('@/lib/employeeRecents', () => ({ getRecentEmployees: () => [] }))

import { api } from '@/lib/api'
import { LookupHeroCards } from './LookupHeroCards'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getExpiry).mockResolvedValue([
    {
      employee_id: 'G-1',
      name_en: 'Aisha Noor',
      name_ar: 'عائشة نور',
      doc_type: 'passport',
      days_remaining: 10,
      bucket: 'soon',
    },
  ] as never)
  vi.mocked(api.getEmployeesCompleteness).mockResolvedValue({
    incomplete: 0,
    first_incomplete_id: null,
    top_missing: [],
  } as never)
})

it('hides the employee-lookup expiry-board link without expiry.view', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LookupHeroCards onOpen={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  expect(await screen.findByText(/Aisha Noor/)).toBeVisible()
  expect(
    screen.queryByRole('link', { name: /View all expiring documents/i }),
  ).not.toBeInTheDocument()
})
