import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { id: 999 } }),
}))

const permissionState = vi.hoisted(() => ({ canManageUsers: true }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    has: (cap: string) => cap === 'users.manage' && permissionState.canManageUsers,
  }),
}))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/pages/application/EmployeePicker', () => ({ EmployeePicker: () => null }))

import i18n from '@/lib/i18n'
import { api, ApiError, type AdminUserRead } from '@/lib/api'
import { toast } from '@/lib/toast'
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
    password_change_required: false,
    line_manager_user_id: null,
    ...over,
  }
}

function renderRow(target: AdminUserRead) {
  const client = queryClient()
  render(
    <QueryClientProvider client={client}>
      <UsersTable
        users={[target]}
        emptyMessage="empty"
        currentUserId={999}
        onReset={vi.fn()}
        onChangeRole={vi.fn()}
        onEditPermissions={vi.fn()}
        onSetDefaultManager={vi.fn()}
        onDisable={vi.fn()}
        onUnlock={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return client
}

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
}

function renderPage() {
  render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter>
        <AccessRequestsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  permissionState.canManageUsers = true
  vi.spyOn(api, 'listApprovers').mockResolvedValue([
    { id: 42, name: 'Reporter himself', name_ar: 'المُبلّغ نفسه', is_default: false },
    { id: 7, name: 'Approving Manager', name_ar: 'المدير المعتمد', is_default: false },
  ])
  vi.spyOn(api, 'setLineManager').mockResolvedValue(user({ role: 'fleet_reporter', line_manager_user_id: 7 }))
  vi.spyOn(api, 'listAuthUsers').mockResolvedValue([])
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

describe('Fleet reporter line manager', () => {
  it.each([
    ['en', 'Line manager', 'Not set', 'Approving Manager'],
    ['ar', 'المدير المباشر', 'غير محدد', 'المدير المعتمد'],
  ])('sets the manager in %s and refreshes the users list', async (locale, label, notSet, manager) => {
    await i18n.changeLanguage(locale)
    const client = renderRow(user({ role: 'fleet_reporter' }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const picker = await screen.findByRole('combobox', { name: label })
    expect(picker).toHaveTextContent(notSet)
    await userEvent.click(picker)
    expect(screen.queryByRole('option', { name: /Reporter himself|المُبلّغ نفسه/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: manager }))
    await waitFor(() => expect(api.setLineManager).toHaveBeenCalledWith(42, 7))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['auth-users'] }))
  })

  it('shows the assigned manager and allows clearing it', async () => {
    renderRow(user({ role: 'fleet_reporter', line_manager_user_id: 7 }))
    const picker = await screen.findByRole('combobox', { name: 'Line manager' })
    expect(picker).toHaveTextContent('Approving Manager')
    await userEvent.click(picker)
    await userEvent.click(screen.getByRole('option', { name: 'Not set' }))
    await waitFor(() => expect(api.setLineManager).toHaveBeenCalledWith(42, null))
  })

  it.each(['operator', 'manager', 'admin', 'inmate_reporter'] as const)(
    'hides the picker for %s accounts',
    (role) => {
      renderRow(user({ role }))
      expect(screen.queryByRole('combobox', { name: 'Line manager' })).not.toBeInTheDocument()
      expect(screen.queryByText('Line manager')).not.toBeInTheDocument()
      expect(api.listApprovers).not.toHaveBeenCalled()
    },
  )

  it('hides the feature without users.manage', () => {
    permissionState.canManageUsers = false
    renderRow(user({ role: 'fleet_reporter' }))
    expect(screen.queryByText('Line manager')).not.toBeInTheDocument()
    expect(api.listApprovers).not.toHaveBeenCalled()
  })

  it('shows the current assignment as text, never a disabled picker, if candidates are forbidden', async () => {
    vi.mocked(api.listApprovers).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'))
    renderRow(user({ role: 'fleet_reporter', line_manager_user_id: 7 }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByText('#7')).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Line manager' })).not.toBeInTheDocument()
  })

  it('reports an ineligible manager using the API error message', async () => {
    vi.mocked(api.setLineManager).mockRejectedValue(
      new ApiError(422, 'LINE_MANAGER_NOT_ELIGIBLE', 'Ineligible'),
    )
    renderRow(user({ role: 'fleet_reporter' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Line manager' }))
    await userEvent.click(screen.getByRole('option', { name: 'Approving Manager' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(i18n.t('errors.fleet.lineManagerNotEligible')))
  })
})

describe('Fleet reporter role choices', () => {
  it.each(['en', 'ar'])('offers the fleet role when creating an account in %s', async (locale) => {
    await i18n.changeLanguage(locale)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: i18n.t('access.create.title') }))
    expect(screen.getByRole('radio', { name: new RegExp(i18n.t('access.roleName.fleet_reporter')) })).toBeVisible()
  })

  it('offers the fleet role when approving a request', async () => {
    vi.mocked(api.listAuthUsers).mockResolvedValue([user({ status: 'pending' })])
    renderPage()
    await screen.findByText('Test User')
    await userEvent.click(screen.getAllByRole('button', { name: 'Show details' })[0])
    expect(screen.getByRole('radio', { name: /Fleet reporter/ })).toBeVisible()
  })

  it('reveals the line-manager picker after changing an account to fleet reporter', async () => {
    const operator = user()
    const reporter = user({ role: 'fleet_reporter' })
    vi.mocked(api.listAuthUsers).mockResolvedValue([operator])
    vi.spyOn(api, 'setAuthUserRole').mockImplementation(async () => {
      vi.mocked(api.listAuthUsers).mockResolvedValue([reporter])
      return reporter
    })
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: /Active/ }))
    await screen.findByText('Test User')
    await userEvent.click(screen.getByRole('button', { name: 'Row actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change role' }))
    await userEvent.click(screen.getByRole('radio', { name: /Fleet reporter/ }))
    await userEvent.click(screen.getByRole('button', { name: i18n.t('access.roleModal.confirm') }))
    await waitFor(() => expect(api.setAuthUserRole).toHaveBeenCalledWith(42, 'fleet_reporter'))
    expect(await screen.findByRole('combobox', { name: 'Line manager' })).toHaveTextContent('Not set')
  })
})
