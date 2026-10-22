import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ItemPermitListResponse, type PermitListResponse } from '@/lib/api'
import i18n from '@/lib/i18n'
import { PermitsWidget } from './PermitsWidget'

const caps = vi.hoisted(() => ({ value: new Set<string>() }))

vi.mock('@/lib/api', () => ({
  api: { permitsSummary: vi.fn(), listPermits: vi.fn(), listItemPermits: vi.fn() },
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => caps.value.has(cap) }),
}))

const summary = (active: number) => ({
  active, expiring: 2, expired: 1, revoked: 0,
  people_active: 0, people_green: 0, people_red: 0, people_work_residence: 0,
})

const itemPermit = (id: number, zones: string[], approval_state: string | null, employee: string) => ({
  id, zones, approval_state, employee_name: employee, employee_name_en: employee, items: [{ name: 'Cement', quantity: 3 }],
})

function renderWidget() {
  void i18n.changeLanguage('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <PermitsWidget />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  caps.value = new Set(['permits.view'])
  vi.mocked(api.permitsSummary).mockImplementation(async (zone) => summary(zone === 'red' ? 3 : 7))
  vi.mocked(api.listPermits).mockResolvedValue({
    items: [{
      id: 41, permit_no: 'PMT-0041', company: 'Red Works LLC', zones: ['red'], access_areas: null,
      derived_status: 'active', days_remaining: 9, start_date: '2026-10-01',
      validity: { value: 1, unit: 'month' },
    }],
    total: 1, limit: 5, offset: 0,
  } as unknown as PermitListResponse)
  vi.mocked(api.listItemPermits).mockResolvedValue({
    items: [
      itemPermit(3, ['red'], 'pending', 'Red Pending'),
      itemPermit(2, ['green'], 'pending', 'Green Pending'),
      itemPermit(1, ['red', 'green'], null, 'Both Draft'),
    ],
    total: 3,
    limit: 500,
  } as unknown as ItemPermitListResponse)
})

describe('PermitsWidget', () => {
  it('links counts to the filtered register and latest rows to its quick view', async () => {
    renderWidget()

    expect(await screen.findByRole('link', { name: /7\s*Active/ })).toHaveAttribute('href', '/permits?state=active')
    expect(await screen.findByRole('link', { name: /2\s*Pending approval/ })).toHaveAttribute(
      'href',
      '/permits?tab=items&istatus=pending',
    )
    expect(screen.getByRole('link', { name: /Red Works LLC/ })).toHaveAttribute('href', '/permits?preview=41')
    expect(screen.getByRole('link', { name: /Green Pending/ })).toHaveAttribute('href', '/permits?tab=items&itemPreview=2')
  })

  it('scopes counts and latest entries to the chosen zone and remembers it', async () => {
    const { unmount } = renderWidget()
    await screen.findByRole('link', { name: /Green Pending/ })

    fireEvent.click(screen.getByRole('button', { name: 'Red' }))

    expect(await screen.findByRole('link', { name: /3\s*Active/ })).toHaveAttribute('href', '/permits?state=active&zone=red')
    expect(api.permitsSummary).toHaveBeenLastCalledWith('red')
    expect(api.listPermits).toHaveBeenLastCalledWith({ zone: 'red', limit: 5 })
    expect(screen.getByRole('link', { name: /1\s*Pending approval/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /1\s*Draft/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Green Pending/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Red Works LLC/ })).toHaveAttribute('href', '/permits?zone=red&preview=41')

    unmount()
    renderWidget()
    expect(await screen.findByRole('button', { name: 'Red' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders nothing and fetches nothing without permits.view', () => {
    caps.value = new Set()
    const { container } = renderWidget()

    expect(container).toBeEmptyDOMElement()
    expect(api.permitsSummary).not.toHaveBeenCalled()
    expect(api.listPermits).not.toHaveBeenCalled()
    expect(api.listItemPermits).not.toHaveBeenCalled()
  })
})
