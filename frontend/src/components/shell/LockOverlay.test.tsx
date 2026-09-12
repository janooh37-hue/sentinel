import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type WorkforceSnapshot } from '@/lib/api'
import i18n from '@/lib/i18n'
import { loadLockWeather } from '@/lib/lockWeather'
import type * as LockWeatherModule from '@/lib/lockWeather'
import {
  DialogContent,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

import { LockOverlay } from './LockOverlay'

let mockUser: Record<string, unknown> = {}
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))
vi.mock('@/lib/useIdentity', () => ({
  useIdentity: () => ({
    identity: {
      linked: true,
      name_en: 'Abdulla Aldhaheri',
      name_ar: 'عبدالله الظاهري',
      photo_url: null,
    },
  }),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (capability: string) => capability.startsWith('workforce.') }),
}))
vi.mock('@/lib/lockWeather', async (importOriginal) => {
  const actual = await importOriginal<typeof LockWeatherModule>()
  return { ...actual, loadLockWeather: vi.fn() }
})

const SNAPSHOT = {
  as_of: '2026-08-28T10:00:00Z',
  operational_date: '2026-08-28',
  timezone: 'Asia/Dubai',
  sync_health: null,
  evaluation_health: { pending_count: 0, error_count: 0 },
  readiness: null,
  current_shift: {
    starts_at: '2026-08-28T06:00:00Z',
    ends_at: '2026-08-28T14:00:00Z',
    crews: [{ code: 'crew_1', name_en: 'First Company', name_ar: 'السرية الأولى' }],
    scheduled: 8,
    excused: 0,
    evaluated_count: 8,
    pending_or_error_excluded_count: 0,
    working: 8,
  },
  next_shift: {
    starts_at: '2026-08-28T14:00:00Z',
    ends_at: '2026-08-28T22:00:00Z',
    shift_code: 'noon',
    crews: [{ code: 'crew_2', name_en: 'Second Company', name_ar: 'السرية الثانية' }],
    scheduled: 5,
  },
  leave_today: { annual: 0, sick: 0, national_service: 0, other: 0 },
  mapping_completeness: {},
  schedule_completeness: {},
  self: {
    employee_id: 'G100',
    shift_code: 'morning',
    presence_state: 'on_duty',
    scheduled_start_at: '2026-08-28T06:00:00Z',
    scheduled_end_at: '2026-08-28T14:00:00Z',
  },
  aggregate: null,
} as WorkforceSnapshot

function renderOverlay(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const onUnlocked = vi.fn()
  const onSignOut = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <LockOverlay onUnlocked={onUnlocked} onSignOut={onSignOut} />
    </QueryClientProvider>,
  )
  return { client, onUnlocked, onSignOut }
}

function NestedModalScenario({
  locked,
  onUnlocked,
  onBackgroundAction,
}: {
  locked: boolean
  onUnlocked: () => void
  onBackgroundAction: () => void
}): React.JSX.Element {
  const [confirmationOpen, setConfirmationOpen] = useState(true)

  return (
    <>
      <DialogRoot open>
        <DialogContent hideClose aria-describedby={undefined}>
          <DialogTitle>Word handoff</DialogTitle>
          <button type="button" onClick={onBackgroundAction}>
            Finish hidden handoff
          </button>
        </DialogContent>
      </DialogRoot>
      <ConfirmDialog
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        title="Discard Word draft"
        description="Keep this confirmation open."
        onConfirm={onBackgroundAction}
      />
      {locked && <LockOverlay onUnlocked={onUnlocked} onSignOut={vi.fn()} />}
    </>
  )
}

function PageLockScenario({
  locked,
  showTarget = true,
  onUnlocked,
}: {
  locked: boolean
  showTarget?: boolean
  onUnlocked: () => void
}): React.JSX.Element {
  return (
    <>
      <main id="main-content" tabIndex={-1}>
        {showTarget && <button type="button">Return target</button>}
      </main>
      {locked && <LockOverlay onUnlocked={onUnlocked} onSignOut={vi.fn()} />}
    </>
  )
}

