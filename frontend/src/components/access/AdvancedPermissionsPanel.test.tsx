import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}))

vi.mock('@/lib/api', () => ({
  api: {
    setUserPermission: vi.fn(),
    setUserPermissionsBulk: vi.fn(),
  },
}))

import { AdvancedPermissionsPanel } from './AdvancedPermissionsPanel'
import { api, type AdminUserRead, type CapabilityRead, type UserPermissionRead } from '@/lib/api'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const user: AdminUserRead = {
  id: 42,
  email: 'test@example.com',
  employee_id: null,
  display_name: 'Test User',
  name_en: 'Test User',
  role: 'operator',
  status: 'active',
  failed_attempts: 0,
  last_login_at: null,
  created_at: null,
  is_default_manager: false,
  email_verified_at: null,
}

function cap(id: string, domain = id.split('.')[0], label = id): CapabilityRead {
  return { id, domain, label, description: `${label} description`, default_roles: [] }
}

const capabilities = [
  cap('books.view', 'books', 'View books'),
  cap('books.edit', 'books', 'Edit books'),
  cap('leaves.view', 'leaves', 'View leaves'),
  cap('books.service.General Book', 'services', 'General Book'),
  cap('books.servicerecords.General Book', 'services', 'Records: General Book'),
  cap('books.category.incoming', 'categories', 'Incoming'),
  cap('books.service.other', 'services', 'Other'),
]

function perms(overrides: UserPermissionRead['overrides'] = {}): UserPermissionRead {
  return {
    user_id: user.id,
    role: 'operator',
    is_admin: false,
    effective: ['books.view', 'leaves.view'],
    role_defaults: ['books.view', 'leaves.view'],
    overrides,
  }
}

function renderPanel(permissionData = perms()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdvancedPermissionsPanel user={user} perms={permissionData} capabilities={capabilities} />
    </QueryClientProvider>,
  )
}

describe('AdvancedPermissionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.setUserPermission).mockResolvedValue(perms({ 'books.view': 'deny' }))
    vi.mocked(api.setUserPermissionsBulk).mockResolvedValue(perms())
  })

  it('renders the fixed header, search, domains, and scroll contract immediately', () => {
    const { container } = renderPanel()

    expect(container.firstElementChild).toHaveClass(
      'max-h-[calc(100vh-2rem)]',
      'overflow-y-auto',
    )
    expect(screen.getByText('Advanced permissions')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Advanced permissions' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search permissions…')).toBeVisible()
    expect(screen.getByText('Books')).toBeVisible()
    expect(screen.getByText('Leaves')).toBeVisible()
    expect(screen.getByText('books.view')).toBeVisible()
    expect(screen.getByText('leaves.view')).toBeVisible()
  })

  it('keeps domain headers and capability rows stacked inside the narrow panel', () => {
    renderPanel()

    const domainHeader = screen.getByRole('group', { name: 'Apply to all Books' }).parentElement
    expect(domainHeader).toHaveClass('flex', 'flex-col')
    expect(domainHeader).not.toHaveClass('sm:flex-row')
    expect(domainHeader).not.toHaveClass('sm:items-center')
    expect(domainHeader).not.toHaveClass('sm:justify-between')

    const capabilityRow = screen.getByRole('group', { name: 'View books' }).parentElement
      ?.parentElement
    expect(capabilityRow).toHaveClass('flex', 'flex-col')
    expect(capabilityRow).not.toHaveClass('sm:flex-row')
    expect(capabilityRow).not.toHaveClass('sm:items-start')
    expect(capabilityRow).not.toHaveClass('sm:justify-between')
  })

  it('keeps the tri-state row editor and excludes blueprint-owned domains', async () => {
    renderPanel()

    expect(screen.queryByText('General Book')).not.toBeInTheDocument()
    expect(screen.queryByText('Incoming')).not.toBeInTheDocument()
    expect(screen.queryByText('Records: General Book')).not.toBeInTheDocument()

    const rowToggle = screen.getByRole('group', { name: 'View books' })
    await userEvent.click(within(rowToggle).getByRole('button', { name: 'Deny' }))

    await waitFor(() =>
      expect(api.setUserPermission).toHaveBeenCalledWith(user.id, 'books.view', 'deny'),
    )
  })

  it('leaves Other records with the blueprint alongside named services and categories', async () => {
    renderPanel()

    expect(screen.queryByText('General Book')).not.toBeInTheDocument()
    expect(screen.queryByText('Incoming')).not.toBeInTheDocument()
    expect(screen.queryByText('Other')).not.toBeInTheDocument()
    expect(api.setUserPermission).not.toHaveBeenCalled()
  })

  it('filters by raw capability id and clears an empty result', async () => {
    renderPanel()

    const input = screen.getByPlaceholderText('Search permissions…')
    await userEvent.type(input, 'leaves.view')
    expect(screen.getByText('leaves.view')).toBeVisible()
    expect(screen.queryByText('books.view')).not.toBeInTheDocument()

    await userEvent.clear(input)
    await userEvent.type(input, 'nothing-matches')
    expect(screen.getByText('No permissions match')).toBeVisible()
    const clearButtons = screen.getAllByRole('button', { name: /clear/i })
    await userEvent.click(clearButtons[clearButtons.length - 1]!)
    expect(screen.getByText('books.view')).toBeVisible()
  })

  it('applies a domain-wide deny in one bulk request', async () => {
    renderPanel()

    const bulkToggle = screen.getByRole('group', { name: 'Apply to all Books' })
    await userEvent.click(within(bulkToggle).getByRole('button', { name: 'Deny' }))

    await waitFor(() =>
      expect(api.setUserPermissionsBulk).toHaveBeenCalledWith(user.id, [
        { capability: 'books.view', effect: 'deny' },
        { capability: 'books.edit', effect: 'deny' },
      ]),
    )
    expect(api.setUserPermission).not.toHaveBeenCalled()
  })

  it('keeps every tri-state control focusable but non-actionable while a write is pending', async () => {
    const deferred = createDeferred<UserPermissionRead>()
    vi.mocked(api.setUserPermission).mockReturnValue(deferred.promise)
    renderPanel()

    const booksView = screen.getByRole('group', { name: 'View books' })
    const activeDeny = within(booksView).getByRole('button', { name: 'Deny' })
    await userEvent.click(activeDeny)
    expect(document.activeElement).toBe(activeDeny)

    const booksEdit = screen.getByRole('group', { name: 'Edit records & attachments' })
    await waitFor(() => {
      for (const button of within(booksEdit).getAllByRole('button')) {
        expect(button).not.toBeDisabled()
        expect(button).toHaveAttribute('aria-disabled', 'true')
      }
      expect(booksView).toHaveAttribute('aria-busy', 'true')
    })
    await userEvent.click(within(booksEdit).getByRole('button', { name: 'Deny' }))
    expect(api.setUserPermission).toHaveBeenCalledTimes(1)

    deferred.resolve(perms({ 'books.view': 'deny' }))
    await waitFor(() => expect(booksView).toHaveAttribute('aria-busy', 'false'))
    expect(document.activeElement).toBe(activeDeny)
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})
