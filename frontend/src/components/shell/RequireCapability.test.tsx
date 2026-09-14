import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

const capabilityState = vi.hoisted(() => ({ granted: new Set<string>() }))
const apiMocks = vi.hoisted(() => ({
  listCapabilities: vi.fn(),
  requestPermission: vi.fn(),
}))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    has: (capability: string) => capabilityState.granted.has(capability),
    isLoading: false,
  }),
}))

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ status: 'authed', user: { id: 23 } }),
}))

vi.mock('@/lib/api', () => ({ api: apiMocks }))

import i18n from '@/lib/i18n'
import type { CapabilityRead } from '@/lib/api'
import { RequireCapability } from './RequireCapability'

const CATALOG_ENTRY: CapabilityRead = {
  id: 'books.view',
  domain: 'books',
  label_en: 'View records',
  label_ar: 'عرض السجلات',
  description_en: 'Read registered records.',
  description_ar: 'قراءة السجلات المسجلة.',
  sensitive: false,
  requestable: true,
  default_roles: ['operator', 'manager', 'admin'],
}

function renderGuard(capability: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <RequireCapability cap={capability}>
        <div>Protected content</div>
      </RequireCapability>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  capabilityState.granted.clear()
  apiMocks.listCapabilities.mockResolvedValue([CATALOG_ENTRY])
  apiMocks.requestPermission.mockResolvedValue({})
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('RequireCapability non-requestable permissions', () => {
  it('renders authorized content immediately without waiting for the catalog', () => {
    capabilityState.granted.add('books.view')
    apiMocks.listCapabilities.mockImplementationOnce(() => new Promise(() => {}))

    renderGuard('books.view')

    expect(screen.getByText('Protected content')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })

  it('submits the exact capability for a known requestable route denial', async () => {
    renderGuard('books.view')

    const trigger = await screen.findByRole('button', { name: 'Request access' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('button', { name: 'Request' }))

    await waitFor(() => {
      expect(apiMocks.requestPermission).toHaveBeenCalledOnce()
      expect(apiMocks.requestPermission).toHaveBeenCalledWith('books.view')
      expect(trigger).toHaveFocus()
    })
  })

  it('returns focus to Request access when Escape closes the trapped dialog', async () => {
    const user = userEvent.setup()
    renderGuard('books.view')
    const trigger = await screen.findByRole('button', { name: 'Request access' })

    await user.click(trigger)
    const request = await screen.findByRole('button', { name: 'Request' })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(request).toHaveFocus()

    await user.tab()
    expect(close).toHaveFocus()
    await user.tab()
    expect(request).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('shows the route denial without a request control while the catalog is loading', () => {
    apiMocks.listCapabilities.mockImplementationOnce(() => new Promise(() => {}))

    renderGuard('books.view')

    expect(screen.getByText("You don't have access to this page")).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })

  it('shows the route denial without a request control when the catalog fails', async () => {
    apiMocks.listCapabilities.mockRejectedValueOnce(new Error('offline'))

    renderGuard('books.view')

    expect(await screen.findByText("You don't have access to this page")).toBeVisible()
    await waitFor(() => expect(apiMocks.listCapabilities).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })

  it('shows the route denial without a request control for an unknown capability', async () => {
    apiMocks.listCapabilities.mockResolvedValueOnce([])

    renderGuard('books.view')

    expect(await screen.findByText("You don't have access to this page")).toBeVisible()
    await waitFor(() => expect(apiMocks.listCapabilities).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })

  it.each(['users.manage', 'system.admin'])(
    'explains that %s is administrator-managed without offering a request',
    async (capability) => {
      apiMocks.listCapabilities.mockResolvedValueOnce([
        { ...CATALOG_ENTRY, id: capability, sensitive: true, requestable: false },
      ])
      renderGuard(capability)

      expect(
        await screen.findByText(
          'Access to this area is managed by administrators and cannot be requested.',
        ),
      ).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
      expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
      expect(apiMocks.listCapabilities).toHaveBeenCalledOnce()
    },
  )

  it('falls back to the approved English explanation when the locale key is unavailable', async () => {
    const bundle = structuredClone(
      i18n.getResourceBundle('en', 'translation') as Record<string, unknown>,
    )
    i18n.removeResourceBundle('en', 'translation')
    try {
      apiMocks.listCapabilities.mockResolvedValueOnce([
        { ...CATALOG_ENTRY, id: 'users.manage', sensitive: true, requestable: false },
      ])
      renderGuard('users.manage')
      expect(
        await screen.findByText(
          'Access to this area is managed by administrators and cannot be requested.',
        ),
      ).toBeVisible()
    } finally {
      cleanup()
      i18n.addResourceBundle('en', 'translation', bundle, true, true)
    }
  })
})
