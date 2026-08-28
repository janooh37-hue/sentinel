import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/api', () => ({ api: apiMocks }))

import i18n from '@/lib/i18n'
import { RequireCapability } from './RequireCapability'

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
  apiMocks.listCapabilities.mockResolvedValue([])
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('RequireCapability non-requestable permissions', () => {
  it.each(['users.manage', 'system.admin'])(
    'explains that %s is administrator-managed without offering a request',
    async (capability) => {
      renderGuard(capability)

      expect(
        screen.getByText(
          'Access to this area is managed by administrators and cannot be requested.',
        ),
      ).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
      expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
      expect(apiMocks.listCapabilities).not.toHaveBeenCalled()
    },
  )

  it('falls back to the approved English explanation when the locale key is unavailable', () => {
    const bundle = structuredClone(
      i18n.getResourceBundle('en', 'translation') as Record<string, unknown>,
    )
    i18n.removeResourceBundle('en', 'translation')
    try {
      renderGuard('users.manage')
      expect(
        screen.getByText(
          'Access to this area is managed by administrators and cannot be requested.',
        ),
      ).toBeVisible()
    } finally {
      cleanup()
      i18n.addResourceBundle('en', 'translation', bundle, true, true)
    }
  })
})
