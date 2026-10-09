import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type BookFacetsResponse, type SessionUser } from '@/lib/api'
import { AuthProvider } from '@/lib/AuthProvider'
import { AUTH_KEY } from '@/lib/authContext'
import i18n from '@/lib/i18n'
import { KeyboardShortcutsProvider } from '@/lib/keyboardShortcuts'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'

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
    vi.spyOn(api, 'myCapabilities').mockResolvedValue([])
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

describe('AccountMenu My records', () => {
  function Probe(): React.JSX.Element {
    const loc = useLocation()
    return <output data-testid="loc">{loc.pathname + loc.search}</output>
  }
  function renderWithProbe(): void {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthProvider>
            <AccountMenu onLock={vi.fn()} />
            <Probe />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  beforeEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage('en')
    vi.spyOn(api, 'authMe').mockResolvedValue(USER)
    vi.spyOn(api, 'getEmailAccount').mockResolvedValue(null)
    vi.spyOn(api, 'myCapabilities').mockResolvedValue(['books.view'])
    vi.spyOn(api, 'getBookFacets').mockResolvedValue({
      total: 12,
      states: {},
      services: [],
    } as unknown as BookFacetsResponse)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the created-by-me count (shared facets query) and opens /books?mine=1', async () => {
    const user = userEvent.setup()
    renderWithProbe()
    await openMenu(user)
    const row = await screen.findByRole('button', { name: /My records/ })
    await waitFor(() => expect(row).toHaveTextContent('12'))
    expect(api.getBookFacets).toHaveBeenCalledWith({ created_by_me: true })
    await user.click(row)
    expect(screen.getByTestId('loc')).toHaveTextContent('/books?mine=1')
  })

  it('does not fetch the count while the menu is closed', async () => {
    renderWithProbe()
    await screen.findByRole('button', { name: USER.email })
    expect(api.getBookFacets).not.toHaveBeenCalled()
  })

  it('is absent without books.view', async () => {
    vi.spyOn(api, 'myCapabilities').mockResolvedValue([])
    const user = userEvent.setup()
    renderWithProbe()
    await openMenu(user)
    await waitFor(() => expect(api.myCapabilities).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /My records/ })).not.toBeInTheDocument()
  })

  it('is absent for inmate reporters even with books.view', async () => {
    vi.spyOn(api, 'authMe').mockResolvedValue({ ...USER, role: 'inmate_reporter' })
    const user = userEvent.setup()
    renderWithProbe()
    await openMenu(user)
    // Wait for the capabilities to RESOLVE (not merely be requested): while they
    // load `has()` is false, so the row is absent with or without the role gate.
    await waitFor(() => expect(api.myCapabilities).toHaveBeenCalled())
    await act(async () => {
      await vi.mocked(api.myCapabilities).mock.results[0]?.value
    })
    expect(screen.queryByRole('button', { name: /My records/ })).not.toBeInTheDocument()
    expect(api.getBookFacets).not.toHaveBeenCalled()
  })
})

describe('AccountMenu vs. the keyboard shortcuts layer', () => {
  const escape = vi.fn()
  const next = vi.fn()
  function PageActions(): null {
    useShortcutAction('escape', escape)
    useShortcutAction('recordNext', next)
    return null
  }

  beforeEach(async () => {
    localStorage.clear()
    escape.mockReset()
    next.mockReset()
    await i18n.changeLanguage('en')
    vi.spyOn(api, 'authMe').mockResolvedValue(USER)
    vi.spyOn(api, 'getEmailAccount').mockResolvedValue(null)
    vi.spyOn(api, 'myCapabilities').mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is an overlay: Esc only closes it and J does not step records', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuthProvider>
            <KeyboardShortcutsProvider>
              <PageActions />
              <AccountMenu onLock={vi.fn()} />
            </KeyboardShortcutsProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await openMenu(user)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('j')
    expect(next).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(escape).not.toHaveBeenCalled()

    // Closed again: the page's shortcuts resume.
    await user.keyboard('j')
    expect(next).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(escape).toHaveBeenCalledTimes(1)
  })
})
