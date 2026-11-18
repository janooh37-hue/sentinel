import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type AttendancePunchLogItem } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import i18n from '@/lib/i18n'
import { siteToday } from '@/components/employees/useAttendanceAttention'
import { widgetRegistry } from '../widgetRegistry'
import { PunchLogWidget } from './PunchLogWidget'

const access = vi.hoisted(() => ({ caps: new Set<string>(), loading: false }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => access.caps.has(cap), isLoading: access.loading }),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return { ...actual, api: { ...actual.api, listAttendancePunches: vi.fn() } }
})

const CAPS = ['workforce.people.view', 'workforce.attendance.review']
function punch(overrides: Partial<AttendancePunchLogItem> = {}): AttendancePunchLogItem {
  return { punch_id: 1, occurred_at: '2026-11-18T03:00:00Z', employee_id: 'G-100', name_en: 'Ahmed Ali', name_ar: 'أحمد علي', duty_post: 'Main gate', device: 'Gate reader', direction: 'in', ...overrides }
}
function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter><PunchLogWidget tier="list" rows={4} /></MemoryRouter></I18nextProvider></QueryClientProvider>)
}

beforeEach(async () => {
  access.caps = new Set(CAPS)
  access.loading = false
  vi.mocked(api.listAttendancePunches).mockReset()
  await i18n.changeLanguage('en')
})

describe('Punch log availability', () => {
  it.each([{ caps: [], expected: false }, { caps: [CAPS[0]], expected: false }, { caps: [CAPS[1]], expected: false }, { caps: CAPS, expected: true }])('requires both roster capabilities: %j', ({ caps, expected }) => {
    expect(widgetRegistry.punch_log.available({ has: (cap) => caps.includes(cap) })).toBe(expected)
  })
  it('stays unavailable while capabilities load', () => {
    expect(widgetRegistry.punch_log.available({ has: () => true, capabilitiesLoading: true })).toBe(false)
  })
  it.each([{ caps: [], loading: false }, { caps: [CAPS[0]], loading: false }, { caps: [CAPS[1]], loading: false }, { caps: CAPS, loading: true }])('does not render or request punches with %j', (state) => {
    access.caps = new Set(state.caps)
    access.loading = state.loading
    renderWidget()
    expect(screen.queryByRole('region', { name: 'Punch log' })).not.toBeInTheDocument()
    expect(api.listAttendancePunches).not.toHaveBeenCalled()
  })
})

describe('PunchLogWidget', () => {
  it('shows individual punches newest first and never invents unknown directions', async () => {
    vi.mocked(api.listAttendancePunches).mockResolvedValue({ items: [
      punch(),
      punch({ punch_id: 2, occurred_at: '2026-11-18T10:00:00Z', direction: 'unknown', name_en: 'Hessa Ali' }),
      punch({ punch_id: 3, occurred_at: '2026-11-18T09:00:00Z', direction: 'out', name_en: 'Fatima Ali' }),
    ], next_cursor: null })
    renderWidget()
    const rows = within(await screen.findByRole('list', { name: 'Punch log' })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('Hessa Ali')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Punch')).toBeInTheDocument()
    expect(within(rows[0]).getByText('14:00')).toHaveAttribute('dir', 'ltr')
    expect(within(rows[1]).getByText('Out')).toBeInTheDocument()
    expect(within(rows[2]).getByText('In')).toBeInTheDocument()
    expect(within(rows[2]).getByText('G-100')).toHaveAttribute('dir', 'ltr')
    expect(within(rows[2]).getAllByText('Main gate', { exact: false }).length).toBeGreaterThan(0)
    expect(within(rows[2]).getAllByText('Gate reader', { exact: false }).length).toBeGreaterThan(0)
    expect(api.listAttendancePunches).toHaveBeenCalledWith({ operational_date: siteToday(), limit: 20 })
  })
  it('uses Arabic employee names and direction labels', async () => {
    await i18n.changeLanguage('ar')
    vi.mocked(api.listAttendancePunches).mockResolvedValue({ items: [punch({ direction: 'unknown' })], next_cursor: null })
    renderWidget()
    expect(await screen.findByText('أحمد علي')).toBeInTheDocument()
    expect(screen.getByText('بصمة')).toBeInTheDocument()
  })
  it('renders an empty day without fabricated punches', async () => {
    vi.mocked(api.listAttendancePunches).mockResolvedValue({ items: [], next_cursor: null })
    renderWidget()
    expect(await screen.findByText('No punches recorded today.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
  it('retries a failed request', async () => {
    vi.mocked(api.listAttendancePunches).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [punch()], next_cursor: null })
    renderWidget()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Ahmed Ali')).toBeInTheDocument()
    expect(api.listAttendancePunches).toHaveBeenCalledTimes(2)
  })
})
