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

// Write failures surface through sonner; mocking it lets the rollback test
// assert the toast without mounting a Toaster.
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { toast } from 'sonner'

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
  email_verified_at: null,
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
  // A service on "Full" holds both halves of its capability pair: creation
  // (`books.service.*`) and record visibility (`books.servicerecords.*`).
  const defaults = [
    ...pageCaps,
    'books.service.General Book',
    'books.servicerecords.General Book',
    'books.category.incoming',
  ]
  return {
    user_id: operator.id,
    role: 'operator',
    is_admin: false,
    effective: defaults,
    role_defaults: defaults,
    // Report is fully hidden: creation and records are both denied.
    overrides: {
      'books.service.Report': 'deny',
      'books.servicerecords.Report': 'deny',
    },
    ...over,
  }
}

const allServiceCaps = [
  ...QUICK_ACTION_IDS.flatMap((id) => [
    `books.service.${id}`,
    `books.servicerecords.${id}`,
  ]),
  'books.service.other',
  'books.servicerecords.other',
]

/** Every service on Full — nothing hidden, every tri-state control canonical. */
function allVisibleFixture(): UserPermissionRead {
  const caps = [...pageCaps, ...allServiceCaps, 'books.category.incoming']
  return permissionFixture({ effective: caps, role_defaults: caps, overrides: {} })
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

// The desktop mirror is no longer mounted with the workspace: it only appears
// after the person editing opens the preview strip at the bottom of the card.
async function openDesktopPreview(): Promise<HTMLElement> {
  const toggle = await screen.findByRole('button', { name: 'Open preview' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('mirror-device')).not.toBeInTheDocument()
  await userEvent.click(toggle)
  return screen.getByTestId('mirror-device')
}

async function findPeopleRail(): Promise<HTMLElement> {
  return await screen.findByRole('complementary', { name: 'People' })
}

function studioGrid(rail: HTMLElement): HTMLElement {
  const grid = rail.parentElement
  if (grid == null) throw new Error('People rail is not a child of the studio grid')
  return grid
}

const SERVICE_STATES = ['Full', 'Records only', 'Hidden'] as const
type ServiceStateLabel = (typeof SERVICE_STATES)[number]

function serviceRadio(name: string, state: ServiceStateLabel): HTMLElement {
  return within(screen.getByRole('radiogroup', { name })).getByRole('radio', { name: state })
}

/** The control's own row: the nearest ancestor that also renders the service
 *  name, whatever wrapper depth the layout uses. */
function serviceRow(name: string): HTMLElement {
  let node = screen.getByRole('radiogroup', { name }).parentElement
  while (node != null && within(node).queryAllByText(name).length === 0) {
    node = node.parentElement
  }
  if (node == null) throw new Error(`No row renders a visible name for ${name}`)
  return node
}

/** The one checked segment of a service control — what the admin actually sees. */
function serviceState(name: string): ServiceStateLabel {
  const checked = SERVICE_STATES.filter(
    (state) => serviceRadio(name, state).getAttribute('aria-checked') === 'true',
  )
  const [only] = checked
  if (checked.length !== 1 || only === undefined) {
    throw new Error(`${name} has ${checked.length} checked states: ${checked.join(', ')}`)
  }
  return only
}

/** Selection must carry a shape, not only a hue: the active segment renders a
 *  check glyph (WCAG 1.4.1 — never state by colour alone). */
function checkGlyph(radio: HTMLElement): Element | null {
  return radio.querySelector('svg.lucide-check')
}

function hiddenPill(): HTMLElement {
  return screen.getByText(
    (_, element) =>
      element?.tagName === 'SPAN' &&
      /^\d+ hidden$/.test(element.textContent?.trim() ?? '') &&
      element.querySelector('strong') != null,
  )
}

function hiddenTotal(): number {
  return Number(hiddenPill().querySelector('strong')?.textContent ?? '')
}

describe('PermissionsPage Mirror editor', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('announces truthful blueprint and chip state on the approved paper/device surfaces', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Permissions studio' })).toBeVisible()
    expect(screen.getAllByRole('heading', { name: 'Permissions studio' })).toHaveLength(1)
    expect(await findPeopleRail()).toBeVisible()
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

    // Services are tri-state: the row keeps its artwork and every segment is
    // labelled, so state is never communicated by colour alone.
    const generalBook = within(blueprint).getByRole('radiogroup', { name: 'General Book' })
    const generalBookRow = serviceRow('General Book')
    expect(within(generalBookRow).getAllByText('General Book')[0]).toBeVisible()
    expect(generalBookRow.querySelector('img[src*="service-icons"]')).toBeInTheDocument()
    expect(within(generalBookRow).queryByText('📓')).not.toBeInTheDocument()
    for (const state of SERVICE_STATES) {
      expect(within(generalBook).getByText(state)).toBeVisible()
    }
    expect(serviceState('General Book')).toBe('Full')
    const fullRadio = serviceRadio('General Book', 'Full')
    expect(fullRadio).toHaveClass('border-primary', 'bg-primary', 'text-primary-foreground')
    expect(checkGlyph(fullRadio)).not.toBeNull()
    for (const state of ['Records only', 'Hidden'] as const) {
      expect(checkGlyph(serviceRadio('General Book', state))).toBeNull()
    }
    expect(serviceState('Report')).toBe('Hidden')
    const hiddenRadio = serviceRadio('Report', 'Hidden')
    // text-background, not text-white: white on the dark accent (#ef4858) is
    // only ~3.7:1, while the near-black background token clears AA both ways.
    expect(hiddenRadio).toHaveClass('border-accent', 'bg-accent', 'text-background')
    expect(checkGlyph(hiddenRadio)).not.toBeNull()
    expect(checkGlyph(serviceRadio('Report', 'Full'))).toBeNull()

    // The legend is the only place the three states are explained, so every
    // radiogroup has to point at it instead of leaving it visually adjacent.
    const legend = within(blueprint).getByText(
      /Full — can create it and sees its records · Records only — hidden under Services, records stay visible · Hidden — no tile, no records/,
    )
    expect(legend).toBeVisible()
    expect(legend).toHaveClass('text-[0.72em]')
    expect(legend.id).toBeTruthy()
    expect(generalBook).toHaveAttribute('aria-describedby', legend.id)
    expect(within(blueprint).getByRole('radiogroup', { name: 'Report' })).toHaveAttribute(
      'aria-describedby',
      legend.id,
    )

    const mirror = await openDesktopPreview()
    expect(mirror).toHaveClass('p-2')
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
    expect(screen.queryByRole('button', { name: 'Open preview' })).not.toBeInTheDocument()
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

  it('denies a page with the single-capability write and hides it from the preview', async () => {
    const base = permissionFixture()
    const deferred = createDeferred<UserPermissionRead>()
    renderPage()
    vi.mocked(api.setUserPermission).mockReturnValue(deferred.promise)

    const mirror = await openDesktopPreview()
    expect(within(mirror).getByText('Employees')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /Employees Grant/ }))

    expect(api.setUserPermission).toHaveBeenCalledWith(operator.id, 'employees.view', 'deny')
    expect(api.setUserPermissionsBulk).not.toHaveBeenCalled()
    expect(within(mirror).queryByText('Employees')).not.toBeInTheDocument()

    deferred.resolve(
      permissionFixture({
        effective: base.effective.filter((capability) => capability !== 'employees.view'),
        overrides: { ...base.overrides, 'employees.view': 'deny' },
      }),
    )
  })

  it('clears an explicit deny when restoring a denied category', async () => {
    const base = permissionFixture()
    renderPage(
      permissionFixture({
        effective: base.effective.filter(
          (capability) => capability !== 'books.category.incoming',
        ),
        overrides: { ...base.overrides, 'books.category.incoming': 'deny' },
      }),
    )
    vi.mocked(api.setUserPermission).mockResolvedValue(base)

    await userEvent.click(await screen.findByRole('button', { name: /Incoming Deny/ }))

    await waitFor(() =>
      expect(api.setUserPermission).toHaveBeenCalledWith(
        operator.id,
        'books.category.incoming',
        null,
      ),
    )
    expect(api.setUserPermissionsBulk).not.toHaveBeenCalled()
  })

  it('moves a service to Records only with one atomic creation-deny, records-reset write', async () => {
    const base = permissionFixture()
    const deferred = createDeferred<UserPermissionRead>()
    renderPage()
    vi.mocked(api.setUserPermissionsBulk).mockReturnValue(deferred.promise)

    const mirror = await openDesktopPreview()
    const before = hiddenTotal()
    expect(within(mirror).getByText('Incoming')).toBeVisible()
    expect(within(mirror).getAllByText('General Book').length).toBeGreaterThan(0)

    await userEvent.click(serviceRadio('General Book', 'Records only'))

    // One atomic write, creation first, records second.
    expect(api.setUserPermissionsBulk).toHaveBeenCalledTimes(1)
    expect(api.setUserPermissionsBulk).toHaveBeenCalledWith(operator.id, [
      { capability: 'books.service.General Book', effect: 'deny' },
      { capability: 'books.servicerecords.General Book', effect: null },
    ])
    expect(api.setUserPermission).not.toHaveBeenCalled()

    // Optimistically the tile leaves the Services preview and the hidden pill
    // counts it, while its records stay granted.
    await waitFor(() => expect(serviceState('General Book')).toBe('Records only'))
    const recordsRadio = serviceRadio('General Book', 'Records only')
    expect(recordsRadio).toHaveClass('border-warning', 'bg-warning', 'text-warning-foreground')
    expect(checkGlyph(recordsRadio)).not.toBeNull()
    expect(checkGlyph(serviceRadio('General Book', 'Full'))).toBeNull()
    expect(within(mirror).queryByText('General Book')).not.toBeInTheDocument()
    expect(within(mirror).getByText('Incoming')).toBeVisible()
    expect(hiddenTotal()).toBe(before + 1)

    deferred.resolve(
      permissionFixture({
        effective: base.effective.filter(
          (capability) => capability !== 'books.service.General Book',
        ),
        overrides: { ...base.overrides, 'books.service.General Book': 'deny' },
      }),
    )
  })

  it('hides a service by denying creation and records together', async () => {
    const base = permissionFixture()
    renderPage()
    vi.mocked(api.setUserPermissionsBulk).mockResolvedValue(
      permissionFixture({
        effective: base.effective.filter(
          (capability) =>
            capability !== 'books.service.General Book' &&
            capability !== 'books.servicerecords.General Book',
        ),
        overrides: {
          ...base.overrides,
          'books.service.General Book': 'deny',
          'books.servicerecords.General Book': 'deny',
        },
      }),
    )

    const mirror = await openDesktopPreview()
    const before = hiddenTotal()

    await userEvent.click(serviceRadio('General Book', 'Hidden'))

    expect(api.setUserPermissionsBulk).toHaveBeenCalledTimes(1)
    expect(api.setUserPermissionsBulk).toHaveBeenCalledWith(operator.id, [
      { capability: 'books.service.General Book', effect: 'deny' },
      { capability: 'books.servicerecords.General Book', effect: 'deny' },
    ])
    await waitFor(() => expect(serviceState('General Book')).toBe('Hidden'))
    expect(within(mirror).queryByText('General Book')).not.toBeInTheDocument()
    expect(hiddenTotal()).toBe(before + 1)
  })

  it('restores a hidden service to Full by clearing both overrides', async () => {
    const base = permissionFixture()
    // Report is implicitly granted by role and hidden by stored overrides.
    const roleDefaults = [
      ...base.role_defaults,
      'books.service.Report',
      'books.servicerecords.Report',
    ]
    const deferred = createDeferred<UserPermissionRead>()
    renderPage(permissionFixture({ role_defaults: roleDefaults }))
    vi.mocked(api.setUserPermissionsBulk).mockReturnValue(deferred.promise)

    const mirror = await openDesktopPreview()
    expect(serviceState('Report')).toBe('Hidden')
    const before = hiddenTotal()

    await userEvent.click(serviceRadio('Report', 'Full'))

    expect(api.setUserPermissionsBulk).toHaveBeenCalledWith(operator.id, [
      { capability: 'books.service.Report', effect: null },
      { capability: 'books.servicerecords.Report', effect: null },
    ])
    await waitFor(() => expect(serviceState('Report')).toBe('Full'))
    expect(within(mirror).getAllByText('Report').length).toBeGreaterThan(0)
    expect(hiddenTotal()).toBe(before - 1)

    deferred.resolve(
      permissionFixture({
        effective: roleDefaults,
        role_defaults: roleDefaults,
        overrides: {},
      }),
    )
  })

  it('shows a create-allowed, records-denied pair as Hidden and heals it on the next choice', async () => {
    const base = permissionFixture()
    const deferred = createDeferred<UserPermissionRead>()
    renderPage(
      permissionFixture({
        effective: base.effective.filter(
          (capability) => capability !== 'books.servicerecords.General Book',
        ),
        overrides: { ...base.overrides, 'books.servicerecords.General Book': 'deny' },
      }),
    )
    vi.mocked(api.setUserPermissionsBulk).mockReturnValue(deferred.promise)

    await screen.findByRole('region', { name: 'Permission blueprint' })
    expect(serviceState('General Book')).toBe('Hidden')

    await userEvent.click(serviceRadio('General Book', 'Records only'))

    // The next choice writes the canonical pair, whatever the stored mix was.
    expect(api.setUserPermissionsBulk).toHaveBeenCalledWith(operator.id, [
      { capability: 'books.service.General Book', effect: 'deny' },
      { capability: 'books.servicerecords.General Book', effect: null },
    ])
    await waitFor(() => expect(serviceState('General Book')).toBe('Records only'))

    deferred.resolve(
      permissionFixture({
        effective: base.effective.filter(
          (capability) => capability !== 'books.service.General Book',
        ),
        overrides: { ...base.overrides, 'books.service.General Book': 'deny' },
      }),
    )
  })

  it('captions each service state from the pair the person actually has', async () => {
    const base = permissionFixture()
    renderPage()
    vi.mocked(api.setUserPermissionsBulk).mockResolvedValue(
      permissionFixture({
        effective: base.effective.filter(
          (capability) => capability !== 'books.service.General Book',
        ),
        overrides: { ...base.overrides, 'books.service.General Book': 'deny' },
      }),
    )

    await screen.findByRole('region', { name: 'Permission blueprint' })
    fireEvent.focus(serviceRadio('General Book', 'Full'))
    expect(
      await screen.findByText(
        'General Book is available under Services and its records stay visible in Records.',
      ),
    ).toBeVisible()

    fireEvent.focus(serviceRadio('Report', 'Hidden'))
    expect(
      await screen.findByText('Report is hidden everywhere — no Services tile and no records.'),
    ).toBeVisible()

    await userEvent.click(serviceRadio('General Book', 'Records only'))
    expect(
      await screen.findByText(
        "General Book is hidden under Services and can't be created, but its records stay visible in Records.",
      ),
    ).toBeVisible()
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
    const emptyMirror = await openDesktopPreview()
    expect(within(emptyMirror).getAllByText('Nothing here for this person')).toHaveLength(3)
    first.unmount()

    const allVisible = allVisibleFixture()
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

  it('rolls back a failed service write and blocks every other write until it settles', async () => {
    const deferred = createDeferred<UserPermissionRead>()
    renderPage()
    vi.mocked(api.setUserPermissionsBulk).mockReturnValue(deferred.promise)
    const mirror = await openDesktopPreview()
    const advanced = (await screen.findByText('Advanced permissions')).closest('aside')
    expect(advanced).not.toBeNull()

    const before = hiddenTotal()
    const recordsOnly = serviceRadio('General Book', 'Records only')
    await userEvent.click(recordsOnly)

    await waitFor(() => {
      for (const name of ['General Book', 'Report', 'Other records']) {
        for (const state of SERVICE_STATES) {
          const radio = serviceRadio(name, state)
          expect(radio).not.toBeDisabled()
          expect(radio).toHaveAttribute('aria-disabled', 'true')
          expect(radio).toHaveAttribute('aria-busy', 'true')
        }
      }
      expect(screen.getByRole('button', { name: /Employees Grant/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      for (const button of within(
        within(advanced!).getByRole('group', { name: 'View books' }),
      ).getAllByRole('button')) {
        expect(button).not.toBeDisabled()
        expect(button).toHaveAttribute('aria-disabled', 'true')
      }
      expect(document.activeElement).toBe(recordsOnly)
    })

    await userEvent.click(serviceRadio('Report', 'Full'))
    await userEvent.click(screen.getByRole('button', { name: /Employees Grant/ }))
    expect(api.setUserPermissionsBulk).toHaveBeenCalledTimes(1)
    expect(api.setUserPermission).not.toHaveBeenCalled()
    expect(serviceState('General Book')).toBe('Records only')
    expect(hiddenTotal()).toBe(before + 1)

    deferred.reject(new Error('save failed'))

    await waitFor(() => {
      expect(serviceState('General Book')).toBe('Full')
      expect(within(mirror).getAllByText('General Book').length).toBeGreaterThan(0)
      expect(serviceRadio('General Book', 'Full')).toHaveAttribute('aria-disabled', 'false')
      expect(serviceRadio('General Book', 'Full')).toHaveAttribute('aria-busy', 'false')
      expect(hiddenTotal()).toBe(before)
      expect(document.activeElement).toBe(recordsOnly)
    })
    expect(toast.error).toHaveBeenCalledWith("Couldn't update the permission.")
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
    expect(screen.queryByRole('button', { name: 'Open preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close preview' })).not.toBeInTheDocument()
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

    const mirror = await openDesktopPreview()
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

  it('edits Other records with the tri-state control and never previews it as creatable', async () => {
    const allVisible = allVisibleFixture()
    renderPage(allVisible, { requests: [] })
    vi.mocked(api.setUserPermissionsBulk).mockResolvedValue({
      ...allVisible,
      effective: allVisible.effective.filter(
        (capability) =>
          capability !== 'books.service.other' &&
          capability !== 'books.servicerecords.other',
      ),
      overrides: {
        'books.service.other': 'deny',
        'books.servicerecords.other': 'deny',
      },
    })

    const blueprint = await screen.findByRole('region', { name: 'Permission blueprint' })
    expect(within(blueprint).getByRole('radiogroup', { name: 'Other records' })).toBeVisible()
    expect(serviceState('Other records')).toBe('Full')
    const mirror = await openDesktopPreview()
    expect(within(mirror).queryByText('Other records')).not.toBeInTheDocument()
    expect(hiddenTotal()).toBe(0)

    await userEvent.click(serviceRadio('Other records', 'Hidden'))

    expect(api.setUserPermissionsBulk).toHaveBeenCalledWith(operator.id, [
      { capability: 'books.service.other', effect: 'deny' },
      { capability: 'books.servicerecords.other', effect: 'deny' },
    ])
    await waitFor(() => expect(serviceState('Other records')).toBe('Hidden'))
    expect(hiddenTotal()).toBe(1)
    // Other records is never creatable, so the Services preview never listed it.
    expect(within(mirror).queryByText('Other records')).not.toBeInTheDocument()
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

  it('keeps the desktop mirror unmounted until the workspace preview strip is opened', async () => {
    renderPage()

    const blueprint = await screen.findByRole('region', { name: 'Permission blueprint' })
    expect(screen.queryByTestId('mirror-device')).not.toBeInTheDocument()

    const openToggle = screen.getByRole('button', { name: 'Open preview' })
    expect(openToggle).toHaveAttribute('aria-expanded', 'false')
    const previewId = openToggle.getAttribute('aria-controls')
    expect(previewId).toBeTruthy()
    expect(document.getElementById(previewId!)).toBeNull()
    expect(
      blueprint.compareDocumentPosition(openToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(within(openToggle.parentElement!).getByText(/Viewing as Mariam Hassan/)).toBeVisible()

    await userEvent.click(openToggle)

    const mirror = screen.getByTestId('mirror-device')
    expect(mirror).toBeVisible()
    expect(within(mirror).getAllByText('General Book').length).toBeGreaterThan(0)
    const closeToggle = screen.getByRole('button', { name: 'Close preview' })
    expect(closeToggle).toHaveAttribute('aria-expanded', 'true')
    expect(closeToggle).toHaveAttribute('aria-controls', previewId!)
    const revealed = document.getElementById(previewId!)
    expect(revealed).not.toBeNull()
    expect(revealed).toContainElement(mirror)
    expect(screen.queryByRole('button', { name: 'Open preview' })).not.toBeInTheDocument()
    expect(
      closeToggle.compareDocumentPosition(mirror) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    await userEvent.click(closeToggle)

    expect(screen.queryByTestId('mirror-device')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open preview' })).toBeVisible()
  })

  it('lays out people, workspace and advanced permissions as one three-column studio grid', async () => {
    renderPage()

    const rail = await findPeopleRail()
    expect(rail).toHaveClass(
      'bg-surface',
      'border-hairline',
      'rounded-2xl',
      'min-[1100px]:sticky',
      'min-[1100px]:top-4',
    )
    // Arabic is cursive: letter-spacing on an uppercase micro-label breaks the
    // joins, so every new uppercase heading opts out under dir=rtl.
    expect(within(rail).getByRole('heading', { level: 2, name: 'People' })).toHaveClass(
      'uppercase',
      'tracking-[0.08em]',
      'rtl:tracking-normal',
    )

    const grid = studioGrid(rail)
    expect(grid).toHaveClass(
      'grid',
      'grid-cols-1',
      'gap-4',
      'min-[1100px]:gap-6',
      'min-[1100px]:[grid-template-columns:280px_minmax(0,1fr)_360px]',
    )
    expect(grid.parentElement).toHaveClass('max-w-[1680px]')

    const blueprint = await screen.findByRole('region', { name: 'Permission blueprint' })
    for (const name of ['Pages', 'Services', 'Record categories']) {
      expect(within(blueprint).getByRole('heading', { level: 3, name })).toHaveClass(
        'rtl:tracking-normal',
      )
    }
    const advanced = (await screen.findByText('Advanced permissions')).closest('aside')
    expect(advanced).toHaveClass('min-[1100px]:sticky', 'min-[1100px]:top-4')
    expect(Array.from(grid.children)).toHaveLength(3)
    expect(grid.children[0]).toBe(rail)
    expect(grid.children[1] as HTMLElement).toContainElement(blueprint)
    expect(grid.children[2]).toBe(advanced)
  })

  it('shows the selected person in the workspace header next to the hidden-count pill', async () => {
    renderPage()

    const rail = await findPeopleRail()
    const workspace = studioGrid(rail).children[1] as HTMLElement
    const pill = await within(workspace).findByText(
      (_, element) =>
        element?.tagName === 'SPAN' &&
        /^\d+ hidden$/.test(element.textContent?.trim() ?? '') &&
        element.querySelector('strong') != null,
    )
    const header = pill.parentElement as HTMLElement
    expect(within(header).getByText('Mariam Hassan')).toBeVisible()
    expect(within(header).getByText('Operator')).toBeVisible()
  })

  it('filters the People rail by name and keeps the active-account count truthful', async () => {
    const many = renderPage(permissionFixture(), { users: [operator, secondOperator, admin] })

    const rail = await findPeopleRail()
    expect(within(rail).getByRole('heading', { level: 2, name: 'People' })).toBeVisible()
    expect(within(rail).getByText('3 active accounts')).toBeVisible()

    const search = within(rail).getByRole('textbox', { name: 'Search people…' })
    await userEvent.type(search, 'SECOND')

    expect(within(rail).getByRole('button', { name: /Second User/ })).toBeVisible()
    expect(within(rail).queryByRole('button', { name: /Mariam Hassan/ })).not.toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: /System Admin/ })).not.toBeInTheDocument()
    expect(within(rail).getByText('3 active accounts')).toBeVisible()

    const workspace = studioGrid(rail).children[1] as HTMLElement
    expect(within(workspace).getByText('Mariam Hassan')).toBeVisible()

    await userEvent.clear(search)
    await userEvent.type(search, 'zzz')

    const noResults = within(rail).getByRole('status')
    expect(noResults).toHaveTextContent('No results')
    expect(within(rail).queryAllByRole('button', { pressed: true })).toHaveLength(0)
    expect(within(rail).queryAllByRole('button', { pressed: false })).toHaveLength(0)
    many.unmount()

    renderPage(permissionFixture(), { users: [operator] })
    expect(within(await findPeopleRail()).getByText('1 active account')).toBeVisible()
  })

  it('collapses the People rail below the studio breakpoint and forces it open on desktop', async () => {
    renderPage()

    const rail = await findPeopleRail()
    const toggle = within(rail).getByRole('button', { name: 'People' })
    expect(toggle).toHaveClass('min-[1100px]:hidden')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const bodyId = toggle.getAttribute('aria-controls')
    expect(bodyId).toBeTruthy()
    const body = document.getElementById(bodyId!)
    expect(body).not.toBeNull()
    expect(within(body!).getByRole('textbox', { name: 'Search people…' })).toBeVisible()
    expect(within(body!).getByRole('button', { name: /Mariam Hassan/ })).toBeVisible()
    expect(within(body!).getByText('2 active accounts')).toBeVisible()
    expect(body).not.toHaveClass('hidden')

    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(body).toHaveClass('hidden', 'min-[1100px]:block')

    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(body).not.toHaveClass('hidden')
  })
})
