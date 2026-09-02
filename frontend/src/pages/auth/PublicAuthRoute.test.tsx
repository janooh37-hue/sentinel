import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      authFeatures: vi.fn().mockResolvedValue({ account_mail: true }),
      verifyEmail: vi.fn().mockResolvedValue({ status: 'verified' }),
    },
  }
})

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({
    user: null,
    status: 'anon',
    login: vi.fn(),
    logout: vi.fn(),
    refetch: vi.fn(),
    setUser: vi.fn(),
  }),
}))

import { api } from '@/lib/api'
import { PublicAuthRoute } from './PublicAuthRoute'

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <PublicAuthRoute kind="verify" />
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

describe('PublicAuthRoute', () => {
  it('captures the token from the query string and hands it to LoginPage', async () => {
    window.history.pushState({}, '', '/verify-email?token=abc123')

    renderRoute()

    await waitFor(() => expect(api.verifyEmail).toHaveBeenCalledWith('abc123'))
  })

  it('strips the token from the address bar via a replace navigation', async () => {
    window.history.pushState({}, '', '/verify-email?token=abc123')

    renderRoute()

    await waitFor(() => expect(window.location.search).toBe(''))
    expect(window.location.pathname).toBe('/verify-email')
  })

  it('renders LoginPage with an empty token when the link is missing one', async () => {
    window.history.pushState({}, '', '/verify-email')

    renderRoute()

    // No token to verify — api.verifyEmail must never be called.
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(api.verifyEmail).not.toHaveBeenCalled()
  })
})
