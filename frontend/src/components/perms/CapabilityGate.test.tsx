/**
 * CapabilityGate — lock-mode wrapper tests.
 *
 * Key assertion: when a child is itself a <button>, the lock wrapper must NOT
 * be a <button> (no nested interactive elements). Uses a <span role="button">
 * instead.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
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
    requestPermission: vi.fn().mockResolvedValue({}),
  },
}))

import { useCapabilities } from '@/lib/useCapabilities'
import { api, type CapabilityRead } from '@/lib/api'
import { capabilityCatalogKey } from '@/lib/useCapabilityCatalog'
import i18n from '@/lib/i18n'
import { CapabilityGate } from '@/components/shell/CapabilityGate'

const mockUseCapabilities = vi.mocked(useCapabilities)

const CATALOG_ENTRY: CapabilityRead = {
  id: 'books.edit',
  domain: 'books',
  label_en: 'Edit records and attachments',
  label_ar: 'تعديل السجلات والمرفقات',
  description_en: 'Edit record content and attachments.',
  description_ar: 'تعديل محتوى السجلات ومرفقاتها.',
  sensitive: false,
  requestable: true,
  default_roles: ['manager', 'admin'],
}

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

function Wrapper({
  children,
  client = makeClient(),
}: {
  children: React.ReactNode
  client?: QueryClient
}) {
  return (
    <AuthContext.Provider value={fakeAuth}>
      <QueryClientProvider client={client}>
        {children}
      </QueryClientProvider>
    </AuthContext.Provider>
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.listCapabilities).mockResolvedValue([CATALOG_ENTRY])
})

describe('CapabilityGate lock mode — no nested interactive elements', () => {
  it('does not render a <button> containing a <button> when child is a button', async () => {
    // User does NOT have the capability → lock mode kicks in.
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })

    render(
      <Wrapper>
        <CapabilityGate cap="books.edit" requestable>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    // The wrapper with role="button" should be present.
    const roleButtons = await screen.findAllByRole('button')
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

  it('keeps a native visual child out of the sequential keyboard order', async () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    render(
      <Wrapper>
        <button type="button">Before</button>
        <CapabilityGate cap="books.edit" requestable>
          <button type="button">Manage</button>
        </CapabilityGate>
        <button type="button">After</button>
      </Wrapper>,
    )
    const user = userEvent.setup()
    const before = screen.getByRole('button', { name: 'Before' })
    const trigger = await screen.findByRole('button', { name: /Edit records and attachments/ })
    before.focus()

    await user.tab()
    expect(document.activeElement).toBe(trigger)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }))
  })

  it('renders children directly when user has the cap (no lock wrapper)', () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(['books.edit']),
      isLoading: false,
      has: (cap: string) => cap === 'books.edit',
    })

    render(
      <Wrapper>
        <CapabilityGate cap="books.edit" requestable>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    // When user has the cap, children render normally as a real button.
    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument()
  })

  it('opens a request for the exact known catalog capability from the keyboard', async () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    vi.mocked(api.listCapabilities).mockResolvedValueOnce([CATALOG_ENTRY])

    render(
      <Wrapper>
        <CapabilityGate cap="books.edit" requestable>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    const trigger = await screen.findByRole('button')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(await screen.findByRole('dialog')).toHaveTextContent('Edit records and attachments')
  })

  it('returns focus to the inline lock when Close cancels the request', async () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    const user = userEvent.setup()

    render(
      <Wrapper>
        <CapabilityGate cap="books.edit" requestable>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    const trigger = await screen.findByRole('button', {
      name: /Edit records and attachments/,
    })
    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: 'Close' }))

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('uses the Arabic runtime label in the lock accessible name without bidi controls', async () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    await i18n.changeLanguage('ar')
    vi.mocked(api.listCapabilities).mockResolvedValueOnce([
      { ...CATALOG_ENTRY, id: 'custom.export', label_ar: 'تصدير سجل القضايا' },
    ])

    render(
      <Wrapper>
        <CapabilityGate cap="custom.export" requestable>
          <button type="button">Export</button>
        </CapabilityGate>
      </Wrapper>,
    )

    const trigger = await screen.findByRole('button', { name: /تصدير سجل القضايا/ })
    expect(trigger.getAttribute('aria-label')).not.toMatch(/[\u2068\u2069]/u)
  })

  it('closes the request surface if refreshed metadata becomes non-requestable', async () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    const client = makeClient()
    render(
      <Wrapper client={client}>
        <CapabilityGate cap="books.edit" requestable fallback={<span>Unavailable</span>}>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    fireEvent.click(await screen.findByRole('button'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Edit records and attachments')

    act(() => {
      client.setQueryData(capabilityCatalogKey(fakeAuth.user!.id), [
        { ...CATALOG_ENTRY, requestable: false },
      ])
    })

    expect(await screen.findByText('Unavailable')).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows no request control while catalog requestability is loading', () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    vi.mocked(api.listCapabilities).mockImplementationOnce(() => new Promise(() => {}))

    render(
      <Wrapper>
        <CapabilityGate cap="books.edit" requestable fallback={<span>Unavailable</span>}>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    expect(screen.getByText('Unavailable')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows no request control when the catalog request fails', async () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    vi.mocked(api.listCapabilities).mockRejectedValueOnce(new Error('offline'))

    render(
      <Wrapper>
        <CapabilityGate cap="books.edit" requestable fallback={<span>Unavailable</span>}>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    await waitFor(() => expect(api.listCapabilities).toHaveBeenCalledOnce())
    expect(screen.getByText('Unavailable')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows no request control when the capability is absent from a loaded catalog', async () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    vi.mocked(api.listCapabilities).mockResolvedValueOnce([])
    const client = makeClient()

    render(
      <Wrapper client={client}>
        <CapabilityGate cap="books.edit" requestable fallback={<span>Unavailable</span>}>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(client.getQueryData(capabilityCatalogKey(fakeAuth.user!.id))).toEqual([])
    })
    expect(screen.getByText('Unavailable')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows no request control for an explicitly non-requestable capability', async () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    const nonRequestable = { ...CATALOG_ENTRY, requestable: false }
    vi.mocked(api.listCapabilities).mockResolvedValueOnce([nonRequestable])
    const client = makeClient()

    render(
      <Wrapper client={client}>
        <CapabilityGate cap="books.edit" requestable fallback={<span>Unavailable</span>}>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(client.getQueryData(capabilityCatalogKey(fakeAuth.user!.id))).toEqual([
        nonRequestable,
      ])
    })
    expect(screen.getByText('Unavailable')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders authorized children immediately while the catalog is still loading', () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(['books.edit']),
      isLoading: false,
      has: (cap: string) => cap === 'books.edit',
    })
    vi.mocked(api.listCapabilities).mockImplementationOnce(() => new Promise(() => {}))

    render(
      <Wrapper>
        <CapabilityGate cap="books.edit" requestable>
          <button type="button">Manage</button>
        </CapabilityGate>
      </Wrapper>,
    )

    expect(screen.getByRole('button', { name: 'Manage' })).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('hides catalog-sensitive caps even when requestable=true', async () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    const sensitive = {
      ...CATALOG_ENTRY,
      id: 'users.manage',
      sensitive: true,
      requestable: false,
    }
    vi.mocked(api.listCapabilities).mockResolvedValueOnce([sensitive])
    const client = makeClient()

    render(
      <Wrapper client={client}>
        <CapabilityGate cap="users.manage" requestable>
          <button type="button">Users</button>
        </CapabilityGate>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(client.getQueryData(capabilityCatalogKey(fakeAuth.user!.id))).toEqual([sensitive])
    })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
