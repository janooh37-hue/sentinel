import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { id: 999 } }),
}))

import { api, type AdminUserRead } from '@/lib/api'
import { AccessRequestsPage } from './AccessRequestsPage'

function pendingUser(over: Partial<AdminUserRead> = {}): AdminUserRead {
  return {
    id: 7,
    email: 'unverified@example.com',
    employee_id: null,
    display_name: 'Unverified User',
    name_en: 'Unverified User',
    role: 'operator',
    status: 'pending',
    failed_attempts: 0,
    last_login_at: null,
    created_at: new Date().toISOString(),
    is_default_manager: false,
    email_verified_at: null,
    ...over,
  }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/access-requests']}>
        <AccessRequestsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('AccessRequestsPage — email verification gate', () => {
  it('shows an unverified pill and disables Approve when the account-mail feature is on', async () => {
    vi.spyOn(api, 'listAuthUsers').mockResolvedValue([pendingUser()])
    vi.spyOn(api, 'authFeatures').mockResolvedValue({ account_mail: true })
    renderPage()

    expect(await screen.findByText('Email not confirmed')).toBeVisible()
    const approveButton = screen.getByRole('button', { name: /Approve/ })
    expect(approveButton).toBeDisabled()
  })

  it('hides the pill and enables Approve when the account-mail feature is off', async () => {
    vi.spyOn(api, 'listAuthUsers').mockResolvedValue([pendingUser()])
    vi.spyOn(api, 'authFeatures').mockResolvedValue({ account_mail: false })
    renderPage()

    await screen.findByText('unverified@example.com')
    expect(screen.queryByText('Email not confirmed')).not.toBeInTheDocument()
    const approveButton = screen.getByRole('button', { name: /Approve/ })
    expect(approveButton).not.toBeDisabled()
  })

  it('enables Approve once the requester has confirmed their email', async () => {
    vi.spyOn(api, 'listAuthUsers').mockResolvedValue([
      pendingUser({ email_verified_at: new Date().toISOString() }),
    ])
    vi.spyOn(api, 'authFeatures').mockResolvedValue({ account_mail: true })
    renderPage()

    await screen.findByText('unverified@example.com')
    expect(screen.queryByText('Email not confirmed')).not.toBeInTheDocument()
    const approveButton = screen.getByRole('button', { name: /Approve/ })
    expect(approveButton).not.toBeDisabled()
  })
})
