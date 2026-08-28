import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set(['users.manage']),
    isLoading: false,
    has: (capability: string) => capability === 'users.manage',
  }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({ theme: 'light', font_scale: 16 }),
    updateSettings: vi.fn(),
  },
}))

import { NavDrawer } from './NavDrawer'

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
