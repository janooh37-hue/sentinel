import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      authFeatures: vi.fn(),
      register: vi.fn(),
      requestEmailVerification: vi.fn().mockResolvedValue({ status: 'accepted' }),
      verifyEmail: vi.fn(),
      requestPasswordReset: vi.fn().mockResolvedValue({ status: 'accepted' }),
      completePasswordReset: vi.fn(),
    },
  }
})

import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { LoginPage } from './LoginPage'

vi.mock('@/lib/authContext', () => ({
  useAuth: vi.fn(),
}))

function renderLoginPage(entry?: { kind: 'verify' | 'reset'; token: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <LoginPage entry={entry} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const mockLogin = vi.fn()
const mockSetUser = vi.fn()
const mockRefetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    status: 'anon',
    login: mockLogin,
    logout: vi.fn(),
    refetch: mockRefetch,
    setUser: mockSetUser,
  })
})

afterEach(() => {
  cleanup()
})

describe('LoginPage — request access with account-mail on', () => {
  it('shows the verify-sent copy and lets the user resend the confirmation email', async () => {
    vi.mocked(api.authFeatures).mockResolvedValue({ account_mail: true })
    vi.mocked(api.register).mockResolvedValue({ status: 'verify_email', is_first: false, user: null })
    renderLoginPage()

    await userEvent.click(await screen.findByText('Request access'))
    await userEvent.type(screen.getByLabelText('Email'), 'new@x.ae')
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    expect(await screen.findByText('Check your inbox')).toBeVisible()
    expect(api.register).toHaveBeenCalledWith({
      email: 'new@x.ae',
      password: 'password123',
      g_number: null,
      locale: 'en',
    })

    await userEvent.click(screen.getByRole('button', { name: 'Resend email' }))
    await waitFor(() =>
      expect(api.requestEmailVerification).toHaveBeenCalledWith('new@x.ae', 'en'),
    )
  })
})

describe('LoginPage — login rejected as unverified', () => {
  it('shows the unverified screen and offers a resend action', async () => {
    vi.mocked(api.authFeatures).mockResolvedValue({ account_mail: true })
    mockLogin.mockRejectedValue(
      new ApiError(403, 'ACCOUNT_EMAIL_UNVERIFIED', 'Confirm your email address first.'),
    )
    renderLoginPage()

    await userEvent.type(screen.getByLabelText('Email'), 'pending@x.ae')
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Confirm your email')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Resend email' }))
    await waitFor(() =>
      expect(api.requestEmailVerification).toHaveBeenCalledWith('pending@x.ae', 'en'),
    )
  })
})

describe('LoginPage — forgot password', () => {
  it('with account-mail on: submits an email field and shows the generic sent copy', async () => {
    vi.mocked(api.authFeatures).mockResolvedValue({ account_mail: true })
    renderLoginPage()

    await userEvent.click(screen.getByText('Forgot password?'))
    const emailInput = screen.getByLabelText('Email')
    await userEvent.clear(emailInput)
    await userEvent.type(emailInput, 'reset-me@x.ae')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() =>
      expect(api.requestPasswordReset).toHaveBeenCalledWith('reset-me@x.ae', 'en'),
    )
    expect(await screen.findByText('Check your inbox')).toBeVisible()
  })

  it('with account-mail off: still shows the IT-contact panel, not an email form', async () => {
    vi.mocked(api.authFeatures).mockResolvedValue({ account_mail: false })
    renderLoginPage()

    await userEvent.click(screen.getByText('Forgot password?'))

    expect(await screen.findByText('IT support')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Send reset link' })).not.toBeInTheDocument()
  })
})

describe('LoginPage — verify-email entry', () => {
  it('calls verifyEmail exactly once and shows the success state', async () => {
    vi.mocked(api.authFeatures).mockResolvedValue({ account_mail: true })
    vi.mocked(api.verifyEmail).mockResolvedValue({ status: 'verified' })
    renderLoginPage({ kind: 'verify', token: 'good-token' })

    expect(await screen.findByText('Email confirmed')).toBeVisible()
    expect(api.verifyEmail).toHaveBeenCalledTimes(1)
    expect(api.verifyEmail).toHaveBeenCalledWith('good-token')
  })

  it('shows the invalid-link state and a resend field on failure', async () => {
    vi.mocked(api.authFeatures).mockResolvedValue({ account_mail: true })
    vi.mocked(api.verifyEmail).mockRejectedValue(
      new ApiError(400, 'EMAIL_LINK_INVALID', 'This link is invalid or has expired.'),
    )
    renderLoginPage({ kind: 'verify', token: 'bad-token' })

    expect(await screen.findByText('Link expired or invalid')).toBeVisible()
    expect(screen.getByLabelText('Email')).toBeVisible()
  })
})

describe('LoginPage — reset-password entry', () => {
  it('blocks a mismatched confirmation client-side without calling the API', async () => {
    vi.mocked(api.authFeatures).mockResolvedValue({ account_mail: true })
    renderLoginPage({ kind: 'reset', token: 'reset-token' })

    await userEvent.type(screen.getByLabelText('New password'), 'password123')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'differentpwd')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByText("Passwords don't match.")).toBeVisible()
    expect(api.completePasswordReset).not.toHaveBeenCalled()
  })

  it('submits matching passwords, refetches the session, and shows the done screen', async () => {
    vi.mocked(api.authFeatures).mockResolvedValue({ account_mail: true })
    vi.mocked(api.completePasswordReset).mockResolvedValue({ status: 'reset' })
    renderLoginPage({ kind: 'reset', token: 'reset-token' })

    await userEvent.type(screen.getByLabelText('New password'), 'password123')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() =>
      expect(api.completePasswordReset).toHaveBeenCalledWith(
        'reset-token',
        'password123',
        'password123',
      ),
    )
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled())
    expect(await screen.findByText('Password updated')).toBeVisible()
  })
})
