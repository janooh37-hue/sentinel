import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ItemPermitListResponse } from '@/lib/api'
import i18n from '@/lib/i18n'
import { PermitsWidget } from './PermitsWidget'

const caps = vi.hoisted(() => ({ value: new Set<string>() }))

vi.mock('@/lib/api', () => ({
  api: { permitsSummary: vi.fn(), listItemPermits: vi.fn() },
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => caps.value.has(cap) }),
}))

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
  caps.value = new Set(['permits.view'])
  vi.mocked(api.permitsSummary).mockResolvedValue({
    active: 7, expiring: 2, expired: 1, revoked: 0,
    people_active: 0, people_green: 0, people_red: 0, people_work_residence: 0,
  })
  vi.mocked(api.listItemPermits).mockResolvedValue({
    items: [{ approval_state: 'pending' }, { approval_state: 'pending' }, { approval_state: null }],
    total: 3,
    limit: 500,
  } as unknown as ItemPermitListResponse)
})

describe('PermitsWidget', () => {
  it('links each count to the register filtered to that status', async () => {
    renderWidget()

    const expiring = await screen.findByRole('link', { name: /2\s*Expiring/ })
    expect(expiring).toHaveAttribute('href', '/permits?state=expiring')
    expect(screen.getByRole('link', { name: /7\s*Active/ })).toHaveAttribute('href', '/permits?state=active')

    const pending = await screen.findByRole('link', { name: /2\s*Pending approval/ })
    expect(pending).toHaveAttribute('href', '/permits?tab=items&istatus=pending')
    // A permit with no linked book counts as a draft.
    expect(screen.getByRole('link', { name: /1\s*Draft/ })).toHaveAttribute('href', '/permits?tab=items&istatus=none')
    expect(screen.getByRole('link', { name: /0\s*Approved/ })).toHaveAttribute('href', '/permits?tab=items&istatus=approved')
  })

  it('renders nothing and fetches nothing without permits.view', () => {
    caps.value = new Set()
    const { container } = renderWidget()

    expect(container).toBeEmptyDOMElement()
    expect(api.permitsSummary).not.toHaveBeenCalled()
    expect(api.listItemPermits).not.toHaveBeenCalled()
  })
})
