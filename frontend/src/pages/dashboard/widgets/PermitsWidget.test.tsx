import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ItemPermitListResponse, type PermitListResponse } from '@/lib/api'
import i18n from '@/lib/i18n'
import { PermitsWidget } from './PermitsWidget'
import type { WidgetTier } from './types'

const caps = vi.hoisted(() => ({ canView: true }))
vi.mock('@/lib/api', () => ({
  api: { permitsSummary: vi.fn(), itemPermitsSummary: vi.fn(), listPermits: vi.fn(), listItemPermits: vi.fn() },
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'permits.view' && caps.canView }),
}))

const summary = (active: number) => ({
  active, expiring: 2, expired: 1, revoked: 0,
  people_active: 0, people_green: 0, people_red: 0, people_work_residence: 0,
})
const itemSummary = { none: 2, pending: 601, awaiting_scan: 3, approved: 4, returned: 0, rejected: 0 }

function renderWidget(tier: WidgetTier = 'list', rows = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter><PermitsWidget tier={tier} rows={rows} /></MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.resetAllMocks()
  localStorage.clear()
  await i18n.changeLanguage('en')
  caps.canView = true
  vi.mocked(api.permitsSummary).mockImplementation(async (zone) => summary(zone === 'red' ? 3 : 7))
  vi.mocked(api.itemPermitsSummary).mockResolvedValue(itemSummary)
  vi.mocked(api.listPermits).mockResolvedValue({
    items: [
      { id: 41, permit_no: 'PMT-0041', company: 'Red Works LLC', derived_status: 'active', created_at: '2026-10-05T00:00:00' },
      { id: 40, permit_no: 'PMT-0040', company: 'Older Security', derived_status: 'active', created_at: '2026-10-01T00:00:00' },
    ],
    total: 10, limit: 2, offset: 0,
  } as unknown as PermitListResponse)
  vi.mocked(api.listItemPermits).mockResolvedValue({
    items: [
      { id: 3, employee_name: 'Red Pending', employee_name_en: 'Red Pending', approval_state: 'pending', created_at: '2026-10-04T00:00:00' },
      { id: 2, employee_name: 'Older Item', employee_name_en: 'Older Item', approval_state: 'awaiting_scan', created_at: '2026-10-02T00:00:00' },
    ],
    total: 610, limit: 2,
  } as unknown as ItemPermitListResponse)
})

describe('PermitsWidget', () => {
  it.each<WidgetTier>(['glance', 'summary', 'tall'])('uses summary counts without loading register rows at %s tier', async (tier) => {
    renderWidget(tier, 0)
    expect(await screen.findByRole('link', { name: /7\s*Active/ })).toHaveAttribute('href', '/permits?state=active')
    expect(api.itemPermitsSummary).toHaveBeenCalledWith(undefined)
    expect(api.listPermits).not.toHaveBeenCalled()
    expect(api.listItemPermits).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: 'Zone' })).toBeInTheDocument()
    if (tier === 'glance') {
      expect(screen.getByRole('link', { name: /2\s*Expiring/ })).toHaveAttribute('href', '/permits?state=expiring')
      expect(screen.getByRole('link', { name: /610/ })).toHaveAttribute('href', '/permits?tab=items')
    } else {
      expect(screen.getByRole('link', { name: /601\s*Pending approval/ })).toHaveAttribute('href', '/permits?tab=items&istatus=pending')
      expect(screen.getByRole('link', { name: /3\s*Awaiting signed copy/ })).toHaveAttribute('href', '/permits?tab=items&istatus=awaiting_scan')
    }
  })

  it('clips the combined latest rows to the allocated rows and links remaining real totals', async () => {
    renderWidget('list', 2)
    expect(await screen.findByRole('link', { name: /Red Works LLC/ })).toHaveAttribute('href', '/permits?preview=41')
    expect(screen.getByRole('link', { name: /Red Pending/ })).toHaveAttribute('href', '/permits?tab=items&itemPreview=3')
    expect(screen.queryByText('Older Security')).not.toBeInTheDocument()
    expect(screen.queryByText('Older Item')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+9 more security permits' })).toHaveAttribute('href', '/permits')
    expect(screen.getByRole('link', { name: '+609 more item permits' })).toHaveAttribute('href', '/permits?tab=items')
    expect(api.listPermits).toHaveBeenCalledWith({ zone: undefined, limit: 2 })
    expect(api.listItemPermits).toHaveBeenCalledWith({ zone: undefined, limit: 2 })
  })

  it('retains the remembered zone on every count, preview, view-all and remaining link', async () => {
    const { unmount } = renderWidget()
    await screen.findByRole('link', { name: /Red Pending/ })
    fireEvent.change(screen.getByRole('combobox', { name: 'Zone' }), { target: { value: 'red' } })
    await screen.findByRole('link', { name: /3\s*Active/ })
    await screen.findByRole('link', { name: /Red Pending/ })
    expect(api.permitsSummary).toHaveBeenLastCalledWith('red')
    expect(api.itemPermitsSummary).toHaveBeenLastCalledWith('red')
    expect(api.listItemPermits).toHaveBeenLastCalledWith({ zone: 'red', limit: 2 })
    for (const link of screen.getAllByRole('link')) {
      expect(new URL(link.getAttribute('href')!, 'https://sentinel.test').searchParams.get('zone')).toBe('red')
    }
    unmount()
    renderWidget('glance', 0)
    expect(screen.getByRole('combobox', { name: 'Zone' })).toHaveValue('red')
  })

  it('keeps loading and a retryable error inside the frame', async () => {
    vi.mocked(api.itemPermitsSummary).mockRejectedValueOnce(new Error('offline'))
    renderWidget('summary', 0)
    expect(screen.getByRole('region', { name: 'Permits' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: /601\s*Pending approval/ })).toBeInTheDocument()
  })

  it('keeps an instructional empty state in the frame', async () => {
    vi.mocked(api.permitsSummary).mockResolvedValue({ ...summary(0), expiring: 0, expired: 0 })
    vi.mocked(api.itemPermitsSummary).mockResolvedValue({ none: 0, pending: 0, awaiting_scan: 0, approved: 0, returned: 0, rejected: 0 })
    renderWidget('glance', 0)
    expect(await screen.findByRole('link', { name: /Open the register/ })).toHaveAttribute('href', '/permits')
  })

  it('never returns null if capability availability changes after layout', async () => {
    caps.canView = false
    renderWidget('glance', 0)
    expect(screen.getByRole('region', { name: 'Permits' })).toBeInTheDocument()
    await waitFor(() => expect(api.permitsSummary).not.toHaveBeenCalled())
    expect(api.itemPermitsSummary).not.toHaveBeenCalled()
    expect(api.listPermits).not.toHaveBeenCalled()
    expect(api.listItemPermits).not.toHaveBeenCalled()
  })
})
