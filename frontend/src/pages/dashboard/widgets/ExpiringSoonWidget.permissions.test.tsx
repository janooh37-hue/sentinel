import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))
const awaitingReturnCount = vi.hoisted(() =>
  vi.fn((enabled: boolean) => {
    void enabled
    return 0
  }),
)

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))
vi.mock('@/pages/leaves/useAwaitingReturnCount', () => ({
  useAwaitingReturnCount: (enabled: boolean) => awaitingReturnCount(enabled),
}))
vi.mock('@/lib/api', () => ({
  api: { getExpiry: vi.fn() },
}))

import { api } from '@/lib/api'
import { ExpiringSoonWidget } from './ExpiringSoonWidget'

beforeEach(() => {
  vi.clearAllMocks()
  capabilityState.allowed = new Set()
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

function renderWidget(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ExpiringSoonWidget />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('renders nothing and starts no data queries without expiry.view', async () => {
  renderWidget()

  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  await waitFor(() => expect(api.getExpiry).not.toHaveBeenCalled())
  expect(awaitingReturnCount).toHaveBeenCalledWith(false)
})

it('keeps expiry rows informational without employees.view', async () => {
  capabilityState.allowed = new Set(['expiry.view'])
  renderWidget()

  const employeeName = await screen.findByText('Aisha Noor')
  expect(employeeName).toBeVisible()
  expect(screen.getByText('G-1')).toBeVisible()
  expect(employeeName.closest('button, a')).toBeNull()
})

it('gates awaiting-return data independently with leaves.view', async () => {
  capabilityState.allowed = new Set(['expiry.view'])
  renderWidget()

  expect(await screen.findByText('Aisha Noor')).toBeVisible()
  expect(awaitingReturnCount).toHaveBeenCalledWith(false)

  capabilityState.allowed = new Set(['expiry.view', 'leaves.view'])
  renderWidget()
  expect(awaitingReturnCount).toHaveBeenLastCalledWith(true)
})
