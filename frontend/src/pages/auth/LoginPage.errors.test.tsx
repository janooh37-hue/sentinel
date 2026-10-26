/**
 * Sign-in refusals: a code-specific 403 keeps its own message instead of the
 * shared permission text, in both languages.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import i18n from '@/lib/i18n'
import { LoginPage } from './LoginPage'

const { login } = vi.hoisted(() => ({ login: vi.fn() }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ login, setUser: vi.fn() }) }))

async function signIn(): Promise<void> {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(i18n.t('auth.email')), 'ops@gssg.ae')
  await user.type(screen.getByLabelText(i18n.t('auth.password')), 'correct horse')
  await user.click(screen.getByRole('button', { name: i18n.t('auth.signIn') }))
}

describe('LoginPage sign-in refusals', () => {
  beforeEach(() => {
    window.localStorage.clear()
    login.mockReset()
  })
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('tells a declined applicant to contact IT, not that they lack permission', async () => {
    login.mockRejectedValue(new ApiError(403, 'ACCOUNT_REJECTED', 'Your access request was declined. Contact IT.'))
    render(<LoginPage />)
    await signIn()
    expect(await screen.findByText('Your access request was declined. Contact IT.')).toBeInTheDocument()
    expect(screen.queryByText("You don't have permission for this")).not.toBeInTheDocument()
  })

  it('tells a declined applicant in Arabic', async () => {
    await i18n.changeLanguage('ar')
    login.mockRejectedValue(new ApiError(403, 'ACCOUNT_REJECTED', 'Your access request was declined. Contact IT.'))
    render(<LoginPage />)
    await signIn()
    expect(await screen.findByText('رُفض طلب الوصول. تواصل مع قسم تقنية المعلومات.')).toBeInTheDocument()
  })

  it('keeps the shared permission message for a 403 without a specific code', async () => {
    login.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Admin access required.'))
    render(<LoginPage />)
    await signIn()
    expect(await screen.findByText("You don't have permission for this")).toBeInTheDocument()
  })
})
