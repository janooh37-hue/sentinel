/**
 * PermissionRequestDialog unit tests.
 *
 * Mocks `@/lib/api` so no real network calls are made.
 * Wraps the component in a minimal QueryClientProvider + i18n context
 * (i18n is initialised in the global test setup.ts).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock the api module so requestPermission is a spy we control.
vi.mock('@/lib/api', () => ({
  api: {
    requestPermission: vi.fn().mockResolvedValue({}),
    listCapabilities: vi.fn().mockResolvedValue([]),
  },
}))

// Import AFTER mock so the module is swapped.
import { PermissionRequestDialog } from './PermissionRequestDialog'
import { api } from '@/lib/api'

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

describe('PermissionRequestDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the label in the dialog body', () => {
    render(
      <Wrapper>
        <PermissionRequestDialog
          capability="documents.scan"
          label="Scan documents"
          description="Lets you OCR-scan uploaded documents."
          open
          onClose={() => {}}
        />
      </Wrapper>,
    )
    expect(screen.getByText(/Scan documents/i)).toBeInTheDocument()
  })

  it('calls api.requestPermission with the capability when Request is clicked', async () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <PermissionRequestDialog
          capability="documents.scan"
          label="Scan documents"
          description="Lets you OCR-scan uploaded documents."
          open
          onClose={onClose}
        />
      </Wrapper>,
    )

    // Click the Request button (i18n default value: "Request")
    fireEvent.click(screen.getByRole('button', { name: /request/i }))

    await waitFor(() => {
      expect(api.requestPermission).toHaveBeenCalledOnce()
      expect(api.requestPermission).toHaveBeenCalledWith('documents.scan')
    })
  })

  it('closes the dialog when Close is clicked without making an API call', () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <PermissionRequestDialog
          capability="documents.scan"
          label="Scan documents"
          description="Lets you OCR-scan uploaded documents."
          open
          onClose={onClose}
        />
      </Wrapper>,
    )

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(api.requestPermission).not.toHaveBeenCalled()
  })

  it('keeps the dialog open when request fails', async () => {
    const onClose = vi.fn()
    vi.mocked(api.requestPermission).mockRejectedValueOnce(new Error('boom'))

    render(
      <Wrapper>
        <PermissionRequestDialog
          capability="documents.scan"
          label="Scan documents"
          description="Lets you OCR-scan uploaded documents."
          open
          onClose={onClose}
        />
      </Wrapper>,
    )

    fireEvent.click(screen.getByRole('button', { name: /request/i }))

    // Wait for the mutation to settle
    await waitFor(() => {
      expect(api.requestPermission).toHaveBeenCalledOnce()
    })

    // Dialog should NOT close on error
    expect(onClose).not.toHaveBeenCalled()
  })
})
