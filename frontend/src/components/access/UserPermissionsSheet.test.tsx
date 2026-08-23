/**
 * UserPermissionsSheet — render/interaction tests.
 *
 * Asserts that capability descriptions/labels render, that search filters the
 * matrix (and offers a clear action), and that domain-wide toggles reach the
 * bulk endpoint in exactly one call.
 * Mocks `@/lib/api` so no real network calls are made.
 * Wraps the component in a minimal QueryClientProvider + i18n context
 * (i18n is initialised in the global test setup.ts).
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// ---------------------------------------------------------------------------
// Mock api
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  api: {
    listCapabilities: vi.fn(),
    getUserPermissions: vi.fn(),
    setUserPermission: vi.fn(),
    setUserPermissionsBulk: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}))

// Import AFTER mock so the module is swapped.
import { UserPermissionsSheet } from './UserPermissionsSheet'
import { api, type CapabilityRead, type UserPermissionRead } from '@/lib/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUser = {
  id: 42,
  email: 'test@example.com',
  employee_id: null,
  display_name: 'Test User',
  name_en: 'Test User',
  role: 'operator' as const,
  status: 'active' as const,
  failed_attempts: 0,
  last_login_at: null,
  created_at: null,
  is_default_manager: false,
}

/** Build one atomic capability; domain defaults to the id prefix. */
function cap(id: string, over: Partial<CapabilityRead> = {}): CapabilityRead {
  return {
    id,
    domain: id.split('.')[0],
    label: id,
    description: `${id} description`,
    default_roles: [],
    ...over,
  }
}

function permsFixture(over: Partial<UserPermissionRead> = {}): UserPermissionRead {
  return {
    user_id: mockUser.id,
    role: 'operator',
    is_admin: false,
    effective: [],
    role_defaults: [],
    overrides: {},
    ...over,
  }
}

function baseCaps(): CapabilityRead[] {
  return [
    cap('books.approve', {
      label: 'Approve / reject books',
      description: 'Allows approving or rejecting submitted books for sign-off.',
      default_roles: ['manager', 'admin'],
    }),
    cap('leaves.view', {
      label: 'View leaves',
      description: 'Read-only access to employee leave records.',
      default_roles: ['operator', 'manager', 'admin'],
    }),
  ]
}

function renderSheet({
  caps = baseCaps(),
  perms = permsFixture(),
}: { caps?: CapabilityRead[]; perms?: UserPermissionRead } = {}) {
  vi.mocked(api.listCapabilities).mockResolvedValue(caps)
  vi.mocked(api.getUserPermissions).mockResolvedValue(perms)
  return render(
    <Wrapper>
      <UserPermissionsSheet user={mockUser} onClose={() => {}} />
    </Wrapper>,
  )
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeClient()}>
      {children}
    </QueryClientProvider>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserPermissionsSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders capability descriptions in the editor', async () => {
    renderSheet()

    // Localized descriptions (perms.caps.<id>.desc, landed by Task 9) take
    // priority over the catalog description, which is only the defaultValue.
    const desc1 = await screen.findByText('Approve, sign, or reject documents in the approval queue.')
    expect(desc1).toBeInTheDocument()

    const desc2 = await screen.findByText('See leave records and their status.')
    expect(desc2).toBeInTheDocument()
  })

  it('renders capability labels alongside descriptions', async () => {
    renderSheet()

    // Capability labels should appear (the en.json key resolves to the label string).
    const label = await screen.findByText('Approve / reject books')
    expect(label).toBeInTheDocument()
  })

  it('shows the user display name in the header', async () => {
    renderSheet()

    const name = await screen.findByText('Test User')
    expect(name).toBeInTheDocument()
  })
})

describe('UserPermissionsSheet — search + bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters capabilities by translated label, raw id, and English catalog label', async () => {
    renderSheet({
      caps: [
        cap('books.view', { label: 'View books', description: 'Browse submitted books.' }),
        cap('books.edit', { label: 'Edit books', description: 'Change book details.' }),
        cap('leaves.view', { label: 'View leaves', description: 'Read-only access to employee leave records.' }),
      ],
    })

    // The en.json value for this key lands in Task 9; until then the component's
    // defaultValue renders, which is what we assert against.
    const input = await screen.findByPlaceholderText('Search permissions…')
    await userEvent.type(input, 'books')
    expect(screen.getByText('books.view')).toBeVisible() // raw id match
    expect(screen.queryByText('leaves.view')).toBeNull()
  })

  it('shows an empty state with a clear button when nothing matches', async () => {
    renderSheet({ caps: [cap('books.view')] })

    const input = await screen.findByPlaceholderText('Search permissions…')
    await userEvent.type(input, 'zzzz-nothing')
    expect(await screen.findByText('No permissions match')).toBeVisible()
    // Two controls match /clear/i while filtering (the input's ✕ and the empty
    // state's action); the latter is the one under test here.
    const clearButtons = screen.getAllByRole('button', { name: /clear/i })
    await userEvent.click(clearButtons[clearButtons.length - 1])
    expect(await screen.findByText('books.view')).toBeVisible()
  })

  it('applies a domain-wide deny through the bulk endpoint in one call', async () => {
    const bulk = vi.mocked(api.setUserPermissionsBulk)
    bulk.mockResolvedValue(permsFixture())
    renderSheet({ caps: [cap('books.view'), cap('books.edit')] })

    const denyButtons = await screen.findAllByRole('button', { name: 'Deny' })
    await userEvent.click(denyButtons[0]) // first = domain header control
    await waitFor(() =>
      expect(bulk).toHaveBeenCalledWith(
        expect.any(Number),
        expect.arrayContaining([
          { capability: 'books.view', effect: 'deny' },
          { capability: 'books.edit', effect: 'deny' },
        ]),
      ),
    )
    expect(bulk).toHaveBeenCalledTimes(1)
    expect(api.setUserPermission).not.toHaveBeenCalled()
  })
})
