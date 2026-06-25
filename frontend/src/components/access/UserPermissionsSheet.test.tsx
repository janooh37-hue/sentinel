/**
 * UserPermissionsSheet — render tests.
 *
 * Asserts that capability descriptions are rendered in the editor.
 * Mocks `@/lib/api` so no real network calls are made.
 * Wraps the component in a minimal QueryClientProvider + i18n context
 * (i18n is initialised in the global test setup.ts).
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// ---------------------------------------------------------------------------
// Mock api
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  api: {
    listCapabilities: vi.fn().mockResolvedValue([
      {
        id: 'books.approve',
        domain: 'books',
        label: 'Approve / reject books',
        description: 'Allows approving or rejecting submitted books for sign-off.',
        default_roles: ['manager', 'admin'],
      },
      {
        id: 'leaves.view',
        domain: 'leaves',
        label: 'View leaves',
        description: 'Read-only access to employee leave records.',
        default_roles: ['operator', 'manager', 'admin'],
      },
    ]),
    getUserPermissions: vi.fn().mockResolvedValue({
      user_id: 42,
      role: 'operator',
      is_admin: false,
      effective: ['leaves.view'],
      role_defaults: ['leaves.view'],
      overrides: {},
    }),
    setUserPermission: vi.fn().mockResolvedValue({}),
  },
  ApiError: class ApiError extends Error {},
}))

// Import AFTER mock so the module is swapped.
import { UserPermissionsSheet } from './UserPermissionsSheet'
import { api } from '@/lib/api'

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
    vi.mocked(api.listCapabilities).mockResolvedValue([
      {
        id: 'books.approve',
        domain: 'books',
        label: 'Approve / reject books',
        description: 'Allows approving or rejecting submitted books for sign-off.',
        default_roles: ['manager', 'admin'],
      },
      {
        id: 'leaves.view',
        domain: 'leaves',
        label: 'View leaves',
        description: 'Read-only access to employee leave records.',
        default_roles: ['operator', 'manager', 'admin'],
      },
    ])
    vi.mocked(api.getUserPermissions).mockResolvedValue({
      user_id: 42,
      role: 'operator',
      is_admin: false,
      effective: ['leaves.view'],
      role_defaults: ['leaves.view'],
      overrides: {},
    })
  })

  it('renders capability descriptions in the editor', async () => {
    render(
      <Wrapper>
        <UserPermissionsSheet user={mockUser} onClose={() => {}} />
      </Wrapper>,
    )

    // Wait for the capability descriptions to appear (data loads asynchronously).
    const desc1 = await screen.findByText('Allows approving or rejecting submitted books for sign-off.')
    expect(desc1).toBeInTheDocument()

    const desc2 = await screen.findByText('Read-only access to employee leave records.')
    expect(desc2).toBeInTheDocument()
  })

  it('renders capability labels alongside descriptions', async () => {
    render(
      <Wrapper>
        <UserPermissionsSheet user={mockUser} onClose={() => {}} />
      </Wrapper>,
    )

    // Capability labels should appear (the en.json key resolves to the label string).
    const label = await screen.findByText('Approve / reject books')
    expect(label).toBeInTheDocument()
  })

  it('shows the user display name in the header', async () => {
    render(
      <Wrapper>
        <UserPermissionsSheet user={mockUser} onClose={() => {}} />
      </Wrapper>,
    )

    const name = await screen.findByText('Test User')
    expect(name).toBeInTheDocument()
  })
})
