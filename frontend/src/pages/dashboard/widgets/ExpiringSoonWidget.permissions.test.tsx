import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))
vi.mock('@/pages/leaves/useAwaitingReturnCount', () => ({ useAwaitingReturnCount: () => 0 }))
vi.mock('@/lib/api', () => ({
  api: { getExpiry: vi.fn() },
}))

import { api } from '@/lib/api'
import { ExpiringSoonWidget } from './ExpiringSoonWidget'

beforeEach(() => {
  vi.clearAllMocks()
  capabilityState.allowed = new Set(['employees.view'])
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
})

it('hides the expiry-board footer link without expiry.view', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ExpiringSoonWidget />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  expect(await screen.findByText('Aisha Noor')).toBeVisible()
  expect(screen.queryByRole('link', { name: /View all/i })).not.toBeInTheDocument()
})
