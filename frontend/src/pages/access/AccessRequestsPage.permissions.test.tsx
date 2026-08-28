import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { id: 999 } }),
}))

import i18n from '@/lib/i18n'
import { api, type AdminUserRead } from '@/lib/api'
import { AccessRequestsPage, UsersTable } from './AccessRequestsPage'

function user(over: Partial<AdminUserRead> = {}): AdminUserRead {
  return {
    id: 42,
    email: 'user@example.com',
    employee_id: null,
    display_name: 'Test User',
    name_en: 'Test User',
    role: 'operator',
    status: 'active',
    failed_attempts: 0,
    last_login_at: null,
    created_at: null,
    is_default_manager: false,
    ...over,
  }
}

function renderRow(target: AdminUserRead) {
  render(
    <UsersTable
      users={[target]}
      emptyMessage="empty"
      currentUserId={999}
      onReset={vi.fn()}
      onChangeRole={vi.fn()}
      onEditPermissions={vi.fn()}
      onSetDefaultManager={vi.fn()}
      onLock={vi.fn()}
      onUnlock={vi.fn()}
    />,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('UsersTable permission-editor eligibility', () => {
  it('shows Edit permissions for an active non-admin user', async () => {
    renderRow(user())
    await userEvent.click(screen.getByRole('button', { name: 'Row actions' }))
    expect(screen.getByText('Edit permissions')).toBeVisible()
  })

  it.each([
    user({ id: 1, role: 'admin', display_name: 'Admin User' }),
    user({ id: 2, status: 'locked', display_name: 'Suspended User' }),
  ])('hides Edit permissions for $display_name', async (target) => {
    renderRow(target)
    await userEvent.click(screen.getByRole('button', { name: 'Row actions' }))
    expect(screen.queryByText('Edit permissions')).not.toBeInTheDocument()
  })
})

describe('AccessRequestsPage permission cache coherence', () => {
  it('invalidates the changed user permission query after a role change', async () => {
    const target = user()
    vi.spyOn(api, 'listAuthUsers').mockResolvedValue([target])
    vi.spyOn(api, 'setAuthUserRole').mockResolvedValue({ ...target, role: 'manager' })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/access-requests']}>
          <AccessRequestsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await userEvent.click(await screen.findByRole('tab', { name: /Active/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Row actions' }))
    await userEvent.click(await screen.findByText('Change role'))
    await userEvent.click(screen.getByRole('radio', { name: /Manager/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save role' }))

    await waitFor(() =>
      expect(api.setAuthUserRole).toHaveBeenCalledWith(target.id, 'manager'),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['user-permissions', target.id],
    })
  })
})
