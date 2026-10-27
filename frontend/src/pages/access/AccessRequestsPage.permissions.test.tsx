import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { id: 999 } }),
}))

import i18n from '@/lib/i18n'
import { type AdminUserRead } from '@/lib/api'
import { UsersTable } from './AccessRequestsPage'

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
      onDisable={vi.fn()}
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


describe('UsersTable while no active department exists', () => {
  const props = {
    emptyMessage: 'empty',
    currentUserId: 999,
    onReset: vi.fn(),
    onChangeRole: vi.fn(),
    onSetDefaultManager: vi.fn(),
    onDisable: vi.fn(),
    onUnlock: vi.fn(),
  }

  it('keeps the plain user list without department filters or a No department bucket', () => {
    render(<UsersTable {...props} users={[user()]} departments={[]} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filter users by department')).not.toBeInTheDocument()
    expect(screen.queryByText(/No department/)).not.toBeInTheDocument()
  })

  it('groups users by department once an active department exists', () => {
    const department = { id: 1, name_en: 'Operations', name_ar: 'العمليات', active: true } as never
    render(<UsersTable {...props} users={[user()]} departments={[department]} />)
    expect(screen.getByLabelText('Filter users by department')).toBeInTheDocument()
    expect(screen.getAllByText(/No department/).length).toBeGreaterThan(0)
  })
})
