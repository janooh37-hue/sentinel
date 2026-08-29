import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUICK_ACTION_IDS } from '@/lib/dashboardLayout'

vi.mock('@/lib/api', () => ({
  api: {
    listAuthUsers: vi.fn(),
    listCapabilities: vi.fn(),
    getUserPermissions: vi.fn(),
    listTemplates: vi.fn(),
    listBookCategories: vi.fn(),
    listPermissionRequests: vi.fn(),
    setUserPermission: vi.fn(),
    setUserPermissionsBulk: vi.fn(),
    decidePermissionRequest: vi.fn(),
  },
}))

vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))

import { PermissionsPage } from './PermissionsPage'
import {
  api,
  type AdminUserRead,
  type CapabilityRead,
  type PermissionRequestRead,
  type UserPermissionRead,
} from '@/lib/api'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const operator: AdminUserRead = {
  id: 42,
  email: 'operator@example.com',
  employee_id: 'G-0042',
  display_name: 'Mariam Hassan',
  name_en: 'Mariam Hassan',
  role: 'operator',
  status: 'active',
  failed_attempts: 0,
  last_login_at: null,
  created_at: null,
  is_default_manager: false,
}

const admin: AdminUserRead = {
  ...operator,
  id: 1,
  email: 'admin@example.com',
  display_name: 'System Admin',
  name_en: 'System Admin',
  role: 'admin',
}

const pageCaps = [
  'employees.view',
  'ledger.view',
  'leaves.view',
  'documents.generate',
  'books.view',
  'permits.view',
  'settings.view',
  'expiry.view',
]

const secondOperator: AdminUserRead = {
  ...operator,
  id: 43,
  email: 'second@example.com',
  display_name: 'Second User',
  name_en: 'Second User',
}

function permissionFixture(over: Partial<UserPermissionRead> = {}): UserPermissionRead {
  const defaults = [
    ...pageCaps,
    'books.service.General Book',
    'books.category.incoming',
  ]
  return {
    user_id: operator.id,
    role: 'operator',
    is_admin: false,
    effective: defaults,
    role_defaults: defaults,
    overrides: { 'books.service.Report': 'deny' },
    ...over,
  }
}

const pendingRequest: PermissionRequestRead = {
  id: 90,
  user_id: operator.id,
  requester_name: operator.display_name,
  capability: 'employees.view',
  capability_label: 'View employees',
  status: 'pending',
  decision: null,
  created_at: '2026-08-27T08:00:00Z',
}

const capabilities: CapabilityRead[] = [
  {
    id: 'books.view',
    domain: 'books',
    label: 'View books',
    description: 'View records',
    default_roles: ['operator', 'manager', 'admin'],
  },
]

function configure(
  perms = permissionFixture(),
  options: {
    users?: AdminUserRead[]
    requests?: PermissionRequestRead[]
    usersError?: Error
  } = {},
) {
  if (options.usersError) {
    vi.mocked(api.listAuthUsers).mockRejectedValue(options.usersError)
  } else {
    vi.mocked(api.listAuthUsers).mockResolvedValue(options.users ?? [operator, admin])
  }
  vi.mocked(api.listCapabilities).mockResolvedValue(capabilities)
  vi.mocked(api.getUserPermissions).mockResolvedValue(perms)
  vi.mocked(api.listTemplates).mockResolvedValue({
    items: [
      {
        id: 'General Book',
        name_en: 'General Book',
        name_ar: 'الكتاب العام',
        form_number: '1',
        category: 'admin',
        signing_path: 'auto',
        has_code: false,
        notifies_employee: false,
      },
      {
        id: 'Report',
        name_en: 'Report',
        name_ar: 'تقرير',
        form_number: '2',
        category: 'admin',
        signing_path: 'auto',
        has_code: false,
        notifies_employee: false,
      },
    ],
  })
  vi.mocked(api.listBookCategories).mockResolvedValue([
    {
      id: 'incoming',
      name_en: 'Incoming',
      name_ar: 'وارد',
      prefix: 'IN',
      requires_approval: false,
    },
  ])
  vi.mocked(api.listPermissionRequests).mockResolvedValue(options.requests ?? [pendingRequest])
  vi.mocked(api.setUserPermissionsBulk).mockResolvedValue(perms)
  vi.mocked(api.decidePermissionRequest).mockResolvedValue(undefined)
}

function renderPage(
  perms = permissionFixture(),
  options: {
    users?: AdminUserRead[]
    requests?: PermissionRequestRead[]
    usersError?: Error
    entry?: string
  } = {},
) {
  configure(perms, options)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.entry ?? '/permissions?user=42']}>
        <PermissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { client, ...view }
}

