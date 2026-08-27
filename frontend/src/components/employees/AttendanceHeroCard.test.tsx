/**
 * AttendanceHeroCard — the live signal in the Employees hero.
 *
 * Behaviours pinned here:
 *   1. It renders seen / late / absent / unpaired from the day payload.
 *   2. It lists the two worst rows, ordered absent → unpaired → late.
 *   3A clean day renders the clean state and no count badge.
 *   4. Without the capabilities it renders nothing AND never issues the request,
 *      which is the whole point of gating: /workforce/attendance/day would 403.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { hasCapability, listAttendanceDay } = vi.hoisted(() => ({
  hasCapability: vi.fn<(cap: string) => boolean>(),
  listAttendanceDay: vi.fn(),
}))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set<string>(), isLoading: false, has: hasCapability }),
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, listAttendanceDay } }
})

import { AttendanceHeroCard } from './AttendanceHeroCard'

const START = '2026-08-19T01:00:00'
const END = '2026-08-19T09:00:00'
// Judged by the policy the server publishes on every row: thirty minutes of
// grace, an absence boundary at twice that, and a pairing verdict due when the
// case's match window closes.
const DUE = '2026-08-19T11:00:00'
const ABSENCE_DUE = '2026-08-19T02:00:00'

function row(overrides: Record<string, unknown> = {}) {
  return {
    employee_id: 'G-9001',
    name_en: 'Ahmed Ali',
    name_ar: null,
    department: 'الأمن',
    duty_unit: 'السرية الثانية',
    duty_post: 'البوابة الرئيسية',
    crew_code: 'crew_2',
    shift_code: 'morning',
    presence_state: 'completed',
    reason_code: null,
    scheduled_start_at: START,
    scheduled_end_at: END,
    first_punch_at: '2026-08-19T00:52:00',
    last_punch_at: '2026-08-19T09:06:00',
    punch_count: 2,
    late_minutes: 0,
    grace_minutes: 30,
    absence_due_at: ABSENCE_DUE,
    judgment_due_at: DUE,
    on_leave: false,
    ...overrides,
  }
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AttendanceHeroCard onOpen={() => {}} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-19T12:00:00Z'))
  vi.clearAllMocks()
  hasCapability.mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AttendanceHeroCard', () => {
  it('shows the day counts and the two worst rows worst-first', async () => {
    listAttendanceDay.mockResolvedValue({
      items: [
        row(),
        row({ employee_id: 'G-9002', name_en: 'Late Person', late_minutes: 62 }),
        // Evaluator-ruled absence has zero punches and presence_state absent; completed with zero punches is a human correction.
        row({
          employee_id: 'G-9003',
          name_en: 'Absent Person',
          presence_state: 'absent',
          punch_count: 0,
          first_punch_at: null,
          last_punch_at: null,
        }),
        row({ employee_id: 'G-9004', name_en: 'Single Person', punch_count: 1, last_punch_at: null }),
      ],
      next_cursor: null,
    })

    renderCard()

    await waitFor(() => expect(screen.getByTestId('attendance-hero-count')).toHaveTextContent('3'))
    // seen = 3 of 4 (one never punched), late = 1, absent = 1, unpaired = 1.
    // i18n resolves real copy in this suite, so assert on stable test ids.
    expect(screen.getByTestId('attendance-hero-seen')).toHaveTextContent('3')
    expect(screen.getByTestId('attendance-hero-late')).toHaveTextContent('1')
    expect(screen.getByTestId('attendance-hero-absent')).toHaveTextContent('1')
    expect(screen.getByTestId('attendance-hero-unpaired')).toHaveTextContent('1')

    const names = screen.getAllByText(/Person|Ahmed/).map((n) => n.textContent)
    expect(names.slice(0, 2)).toEqual(['Absent Person', 'Single Person'])
  })

  it('renders the clean state with no badge when nothing needs a decision', async () => {
    listAttendanceDay.mockResolvedValue({ items: [row(), row({ employee_id: 'G-9002' })], next_cursor: null })

    renderCard()

    await waitFor(() => expect(screen.getByTestId('attendance-hero-clean')).toBeInTheDocument())
    expect(screen.queryByTestId('attendance-hero-count')).not.toBeInTheDocument()
  })

  it('never claims a clean day while the punches are still loading', async () => {
    // A card that prints "everyone has been seen" from an empty pre-payload
    // state is indistinguishable from a verified all-clear, so the pending
    // state must be visibly different and must not print confident zeros.
    // `Promise.withResolvers` is the house style, but this project pins
    // `lib: ES2023` (tsconfig.app.json), which predates it — hence the executor.
    let release: (page: { items: unknown[]; next_cursor: null }) => void = () => {}
    listAttendanceDay.mockReturnValue(
      new Promise<{ items: unknown[]; next_cursor: null }>((resolve) => {
        release = resolve
      }),
    )

    renderCard()

    expect(await screen.findByTestId('attendance-hero-pending')).toBeInTheDocument()
    expect(screen.queryByTestId('attendance-hero-clean')).not.toBeInTheDocument()
    expect(screen.getByTestId('attendance-hero-seen')).toHaveTextContent('—')

    release({ items: [], next_cursor: null })

    await waitFor(() => expect(screen.getByTestId('attendance-hero-clean')).toBeInTheDocument())
    expect(screen.queryByTestId('attendance-hero-pending')).not.toBeInTheDocument()
    expect(screen.getByTestId('attendance-hero-seen')).toHaveTextContent('0')
  })

  it('renders nothing and never fetches without both capabilities', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'workforce.attendance.review')

    renderCard()

    expect(screen.queryByTestId('attendance-hero-card')).not.toBeInTheDocument()
    await waitFor(() => expect(listAttendanceDay).not.toHaveBeenCalled())
  })
})
