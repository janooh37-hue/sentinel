import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type CapabilityRead, type SessionUser } from '@/lib/api'

import { AuthProvider } from './AuthProvider'
import { useAuth } from './authContext'
import { capabilityCatalogKey, useCapabilityCatalog } from './useCapabilityCatalog'

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
  idle_lock_seconds: 1800,
  lock_layout: 'band',
}

function LoginButton(): React.JSX.Element {
  const { login } = useAuth()
  return (
    <button type="button" onClick={() => void login('abdulla@example.test', 'Secret123!')}>
      Sign in
    </button>
  )
}

function CatalogAuthControls(): React.JSX.Element {
  const { login, logout, status, user } = useAuth()
  const catalog = useCapabilityCatalog()
  if (status !== 'authed' || user == null) {
    return (
      <button type="button" onClick={() => void login('next@example.test', 'Secret123!')}>
        Sign in next
      </button>
    )
  }
  return (
    <div>
      <span>{user.id}:{catalog.entries[0]?.id ?? catalog.status}</span>
      <button type="button" onClick={() => void logout()}>Sign out</button>
    </div>
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

  it('removes the old identity catalog on logout and fetches again after re-authentication', async () => {
    const nextUser = { ...USER, id: 8, email: 'next@example.test' }
    const entry: CapabilityRead = {
      id: 'books.view',
      domain: 'books',
      label_en: 'View records',
      label_ar: 'عرض السجلات',
      description_en: 'Browse records.',
      description_ar: 'عرض السجلات.',
      sensitive: false,
      requestable: true,
      default_roles: ['operator', 'manager', 'admin'],
    }
    vi.mocked(api.authMe).mockResolvedValueOnce(USER)
    vi.mocked(api.login).mockResolvedValueOnce(nextUser)
    vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    vi.spyOn(api, 'listCapabilities')
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce([{ ...entry, id: 'leaves.view', domain: 'leaves' }])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <CatalogAuthControls />
        </AuthProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('7:books.view')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('button', { name: 'Sign in next' })).toBeVisible()
    expect(client.getQueryData(capabilityCatalogKey(USER.id))).toBeUndefined()

    await userEvent.click(screen.getByRole('button', { name: 'Sign in next' }))
    expect(await screen.findByText('8:leaves.view')).toBeVisible()
    expect(api.listCapabilities).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(capabilityCatalogKey(USER.id))).toBeUndefined()
    expect(client.getQueryData(capabilityCatalogKey(nextUser.id))).toEqual([
      { ...entry, id: 'leaves.view', domain: 'leaves' },
    ])
  })
})
