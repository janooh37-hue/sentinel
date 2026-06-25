/**
 * PermissionRequestsTab contract tests.
 *
 * Locks the decide-body shape: verifies that each decision path
 * (permanent / once+window / refused+note) calls api.decidePermissionRequest
 * with the exact arguments the backend expects.
 *
 * Mocks `@/lib/api` so no real network calls are made.
 * Wraps the component in a minimal QueryClientProvider + i18n context
 * (i18n is initialised in the global test setup.ts).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// ---------------------------------------------------------------------------
// Mock api
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  api: {
    listPermissionRequests: vi.fn().mockResolvedValue([
      {
        id: 1,
        user_id: 5,
        requester_name: 'Saeed',
        capability: 'books.approve',
        capability_label: 'Approve / reject books',
        status: 'pending',
        decision: null,
        created_at: new Date().toISOString(),
      },
    ]),
    listCapabilities: vi.fn().mockResolvedValue([
      {
        id: 'books.approve',
        domain: 'books',
        label: 'Approve / reject books',
        description: 'Allows approving or rejecting submitted books.',
        default_roles: [],
      },
    ]),
    decidePermissionRequest: vi.fn().mockResolvedValue({}),
  },
  ApiError: class ApiError extends Error {},
}))

// Import AFTER mock so the module is swapped.
import { PermissionRequestsTab } from './PermissionRequestsTab'
import { api } from '@/lib/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

describe('PermissionRequestsTab — decide-body contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-apply default resolved values after clearAllMocks wipes them.
    vi.mocked(api.listPermissionRequests).mockResolvedValue([
      {
        id: 1,
        user_id: 5,
        requester_name: 'Saeed',
        capability: 'books.approve',
        capability_label: 'Approve / reject books',
        status: 'pending',
        decision: null,
        created_at: new Date().toISOString(),
      },
    ])
    vi.mocked(api.listCapabilities).mockResolvedValue([
      {
        id: 'books.approve',
        domain: 'books',
        label: 'Approve / reject books',
        description: 'Allows approving or rejecting submitted books.',
        default_roles: [],
      },
    ])
    vi.mocked(api.decidePermissionRequest).mockResolvedValue({})
  })

  it('Test A: Grant permanent → called with (1, { decision: "permanent" })', async () => {
    render(
      <Wrapper>
        <PermissionRequestsTab />
      </Wrapper>,
    )

    // Wait for the card to appear (data loads asynchronously).
    const grantPermanentBtn = await screen.findByRole('button', { name: /grant permanently/i })
    fireEvent.click(grantPermanentBtn)

    await waitFor(() => {
      expect(api.decidePermissionRequest).toHaveBeenCalledOnce()
      expect(api.decidePermissionRequest).toHaveBeenCalledWith(1, { decision: 'permanent' })
    })
  })

  it('Test B: pick "2 h" window then Grant once → called with (1, { decision: "once", window: "2h" })', async () => {
    render(
      <Wrapper>
        <PermissionRequestsTab />
      </Wrapper>,
    )

    // Default window is already "2h". Click its pill to make sure it is selected.
    const window2hBtn = await screen.findByRole('button', { name: /^2 h$/i })
    fireEvent.click(window2hBtn)

    const grantOnceBtn = screen.getByRole('button', { name: /grant once/i })
    fireEvent.click(grantOnceBtn)

    await waitFor(() => {
      expect(api.decidePermissionRequest).toHaveBeenCalledOnce()
      expect(api.decidePermissionRequest).toHaveBeenCalledWith(1, { decision: 'once', window: '2h' })
    })
  })

  it('Test C: open refuse, type a note, confirm → called with (1, { decision: "refused", note: <typed text> })', async () => {
    render(
      <Wrapper>
        <PermissionRequestsTab />
      </Wrapper>,
    )

    // Open the refuse inline form.
    const refuseBtn = await screen.findByRole('button', { name: /^refuse$/i })
    fireEvent.click(refuseBtn)

    // Type a note in the text input.
    const noteInput = screen.getByPlaceholderText(/optional note/i)
    fireEvent.change(noteInput, { target: { value: 'Not eligible yet' } })

    // Confirm refusal — the confirm button also has text "Refuse".
    // After the form opens there are two Refuse-labeled buttons: the original is
    // gone (replaced by the inline form), so we pick the one inside the form.
    const confirmRefuseBtn = screen.getAllByRole('button', { name: /refuse/i })
    // The confirm button is the last one (inline form's confirm).
    fireEvent.click(confirmRefuseBtn[confirmRefuseBtn.length - 1]!)

    await waitFor(() => {
      expect(api.decidePermissionRequest).toHaveBeenCalledOnce()
      expect(api.decidePermissionRequest).toHaveBeenCalledWith(1, {
        decision: 'refused',
        note: 'Not eligible yet',
      })
    })
  })
})
