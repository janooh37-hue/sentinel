import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { openCorrespondenceInOutlook } from '@/lib/outlookBridge'
import { useIsMobile } from '@/lib/useIsMobile'
import { CorrespondenceTab } from './CorrespondenceTab'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, listEmployeeCorrespondence: vi.fn() },
  }
})
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: vi.fn() }))
vi.mock('@/lib/outlookBridge', () => ({ openCorrespondenceInOutlook: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'employee.correspondence.desktopRequired'
        ? 'Classic Outlook requires the desktop app'
        : key,
    i18n: { language: 'en' },
  }),
}))

const items = [
  {
    entry_id: 44,
    channel: 'email',
    entry_date: '2026-08-22',
    direction: 'incoming',
    counterparty: 'finance@example.test',
    subject: 'Salary confirmation',
    to_recipients: [{ name: 'HR', address: 'hr@example.test' }],
    cc_recipients: [],
    attachment_count: 2,
    link_source: 'detected' as const,
    can_open_in_outlook: true,
  },
  {
    entry_id: 45,
    channel: 'letter',
    entry_date: '2026-08-20',
    direction: 'incoming',
    counterparty: 'Ministry',
    subject: 'Legacy letter',
    to_recipients: [],
    cc_recipients: [],
    attachment_count: 0,
    link_source: 'legacy' as const,
    can_open_in_outlook: false,
  },
]

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CorrespondenceTab employeeId="G100" />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('CorrespondenceTab', () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(false)
    vi.mocked(api.listEmployeeCorrespondence).mockResolvedValue({ items, total: items.length })
    vi.mocked(openCorrespondenceInOutlook).mockResolvedValue({ status: 'completed', id: 44, kind: 'open' })
  })

  it('renders correspondence metadata and attachment count', async () => {
    renderTab()
    expect(await screen.findByText('Salary confirmation')).toBeInTheDocument()
    expect(screen.getByText('finance@example.test')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('employee.correspondence.linkSource.detected')).toBeInTheDocument()
  })

  it('opens email correspondence through exact Outlook handoff', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'employee.correspondence.open' }))
    expect(openCorrespondenceInOutlook).toHaveBeenCalledWith(44, 'G100')
  })

  it('keeps historical non-email rows read-only', async () => {
    renderTab()
    const legacy = await screen.findByText('Legacy letter')
    expect(legacy.closest('article')).toHaveAttribute('data-read-only', 'true')
    expect(screen.queryByRole('button', { name: 'employee.correspondence.open legacy letter' })).not.toBeInTheDocument()
  })

  it('shows localized desktop-required copy on mobile instead of a raw key', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    renderTab()
    expect(await screen.findByText('Classic Outlook requires the desktop app')).toBeInTheDocument()
    expect(screen.queryByText('employee.correspondence.desktopRequired')).not.toBeInTheDocument()
  })
})
