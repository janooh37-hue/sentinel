import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type WorkforceSnapshot } from '@/lib/api'
import i18n from '@/lib/i18n'
import { loadLockWeather } from '@/lib/lockWeather'
import type * as LockWeatherModule from '@/lib/lockWeather'

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
    shift_code: 'morning',
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
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('الصباحية')
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('الظهيرة')
    })
  })

  it('shows translated shift names for the current and next shift', async () => {
    renderOverlay()

    await waitFor(() => {
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('Morning')
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('Noon')
      expect(document.querySelector('.lock-shifts')).not.toHaveTextContent('First Company')
      expect(document.querySelector('.lock-shifts')).not.toHaveTextContent('Second Company')
    })
  })

  it('falls back to crew names when no shift code exists', async () => {
    vi.spyOn(api, 'getWorkforceSnapshot').mockResolvedValue({
      ...SNAPSHOT,
      current_shift: { ...SNAPSHOT.current_shift, shift_code: null },
      next_shift: { ...SNAPSHOT.next_shift, shift_code: null },
      self: { ...SNAPSHOT.self, shift_code: null },
    })
    renderOverlay()

    await waitFor(() => {
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('First Company')
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('Second Company')
    })
  })

  it('falls back to Arabic crew names when no shift code exists', async () => {
    await i18n.changeLanguage('ar')
    vi.spyOn(api, 'getWorkforceSnapshot').mockResolvedValue({
      ...SNAPSHOT,
      current_shift: { ...SNAPSHOT.current_shift, shift_code: null },
      next_shift: { ...SNAPSHOT.next_shift, shift_code: null },
      self: { ...SNAPSHOT.self, shift_code: null },
    })
    renderOverlay()

    await waitFor(() => {
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('السرية الأولى')
      expect(document.querySelector('.lock-shifts')).toHaveTextContent('السرية الثانية')
    })
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
