import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type SessionUser } from '@/lib/api'

import { AuthProvider } from './AuthProvider'
import { useAuth } from './authContext'

const USER: SessionUser = {
  id: 7,
  email: 'abdulla@example.test',
  employee_id: 'G-1007',
  name_en: 'Abdulla Aldhaheri',
  name_ar: 'عبدالله الظاهري',
  position: 'Officer',
  department: 'Operations',
  photo_url: null,
  role: 'operator',
  status: 'active',
  is_admin: false,
  is_manager: false,
  has_signature: false,
}

function LoginButton(): React.JSX.Element {
  const { login } = useAuth()
  return (
    <button type="button" onClick={() => void login('abdulla@example.test', 'Secret123!')}>
      Sign in
    </button>
  )
}

describe('AuthProvider login activity', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(api, 'authMe').mockResolvedValue(null)
    vi.spyOn(api, 'login').mockResolvedValue(USER)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('seeds the idle deadline after a successful login', async () => {
    const now = new Date('2026-08-28T10:00:00.000Z').getTime()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(now)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['ledger', 'unread-recent'], {
      items: [{ subject: 'Previous account only' }],
      total_unread: 4,
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <LoginButton />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      const activity = Number(localStorage.getItem('gssg.lastActivity'))
      expect(activity).toBeGreaterThanOrEqual(now)
      expect(activity).toBeLessThanOrEqual(Date.now())
      expect(client.getQueryData(['ledger', 'unread-recent'])).toBeUndefined()
    })
  })
})