describe('LockOverlay', () => {
  beforeEach(async () => {
    mockUser = { email: 'abdulla@example.test', idle_lock_seconds: 30, lock_layout: 'band' }
    await i18n.changeLanguage('en')
    vi.spyOn(api, 'getWorkforceSnapshot').mockResolvedValue(SNAPSHOT)
    vi.spyOn(api, 'getMyDocumentActivity').mockResolvedValue({
      documents_today: 6,
      documents_week: 14,
    })
    vi.spyOn(api, 'verifyAuthPassword').mockResolvedValue(undefined)
    vi.mocked(loadLockWeather).mockResolvedValue({
      location: 'Al Wathba',
      temperatureC: 41,
      highC: 43,
      lowC: 31,
      humidity: 42,
      weatherCode: 0,
      isDay: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    // Window.visualViewport is typed as non-optional (VisualViewport | null), so
    // `delete` needs an untyped view; we only ever add it via defineProperty below.
    const globalWindow = window as unknown as Record<string, unknown>
    delete globalWindow.visualViewport
  })

  it('applies the account lock layout and shows no switcher', () => {
    mockUser.lock_layout = 'console'
    renderOverlay()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-layout', 'console')
    expect(screen.queryByRole('group', { name: 'Lock screen layout' })).not.toBeInTheDocument()
  })

  it('renders the console digest as a strip below the unlock form, and inline for band', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['books', 'awaiting'], [{ id: 1 }, { id: 2 }, { id: 3 }])
    client.setQueryData(['ledger', 'unread-recent'], { items: [], total_unread: 2 })
    client.setQueryData(['expiry', 'summary'], { expired: 0, critical: 1, urgent: 1 })

    mockUser.lock_layout = 'console'
    renderOverlay(client)
    await waitFor(() => {
      expect(document.querySelector('.lock-digest-strip .lock-digest-item')).toBeInTheDocument()
    })
    cleanup()

    mockUser.lock_layout = 'band'
    renderOverlay(client)
    await waitFor(() => {
      expect(document.querySelector('.lock-digest-item')).toBeInTheDocument()
    })
    expect(document.querySelector('.lock-digest-strip')).not.toBeInTheDocument()
  })

  it('raises the mobile unlock sheet above the on-screen keyboard', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        height: window.innerHeight - 300,
        offsetTop: 0,
      }),
    })

    renderOverlay()

    const dialog = screen.getByRole('dialog')
    expect(dialog.style.getPropertyValue('--lock-kb-inset')).toBe('300px')
  })

  it('shows only privacy-safe cached digest counts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['books', 'awaiting'], [{ id: 1 }, { id: 2 }, { id: 3 }])
    client.setQueryData(['ledger', 'unread-recent'], {
      items: [{ id: 7, subject: 'Sensitive subject', counterparty: 'Private sender' }],
      total_unread: 2,
    })
    client.setQueryData(['expiry', 'summary'], { expired: 0, critical: 1, urgent: 1 })

    renderOverlay(client)

    expect(await screen.findAllByText('3')).not.toHaveLength(0)
    expect(screen.getAllByText('2')).not.toHaveLength(0)
    expect(screen.getAllByText('1')).not.toHaveLength(0)
    expect(screen.queryByText('Sensitive subject')).not.toBeInTheDocument()
    expect(screen.queryByText('Private sender')).not.toBeInTheDocument()
  })

  it('shows the signed-in users configured inactivity duration', () => {
    renderOverlay()

    expect(
      screen.getByText('Locked automatically after 30 seconds of inactivity'),
    ).toBeInTheDocument()
  })

  it('keeps shift time ranges chronological inside Arabic RTL', async () => {
    await i18n.changeLanguage('ar')
    renderOverlay()

    await waitFor(() => {
      expect(document.querySelector('.lock-shifts small bdi')).toHaveAttribute('dir', 'ltr')
      expect(document.querySelector('.lock-shifts .lock-eyebrow')).toHaveTextContent(
        'على رأس العمل الآن',
      )
      expect(document.querySelector('.lock-submit')).toHaveTextContent('←')
      expect(document.querySelector('.lock-cheer')).toHaveTextContent(
        '6 مستندات منجزة اليوم — يوم منتج.',
      )
      const arabicTemperature = new Intl.NumberFormat('ar-AE', {
        maximumFractionDigits: 0,
      }).format(41)
      expect(document.querySelector('.lock-weather-main strong')).toHaveTextContent(
        `${arabicTemperature}°`,
      )
      expect(document.querySelectorAll('.lock-weather bdi[dir="ltr"]')).toHaveLength(4)
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('السرية الأولى')
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('السرية الثانية')
      expect(document.querySelector('.lock-shifts')).not.toHaveTextContent('الصباحية')
      expect(document.querySelector('.lock-shifts')).not.toHaveTextContent('الظهيرة')
    })
  })

  it('shows workforce crew names instead of time-of-day shift names', async () => {
    renderOverlay()

    await waitFor(() => {
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('First Company')
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('Second Company')
      expect(document.querySelector('.lock-shifts')).not.toHaveTextContent('Morning')
      expect(document.querySelector('.lock-shifts')).not.toHaveTextContent('Noon')
    })
  })


  it('falls back to the translated shift name when no crew is on duty', async () => {
    vi.spyOn(api, 'getWorkforceSnapshot').mockResolvedValue({
      ...SNAPSHOT,
      current_shift: { ...SNAPSHOT.current_shift, crews: [] },
      next_shift: { ...SNAPSHOT.next_shift, crews: [] },
    })
    renderOverlay()

    await waitFor(() => {
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('Morning')
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('Noon')
      expect(document.querySelector('.lock-shifts')).not.toHaveTextContent('First Company')
      expect(document.querySelector('.lock-shifts')).not.toHaveTextContent('noon')
    })
  })

  it('falls back to the translated Arabic shift name when no crew is on duty', async () => {
    await i18n.changeLanguage('ar')
    vi.spyOn(api, 'getWorkforceSnapshot').mockResolvedValue({
      ...SNAPSHOT,
      current_shift: { ...SNAPSHOT.current_shift, crews: [] },
      next_shift: { ...SNAPSHOT.next_shift, crews: [] },
    })
    renderOverlay()

    await waitFor(() => {
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('الصباحية')
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('الظهيرة')
      expect(document.querySelector('.lock-shifts')).not.toHaveTextContent('السرية الأولى')
    })
  })

  it('owns focus above nested Radix dialogs and preserves them through Escape and unlock', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const backgroundAction = vi.fn()
    const onUnlocked = vi.fn()
    const view = render(
      <QueryClientProvider client={client}>
        <NestedModalScenario
          locked={false}
          onUnlocked={onUnlocked}
          onBackgroundAction={backgroundAction}
        />
      </QueryClientProvider>,
    )

    // getByRole is deliberately avoided here: this scenario mirrors
    // WordHandoffDialog's real pre-existing shape (its ConfirmDialog is a
    // sibling Radix Root, not nested), so both top-level modals mutually
    // mark each other aria-hidden via Radix's shared hideOthers bookkeeping
    // (a pre-existing, unrelated quirk) — the button stays genuinely
    // focus-reachable, so a text lookup (unaffected by aria-hidden) is the
    // correct way to grab the real DOM node.
    const cancel = await screen.findByText('Cancel')
    cancel.focus()
    expect(cancel).toHaveFocus()

    view.rerender(
      <QueryClientProvider client={client}>
        <NestedModalScenario
          locked
          onUnlocked={onUnlocked}
          onBackgroundAction={backgroundAction}
        />
      </QueryClientProvider>,
    )
    const password = await screen.findByLabelText('Password')
    await waitFor(() => expect(password).toHaveFocus())

    await user.keyboard('{Escape}')
    expect(screen.getByText('Discard Word draft')).toBeInTheDocument()
    expect(screen.getByText('Word handoff')).toBeInTheDocument()
    expect(backgroundAction).not.toHaveBeenCalled()

    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByText('Discard Word draft')).toBeInTheDocument()

    await user.type(password, 'Secret123!')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce())
    view.rerender(
      <QueryClientProvider client={client}>
        <NestedModalScenario
          locked={false}
          onUnlocked={onUnlocked}
          onBackgroundAction={backgroundAction}
        />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(cancel).toHaveFocus())
    expect(screen.getByText('Discard Word draft')).toBeInTheDocument()
    expect(backgroundAction).not.toHaveBeenCalled()
  })

  it('contains keyboard traversal and app shortcuts without blocking ordinary input', async () => {
    const user = userEvent.setup()
    const shortcutListener = vi.fn()
    window.addEventListener('keydown', shortcutListener)

    try {
      renderOverlay()
      const password = await screen.findByLabelText('Password')
      await waitFor(() => expect(password).toHaveFocus())
      expect(fireEvent.keyDown(password, { key: 'a' })).toBe(true)
      fireEvent.keyDown(password, { key: 'k', ctrlKey: true })
      fireEvent.keyDown(password, { key: '/', ctrlKey: true })

      const visibility = screen.getByRole('button', { name: 'Show password' })
      visibility.focus()
      fireEvent.keyDown(visibility, { key: 'n', ctrlKey: true })
      expect(shortcutListener).not.toHaveBeenCalled()

      await user.type(password, 'Secret123!')
      const signOut = screen.getByRole('button', { name: 'Not you? Sign out' })
      signOut.focus()
      await user.tab()
      expect(password).toHaveFocus()
      await user.tab({ shift: true })
      expect(signOut).toHaveFocus()
    } finally {
      window.removeEventListener('keydown', shortcutListener)
    }
  })

  it('keeps verification errors editable and retries through the same lock', async () => {
    const user = userEvent.setup()
    vi.mocked(api.verifyAuthPassword)
      .mockRejectedValueOnce(new ApiError(401, 'invalid_password', 'Incorrect password'))
      .mockRejectedValueOnce(new TypeError('Connection lost'))
      .mockResolvedValueOnce(undefined)
    const { onUnlocked } = renderOverlay()
    const password = await screen.findByLabelText('Password')

    await user.type(password, 'wrong')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password')
    expect(password).toBeEnabled()
    expect(password).toHaveValue('wrong')
    expect(onUnlocked).not.toHaveBeenCalled()

    await user.clear(password)
    await user.type(password, 'retry')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('TypeError: Connection lost')
    expect(password).toBeEnabled()
    expect(onUnlocked).not.toHaveBeenCalled()

    await user.clear(password)
    await user.type(password, 'Secret123!')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce())
    expect(api.verifyAuthPassword).toHaveBeenNthCalledWith(1, 'wrong')
    expect(api.verifyAuthPassword).toHaveBeenNthCalledWith(2, 'retry')
    expect(api.verifyAuthPassword).toHaveBeenNthCalledWith(3, 'Secret123!')
  })

  it('allows only one password verification while a submission is pending', async () => {
    const user = userEvent.setup()
    let resolveVerification!: () => void
    vi.mocked(api.verifyAuthPassword).mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveVerification = resolve
      }),
    )
    const { onUnlocked } = renderOverlay()
    const password = await screen.findByLabelText('Password')
    const form = password.closest('form')

    await user.type(password, 'Secret123!')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(form).not.toBeNull()
    fireEvent.submit(form!)
    fireEvent.submit(form!)
    expect(api.verifyAuthPassword).toHaveBeenCalledOnce()

    resolveVerification()
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce())
  })

  it('restores page focus across repeated successful lock cycles', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onUnlocked = vi.fn()
    const view = render(
      <QueryClientProvider client={client}>
        <PageLockScenario locked={false} onUnlocked={onUnlocked} />
      </QueryClientProvider>,
    )
    const target = screen.getByRole('button', { name: 'Return target' })

    for (const [index, attempt] of ['FirstSecret!', 'SecondSecret!'].entries()) {
      target.focus()
      view.rerender(
        <QueryClientProvider client={client}>
          <PageLockScenario locked onUnlocked={onUnlocked} />
        </QueryClientProvider>,
      )
      const password = await screen.findByLabelText('Password')
      await waitFor(() => expect(password).toHaveFocus())
      await user.type(password, attempt)
      await user.click(screen.getByRole('button', { name: 'Unlock' }))
      await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(index + 1))
      view.rerender(
        <QueryClientProvider client={client}>
          <PageLockScenario locked={false} onUnlocked={onUnlocked} />
        </QueryClientProvider>,
      )
      await waitFor(() => expect(target).toHaveFocus())
    }

    expect(api.verifyAuthPassword).toHaveBeenCalledTimes(2)
  })

  it('falls back to main content when the pre-lock focus target no longer exists', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onUnlocked = vi.fn()
    const view = render(
      <QueryClientProvider client={client}>
        <PageLockScenario locked={false} onUnlocked={onUnlocked} />
      </QueryClientProvider>,
    )
    const target = screen.getByRole('button', { name: 'Return target' })
    target.focus()

    view.rerender(
      <QueryClientProvider client={client}>
        <PageLockScenario locked onUnlocked={onUnlocked} />
      </QueryClientProvider>,
    )
    const password = await screen.findByLabelText('Password')
    await waitFor(() => expect(password).toHaveFocus())
    view.rerender(
      <QueryClientProvider client={client}>
        <PageLockScenario locked showTarget={false} onUnlocked={onUnlocked} />
      </QueryClientProvider>,
    )
    await user.type(password, 'Secret123!')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce())
    view.rerender(
      <QueryClientProvider client={client}>
        <PageLockScenario
          locked={false}
          showTarget={false}
          onUnlocked={onUnlocked}
        />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
  })

  it('uses the existing password verification flow and can sign out', async () => {
    const user = userEvent.setup()
    const { onUnlocked, onSignOut } = renderOverlay()

    await user.type(screen.getByLabelText('Password'), 'Secret123!')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(api.verifyAuthPassword).toHaveBeenCalledWith('Secret123!'))
    expect(onUnlocked).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Not you? Sign out' }))
    expect(onSignOut).toHaveBeenCalledOnce()
  })
})
