import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type WorkforceSnapshot } from '@/lib/api'
import i18n from '@/lib/i18n'
import { loadLockWeather } from '@/lib/lockWeather'
import type * as LockWeatherModule from '@/lib/lockWeather'

import { LockOverlay } from './LockOverlay'

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { email: 'abdulla@example.test' } }),
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
    scheduled: 8,
    excused: 0,
    evaluated_count: 8,
    pending_or_error_excluded_count: 0,
    working: 8,
  },
  next_shift: {
    starts_at: '2026-08-28T14:00:00Z',
    ends_at: '2026-08-28T22:00:00Z',
    shift_code: 'evening',
    shift_name: 'Evening',
    crews: [],
    scheduled: 5,
  },
  leave_today: { annual: 0, sick: 0, national_service: 0, other: 0 },
  mapping_completeness: {},
  schedule_completeness: {},
  self: {
    employee_id: 'G100',
    shift_code: 'A',
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
    localStorage.clear()
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
  })

  it('switches among all three layouts and remembers the choice', async () => {
    const user = userEvent.setup()
    renderOverlay()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-layout', 'band')
    expect(screen.getByRole('group', { name: 'Lock screen layout' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Briefing console' }))

    expect(dialog).toHaveAttribute('data-layout', 'console')
    expect(localStorage.getItem('gssg.lockLayout')).toBe('console')
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

  it('shows shift identity with the next shift start time', async () => {
    renderOverlay()

    await waitFor(() => {
      expect(document.querySelector('.lock-shifts .lock-metric:first-child strong')).toHaveTextContent(
        'A',
      )
      expect(
        document.querySelector('.lock-shifts .lock-metric:first-child strong'),
      ).not.toHaveTextContent('06:00')
      expect(document.querySelector('.lock-shifts .lock-metric:nth-child(2) strong')).toHaveTextContent(
        'Evening',
      )
      expect(
        document.querySelector('.lock-shifts .lock-metric:first-child strong bdi'),
      ).toHaveTextContent('A')
      expect(
        document.querySelector('.lock-shifts .lock-metric:nth-child(2) strong bdi'),
      ).toHaveTextContent('Evening')
      expect(document.querySelector('.lock-shifts .lock-metric:nth-child(2) small')).toHaveTextContent(
        'Starts at 18:00',
      )
    })
  })

  it('shows todays completed documents with a milestone moment', async () => {
    renderOverlay()

    const cheer = await screen.findByText('6 documents completed today — a productive day.')
    expect(cheer).toHaveClass('lock-cheer--milestone')
  })

  it('falls back to the weekly document count without a milestone', async () => {
    vi.mocked(api.getMyDocumentActivity).mockResolvedValueOnce({
      documents_today: 0,
      documents_week: 14,
    })
    renderOverlay()

    const cheer = await screen.findByText('14 documents completed this week.')
    expect(cheer).not.toHaveClass('lock-cheer--milestone')
  })

  it('uses a time-of-day cheer when no document count is available', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-29T06:00:00+04:00'))
    vi.mocked(api.getMyDocumentActivity).mockResolvedValueOnce({
      documents_today: 0,
      documents_week: 0,
    })
    renderOverlay()

    expect(await screen.findByText('A fresh start to the morning.')).toBeInTheDocument()
  })

  it('shows the remaining time inside the current shift', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-28T12:30:00Z'))
    renderOverlay()

    expect(
      await screen.findByText('1h 30m left in your shift — strong finish.'),
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