describe('PermissionsPage Mirror editor', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('announces truthful blueprint and chip state on the approved paper/device surfaces', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Permissions studio' })).toBeVisible()
    expect(screen.getAllByRole('heading', { name: 'Permissions studio' })).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Choose who to edit' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Mariam Hassan/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /System Admin/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    const blueprint = await screen.findByRole('region', { name: 'Permission blueprint' })
    expect(blueprint).toHaveClass('bg-surface', 'border-primary')
    const dashboard = within(blueprint).getByRole('button', {
      name: /Dashboard Always visible — cannot be denied/,
    })
    expect(dashboard).toHaveAttribute('aria-pressed', 'true')
    expect(dashboard).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(dashboard)
    expect(api.setUserPermission).not.toHaveBeenCalled()

    const generalBook = within(blueprint).getByRole('button', {
      name: /General Book Grant/,
    })
    expect(generalBook).toHaveAttribute('aria-pressed', 'true')
    expect(generalBook).toHaveClass('bg-surface', 'text-primary')
    expect(generalBook.querySelector('img[src*="service-icons"]')).toBeInTheDocument()
    expect(within(generalBook).queryByText('📓')).not.toBeInTheDocument()
    expect(within(blueprint).getByRole('button', { name: /Report Deny/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    const mirror = screen.getByTestId('mirror-device')
    expect(mirror).toHaveClass('min-[900px]:sticky', 'p-2')
    expect(within(mirror).getAllByText('General Book').length).toBeGreaterThan(0)
    expect(mirror.querySelectorAll('img[src*="service-icons"]').length).toBeGreaterThan(0)
    expect(within(mirror).queryByText('Report')).not.toBeInTheDocument()
    expect(within(mirror).getByText('Incoming')).toBeVisible()
  })

  it('shows the admin explanation without falling back to another user', async () => {
    renderPage(permissionFixture(), { entry: '/permissions?user=1' })

    expect(await screen.findByRole('button', { name: /System Admin/ })).toBeDisabled()
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(api.getUserPermissions).not.toHaveBeenCalled()
    expect(screen.queryByText('No users to manage yet.')).not.toBeInTheDocument()
    expect(screen.getAllByText('Always full access').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('mirror-device')).not.toBeInTheDocument()
  })

  it('shows an unknown-user recovery link without falling back', async () => {
    renderPage(permissionFixture(), { entry: '/permissions?user=9999' })

    expect(await screen.findByText('This user is not available for permission editing.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Access requests' })).toHaveAttribute(
      'href',
      '/access-requests',
    )
    expect(api.getUserPermissions).not.toHaveBeenCalled()
  })

  it('distinguishes user-query failure from a genuinely empty roster', async () => {
    const failed = renderPage(permissionFixture(), { usersError: new Error('offline') })
    expect(await screen.findByText("Couldn't load permissions.")).toBeVisible()
    expect(screen.queryByText('No users to manage yet.')).not.toBeInTheDocument()
    failed.unmount()

    renderPage(permissionFixture(), { users: [] })
    expect(await screen.findByText('No users to manage yet.')).toBeVisible()
    expect(screen.queryByText('Always full access')).not.toBeInTheDocument()
  })

  it('optimistically hides a visible service and sends a deny', async () => {
    let resolveSave!: (value: UserPermissionRead) => void
    const pendingSave = new Promise<UserPermissionRead>((resolve) => {
      resolveSave = resolve
    })
    vi.mocked(api.setUserPermission).mockReturnValue(pendingSave)
    renderPage()

    const service = await screen.findByRole('button', { name: /General Book Grant/ })
    await userEvent.click(service)

    expect(api.setUserPermission).toHaveBeenCalledWith(
      operator.id,
      'books.service.General Book',
      'deny',
    )
    expect(within(screen.getByTestId('mirror-device')).queryByText('General Book')).not.toBeInTheDocument()
    resolveSave(permissionFixture({
      effective: permissionFixture().effective.filter((id) => id !== 'books.service.General Book'),
      overrides: {
        'books.service.General Book': 'deny',
        'books.service.Report': 'deny',
      },
    }))
  })

  it('clears an explicit deny when restoring a denied item', async () => {
    const initial = permissionFixture()
    vi.mocked(api.setUserPermission).mockResolvedValue({
      ...initial,
      effective: [...initial.effective, 'books.service.Report'],
      overrides: {},
    })
    renderPage(initial)

    await userEvent.click(await screen.findByRole('button', { name: /Report Deny/ }))
    await waitFor(() =>
      expect(api.setUserPermission).toHaveBeenCalledWith(
        operator.id,
        'books.service.Report',
        null,
      ),
    )
  })

  it('approves a selected user pending request permanently', async () => {
    renderPage()

    expect(await screen.findByText('View employees')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(api.decidePermissionRequest).toHaveBeenCalledWith(90, {
        decision: 'permanent',
      }),
    )
  })

  it('explains wholly denied mirror groups and keeps zero hidden state neutral', async () => {
    const emptyGroups = permissionFixture({
      effective: [...pageCaps],
      role_defaults: [...pageCaps],
      overrides: {},
    })
    const first = renderPage(emptyGroups, { requests: [] })
    const emptyMirror = await screen.findByTestId('mirror-device')
    expect(within(emptyMirror).getAllByText('Nothing here for this person')).toHaveLength(3)
    first.unmount()

    const allVisible = permissionFixture({
      effective: [
        ...pageCaps,
        ...QUICK_ACTION_IDS.map((id) => `books.service.${id}`),
        'books.service.other',
        'books.category.incoming',
      ],
      role_defaults: [
        ...pageCaps,
        ...QUICK_ACTION_IDS.map((id) => `books.service.${id}`),
        'books.service.other',
        'books.category.incoming',
      ],
      overrides: {},
    })
    renderPage(allVisible, { requests: [] })
    const hiddenChip = await screen.findByText(
      (_, element) =>
        element?.tagName === 'SPAN' &&
        element.textContent?.trim() === '0 hidden' &&
        element.querySelector('strong') != null,
    )
    expect(hiddenChip).toHaveClass('bg-surface-tinted', 'text-muted-foreground')
    expect(hiddenChip).not.toHaveClass('bg-accent-soft')
    expect(hiddenChip.querySelector('strong')).toHaveTextContent('0')
  })

  it('rolls back a failed optimistic write and blocks page and drawer writes until it settles', async () => {
    const deferred = createDeferred<UserPermissionRead>()
    vi.mocked(api.setUserPermission).mockReturnValue(deferred.promise)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Advanced permissions/i }))

    const generalBook = screen.getByRole('button', { name: /General Book Grant/ })
    await userEvent.click(generalBook)
    await waitFor(() => {
      const report = screen.getByRole('button', { name: /Report Deny/ })
      expect(report).not.toBeDisabled()
      expect(report).toHaveAttribute('aria-disabled', 'true')
      expect(generalBook).toHaveAttribute('aria-busy', 'true')
      expect(document.activeElement).toBe(generalBook)
      for (const button of within(screen.getByRole('group', { name: 'View books' })).getAllByRole('button')) {
        expect(button).not.toBeDisabled()
        expect(button).toHaveAttribute('aria-disabled', 'true')
      }
    })
    await userEvent.click(screen.getByRole('button', { name: /Report Deny/ }))
    expect(api.setUserPermission).toHaveBeenCalledTimes(1)

    deferred.reject(new Error('save failed'))
    await waitFor(() => {
      expect(within(screen.getByTestId('mirror-device')).getAllByText('General Book').length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: /Report Deny/ })).toHaveAttribute(
        'aria-disabled',
        'false',
      )
      expect(document.activeElement).toBe(generalBook)
    })
  })

  it('invalidates the request owner when another user is selected before the decision settles', async () => {
    const deferred = createDeferred<unknown>()
    vi.mocked(api.decidePermissionRequest).mockReturnValue(deferred.promise)
    const { client } = renderPage(permissionFixture(), {
      users: [operator, secondOperator, admin],
    })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('button', { name: /Second User/ }))
    await waitFor(() => expect(api.getUserPermissions).toHaveBeenCalledWith(secondOperator.id))

    deferred.resolve(undefined)
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['user-permissions', operator.id],
      }),
    )
  })

  it('uses a capped flex-column mobile mirror and a 44px request link target', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query === '(max-width: 759px)',
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    )
    renderPage()

    const mirror = await screen.findByTestId('mirror-device')
    expect(mirror).toHaveClass(
      'flex',
      'flex-col',
      'z-[45]',
      '[bottom:calc(4.875rem+env(safe-area-inset-bottom))]',
    )
    await userEvent.click(within(mirror).getByRole('button', { name: /Viewing as/ }))
    expect(document.getElementById('mirror-device-screen')).toHaveClass(
      'min-h-0',
      'flex-1',
      'overflow-y-auto',
      'max-h-[calc(100dvh-8rem)]',
    )
    expect(screen.getByRole('link', { name: 'Permission requests' })).toHaveClass('min-h-11')
  })

  it('warns when Records is denied and books.approve is the only warning trigger', async () => {
    const base = permissionFixture()
    const noRecordsView = permissionFixture({
      effective: [
        ...base.effective.filter(
          (capability) => capability !== 'books.view' && capability !== 'documents.generate',
        ),
        'books.approve',
      ],
      overrides: { ...base.overrides, 'books.view': 'deny' },
    })
    renderPage(noRecordsView, { requests: [] })

    const warning = await screen.findByRole('note')
    expect(warning).toHaveTextContent('cannot create or browse records')
    expect(warning).toHaveTextContent('records awaiting their approval')
    expect(warning).toHaveClass('bg-warning-soft')
  })

  it('removes creation and record previews when books.view is the only missing prerequisite', async () => {
    const base = permissionFixture()
    const noRecordsView = permissionFixture({
      effective: base.effective.filter((capability) => capability !== 'books.view'),
      overrides: { ...base.overrides, 'books.view': 'deny' },
    })
    renderPage(noRecordsView, { requests: [] })

    const mirror = await screen.findByTestId('mirror-device')
    expect(within(mirror).queryByRole('heading', { name: 'Services' })).not.toBeInTheDocument()
    expect(within(mirror).queryByRole('heading', { name: 'Quick actions' })).not.toBeInTheDocument()
    expect(
      within(mirror).queryByRole('heading', { name: 'Record categories' }),
    ).not.toBeInTheDocument()

    const recordsTile = screen.getByRole('button', { name: /Records Deny/ })
    fireEvent.focus(recordsTile)
    expect(await screen.findByText(/Records hidden/)).toHaveTextContent('creation blocked')
  })

  it('localizes dynamic Other-record requests instead of showing the backend fallback', async () => {
    renderPage(permissionFixture(), {
      requests: [
        {
          ...pendingRequest,
          capability: 'books.service.other',
          capability_label: 'other',
        },
      ],
    })

    const requestStrip = (await screen.findByText('Requested access')).parentElement?.parentElement
    expect(requestStrip).not.toBeNull()
    expect(within(requestStrip!).getByText('Other records')).toBeVisible()
    expect(within(requestStrip!).queryByText('other')).not.toBeInTheDocument()
  })

  it('edits Other records in the blueprint, counts its deny, and never previews it as creatable', async () => {
    const allVisible = permissionFixture({
      effective: [
        ...pageCaps,
        ...QUICK_ACTION_IDS.map((id) => `books.service.${id}`),
        'books.service.other',
        'books.category.incoming',
      ],
      role_defaults: [
        ...pageCaps,
        ...QUICK_ACTION_IDS.map((id) => `books.service.${id}`),
        'books.service.other',
        'books.category.incoming',
      ],
      overrides: {},
    })
    vi.mocked(api.setUserPermission).mockResolvedValue({
      ...allVisible,
      effective: allVisible.effective.filter(
        (capability) => capability !== 'books.service.other',
      ),
      overrides: { 'books.service.other': 'deny' },
    })
    renderPage(allVisible, { requests: [] })

    const blueprint = await screen.findByRole('region', { name: 'Permission blueprint' })
    const otherRecords = within(blueprint).getByRole('button', {
      name: /Other records Grant/,
    })
    expect(within(screen.getByTestId('mirror-device')).queryByText('Other records')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'SPAN' &&
          element.textContent?.trim() === '0 hidden' &&
          element.querySelector('strong') != null,
      ),
    ).toBeVisible()

    await userEvent.click(otherRecords)

    expect(api.setUserPermission).toHaveBeenCalledWith(
      operator.id,
      'books.service.other',
      'deny',
    )
    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === 'SPAN' &&
          element.textContent?.trim() === '1 hidden' &&
          element.querySelector('strong') != null,
      ),
    ).toBeVisible()
  })

  it('treats a disabled admin deep-link as unavailable instead of full access', async () => {
    const disabledAdmin: AdminUserRead = { ...admin, status: 'disabled' }
    renderPage(permissionFixture(), {
      users: [operator, disabledAdmin],
      entry: '/permissions?user=1',
    })

    expect(
      await screen.findByText('This user is not available for permission editing.'),
    ).toBeVisible()
    expect(screen.queryByText('Always full access')).not.toBeInTheDocument()
    expect(api.getUserPermissions).not.toHaveBeenCalled()
  })
})
