/**
 * CapabilityGate — lock-mode wrapper tests.
 *
 * Key assertion: when a child is itself a <button>, the lock wrapper must NOT
 * be a <button> (no nested interactive elements). Uses a <span role="button">
 * instead.
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import { AuthContext } from '@/lib/authContext'
import type { AuthContextValue } from '@/lib/authContext'

// Mock useCapabilities so we can control whether the cap is present.
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: vi.fn(),
}))

// Mock the api module (catalog lookup).
vi.mock('@/lib/api', () => ({
  api: {
    listCapabilities: vi.fn().mockResolvedValue([]),
    myCapabilities: vi.fn().mockResolvedValue([]),
  },
}))

// Mock PermissionRequestDialog — we only care about the wrapper structure.
vi.mock('@/components/perms/PermissionRequestDialog', () => ({
  PermissionRequestDialog: () => <div data-testid="perm-dialog" />,
}))

import { useCapabilities } from '@/lib/useCapabilities'
import { CapabilityGate } from '@/components/shell/CapabilityGate'

const mockUseCapabilities = vi.mocked(useCapabilities)

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

const fakeAuth: AuthContextValue = {
  user: { id: 1, name: 'Test', email: 'test@example.com', employee_id: null, role: 'staff' } as never,
  status: 'authed',
  login: vi.fn(),
  logout: vi.fn(),
  refetch: vi.fn(),
  setUser: vi.fn(),
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const client = makeClient()
  return (
    <AuthContext.Provider value={fakeAuth}>
      <QueryClientProvider client={client}>
        {children}
      </QueryClientProvider>
    </AuthContext.Provider>
  )
}

describe('CapabilityGate lock mode — no nested interactive elements', () => {
  it('does not render a <button> containing a <button> when child is a button', () => {
    // User does NOT have the capability → lock mode kicks in.
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })

    render(
      <Wrapper>
        <CapabilityGate cap="books.manage" requestable>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    // The wrapper with role="button" should be present.
    const roleButtons = screen.getAllByRole('button')
    // There is only one interactive element visible (the lock wrapper).
    expect(roleButtons.length).toBe(1)
    // The outermost role="button" must NOT be a <button> element — it should
    // be a <span> (or similar non-interactive tag) so we never get a <button>
    // nesting a <button>.
    expect(roleButtons[0].tagName.toLowerCase()).not.toBe('button')

    // The outermost role="button" must be a span, not a button element —
    // confirming there is no button-inside-button nesting.
    expect(roleButtons[0].tagName.toLowerCase()).toBe('span')
  })

  it('renders children directly when user has the cap (no lock wrapper)', () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(['books.manage']),
      isLoading: false,
      has: (cap: string) => cap === 'books.manage',
    })

    render(
      <Wrapper>
        <CapabilityGate cap="books.manage" requestable>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    // When user has the cap, children render normally as a real button.
    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument()
  })

  it('hides sensitive caps even when requestable=true', () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })

    render(
      <Wrapper>
        <CapabilityGate cap="users.manage" requestable>
          <button type="button">Users</button>
        </CapabilityGate>
      </Wrapper>,
    )

    // Sensitive cap → hidden entirely, no button or role-button visible.
    expect(screen.queryByRole('button')).toBeNull()
  })
})
