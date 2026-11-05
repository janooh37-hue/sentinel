import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({ theme: 'light', font_scale: 16 }),
    updateSettings: vi.fn(),
  },
}))

import { NavDrawer } from './NavDrawer'

beforeEach(() => {
  capabilityState.allowed = new Set(['users.manage'])
})

it('hides the mobile Settings entry without settings.view', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <NavDrawer open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  )

  expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Access requests' })).toBeVisible()
})

it.each([
  { caps: [], visible: false },
  { caps: ['uniform.view'], visible: true },
  { caps: ['store.view'], visible: true },
  { caps: ['store.view', 'uniform.view'], visible: true },
])('shows the mobile Assets entry only with a viewable section: $caps', ({ caps, visible }) => {
  capabilityState.allowed = new Set(caps)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <NavDrawer open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  )

  const link = screen.queryByRole('link', { name: 'Assets' })
  if (visible) {
    expect(link).toHaveAttribute('href', '/holdings')
  } else {
    expect(link).not.toBeInTheDocument()
  }
})
