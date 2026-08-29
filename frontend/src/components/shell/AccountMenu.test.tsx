import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type SessionUser } from '@/lib/api'
import { AuthProvider } from '@/lib/AuthProvider'
import { AUTH_KEY } from '@/lib/authContext'
import i18n from '@/lib/i18n'

import { AccountMenu } from './AccountMenu'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

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

function renderMenu(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
): QueryClient {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <AccountMenu onLock={vi.fn()} />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}
async function openMenu(user: UserEvent): Promise<void> {
  await user.click(await screen.findByRole('button', { name: USER.email }))
}

describe('AccountMenu lock timer', () => {
  beforeEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage('en')
    vi.spyOn(api, 'authMe').mockResolvedValue(USER)
    vi.spyOn(api, 'getEmailAccount').mockResolvedValue(null)
    vi.mocked(toast.error).mockReset()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('en')
  })

  it('steps down immediately and survives a late session refetch', async () => {
    let releaseStaleMe: () => void = () => {
      throw new Error('stale auth request did not start')
    }
    let releasePatch: (value: SessionUser) => void = () => {
      throw new Error('lock timer request did not start')
    }
    vi.mocked(api.authMe)
      .mockResolvedValueOnce(USER)
      .mockImplementationOnce(
        () =>
          new Promise<SessionUser>((resolve) => {
            releaseStaleMe = () => resolve(USER)
          }),
      )
    vi.spyOn(api, 'updateLockTimer').mockImplementation(
      () =>
        new Promise<SessionUser>((resolve) => {
          releasePatch = resolve
        }),
    )
    const user = userEvent.setup()
    const client = renderMenu()
    await openMenu(user)
    expect(screen.getByRole('status')).toHaveTextContent('30 min')

    const staleRefetch = client.refetchQueries({ queryKey: AUTH_KEY })
    await waitFor(() => expect(api.authMe).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Shorter lock timer' }))

    expect(screen.getByRole('status')).toHaveTextContent('15 min')
    await act(async () => {
      releaseStaleMe()
      await staleRefetch
    })
    expect(screen.getByRole('status')).toHaveTextContent('15 min')
    await act(async () => {
      releasePatch({ ...USER, idle_lock_seconds: 900 })
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Shorter lock timer' })).toBeEnabled(),
    )
    expect(api.updateLockTimer).toHaveBeenCalledWith(900)
  })

  it('restores the stored timer and reports a failed save', async () => {
    vi.spyOn(api, 'updateLockTimer').mockRejectedValue(
      new ApiError(404, 'HTTP_404', 'Not Found'),
    )
    const user = userEvent.setup()
    renderMenu()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Shorter lock timer' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('30 min'))
    expect(toast.error).toHaveBeenCalledWith(
      'Could not save the screen lock timer. Try again.',
    )
  })

  it('reports a failed save in Arabic', async () => {
    await i18n.changeLanguage('ar')
    vi.spyOn(api, 'updateLockTimer').mockRejectedValue(
      new ApiError(404, 'HTTP_404', 'Not Found'),
    )
    const user = userEvent.setup()
    renderMenu()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'تقليل مدة القفل' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('30 د'))
    expect(toast.error).toHaveBeenCalledWith(
      'لم يتم حفظ مؤقت قفل الشاشة. حاول مرة أخرى.',
    )
  })

  it('does not restore a signed-out user when a pending save fails', async () => {
    let rejectPatch: (reason: ApiError) => void = () => {
      throw new Error('lock timer request did not start')
    }
    vi.spyOn(api, 'updateLockTimer').mockImplementation(
      () =>
        new Promise<SessionUser>((_resolve, reject) => {
          rejectPatch = reject
        }),
    )
    const user = userEvent.setup()
    const client = renderMenu()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Shorter lock timer' }))
    expect(screen.getByRole('status')).toHaveTextContent('15 min')
    act(() => client.setQueryData(AUTH_KEY, null))
    await act(async () => {
      rejectPatch(new ApiError(401, 'HTTP_401', 'Signed out'))
    })

    await waitFor(() => expect(client.getQueryData(AUTH_KEY)).toBeNull())
    expect(toast.error).toHaveBeenCalledWith(
      'Could not save the screen lock timer. Try again.',
    )
  })
})
