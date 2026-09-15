import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      authFeatures: vi.fn().mockResolvedValue({ account_mail: true }),
      verifyEmail: vi.fn().mockResolvedValue({ status: 'verified' }),
      completePasswordReset: vi.fn(),
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

import { api, ApiError } from '@/lib/api'
import { PublicAuthRoute } from './PublicAuthRoute'

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/verify-email" element={<PublicAuthRoute kind="verify" />} />
          <Route path="/reset-password" element={<PublicAuthRoute kind="reset" />} />
          <Route path="/" element={<div data-testid="home-route">Home route</div>} />
        </Routes>
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

  it('keeps the scrubbed reset route mounted while opening expired-link recovery', async () => {
    window.history.pushState({}, '', '/reset-password?token=expired-token')
    vi.mocked(api.completePasswordReset).mockRejectedValue(
      new ApiError(
        400,
        'PASSWORD_RESET_LINK_INVALID',
        'This reset link is invalid, expired or already used.',
      ),
    )
    renderRoute()

    await waitFor(() => expect(window.location.search).toBe(''))
    await userEvent.type(screen.getByLabelText('New password'), 'replacement-2')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'replacement-2')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    expect(await screen.findByText('Link expired or invalid')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText('Forgot password')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeVisible()
    expect(screen.queryByTestId('home-route')).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/reset-password')
    expect(window.location.search).toBe('')
  })
})
