import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import type { LeaveRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { TabRecords } from './TabRecords'

vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true, isLoading: false }),
}))
vi.mock('@/components/notify/SendButton', () => ({ SendButton: () => null }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof ApiModule>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getLeave: vi.fn(),
      listLeaves: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    },
  }
})

const leave: LeaveRead = {
  id: 1,
  employee_id: 'G100',
  employee_name_en: 'Leave subject',
  employee_name_ar: 'الموظف',
  leave_type: 'Annual Leave',
  start_date: '2026-11-20',
  end_date: '2026-11-29',
  days: 10,
  status: 'Approved',
  created_at: '2026-10-19T10:00:00',
  submitted_by_g: 'G200',
  request_date: null,
  doc_path: null,
  certificate_path: null,
}

function renderDrawer(submittedBy: string | null) {
  vi.mocked(api.getLeave).mockResolvedValue({ ...leave, submitted_by_g: submittedBy })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/leaves?open=1']}>
        <TabRecords />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(async () => { await i18n.changeLanguage('en') })

describe('mobile leave submission details', () => {
  it.each(['en', 'ar'])('shows the original filer beside the date in %s', async (language) => {
    await i18n.changeLanguage(language)
    renderDrawer('G200')
    const dateArea = (await screen.findByText(i18n.t('leaves.report.filed'))).parentElement!
    expect(within(dateArea).getByText(i18n.t('leaves.report.submittedBy'))).toBeVisible()
    expect(within(dateArea).getByText('G200')).toHaveAttribute('dir', 'ltr')
    expect(within(dateArea).queryByText('G100')).not.toBeInTheDocument()
    expect(within(dateArea).getByText(/2026/)).toBeVisible()
  })

  it.each(['en', 'ar'])('keeps only the date for unknown filers in %s', async (language) => {
    await i18n.changeLanguage(language)
    renderDrawer(null)
    const dateArea = (await screen.findByText(i18n.t('leaves.report.filed'))).parentElement!
    expect(within(dateArea).getByText(/2026/)).toBeVisible()
    expect(within(dateArea).queryByText(i18n.t('leaves.report.submittedBy'))).not.toBeInTheDocument()
    expect(within(dateArea).queryByText('G100')).not.toBeInTheDocument()
  })
})
