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
import type { CapabilityRequestState } from '@/lib/useCapabilityCatalog'
import i18n from '@/lib/i18n'

const REQUEST: Extract<CapabilityRequestState, { kind: 'requestable' }> = {
  kind: 'requestable',
  entry: {
    id: 'documents.scan',
    domain: 'documents',
    label_en: 'Scan documents',
    label_ar: 'مسح المستندات',
    description_en: 'OCR-scan uploaded documents.',
    description_ar: 'مسح المستندات المرفوعة ضوئياً.',
    sensitive: false,
    requestable: true,
    default_roles: ['operator', 'manager', 'admin'],
  },
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

describe('PermissionRequestDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
  })

  it('renders the label in the dialog body', () => {
    render(
      <Wrapper>
        <PermissionRequestDialog
          request={REQUEST}
          open
          onClose={() => {}}
          returnFocusRef={React.createRef<HTMLElement>()}
        />
      </Wrapper>,
    )
    expect(screen.getByText(/Scan documents/i)).toBeInTheDocument()
  })

  it('directionally isolates Arabic catalog values in the interpolated body', async () => {
    await i18n.changeLanguage('ar')
    render(
      <Wrapper>
        <PermissionRequestDialog
          request={REQUEST}
          open
          onClose={() => {}}
          returnFocusRef={React.createRef<HTMLElement>()}
        />
      </Wrapper>,
    )

    const body = screen.getByText(
      (_, element) =>
        element?.tagName === 'P' &&
        element.textContent?.includes('\u2068مسح المستندات\u2069') === true,
    )
    expect(body).toHaveTextContent('\u2068مسح المستندات\u2069')
    expect(body).toHaveTextContent('\u2068مسح المستندات المرفوعة ضوئياً.\u2069')
  })

  it('calls api.requestPermission with the capability when Request is clicked', async () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <PermissionRequestDialog
          request={REQUEST}
          open
          onClose={onClose}
          returnFocusRef={React.createRef<HTMLElement>()}
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
          request={REQUEST}
          open
          onClose={onClose}
          returnFocusRef={React.createRef<HTMLElement>()}
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
          request={REQUEST}
          open
          onClose={onClose}
          returnFocusRef={React.createRef<HTMLElement>()}
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
