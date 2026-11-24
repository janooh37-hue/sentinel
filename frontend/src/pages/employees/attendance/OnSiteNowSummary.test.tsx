import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'

import { ON_SITE_BUCKETS, type AttendanceRow, type OnSiteBucket } from './attendanceModel'
import { AttentionQueue } from './AttentionQueue'
import { OnSiteNowSummary } from './OnSiteNowSummary'

const now = new Date('2026-11-18T07:40:00Z')

function row(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    corrected: false,
    employee_id: 'G-1', name_en: 'Ahmed', name_ar: null,
    department: 'Security', duty_unit: 'A', duty_post: 'Gate', crew_code: 'A',
    shift_code: 'morning', presence_state: 'on_duty', reason_code: null,
    scheduled_start_at: '2026-11-18T03:00:00Z', scheduled_end_at: '2026-11-18T11:00:00Z',
    absence_due_at: '2026-11-18T04:00:00Z', judgment_due_at: '2026-11-18T13:00:00Z',
    first_punch_at: '2026-11-18T02:55:00Z', last_punch_at: '2026-11-18T02:55:00Z',
    final_out_at: null, punch_count: 1, case_id: 1, late_minutes: 0, grace_minutes: 30,
    on_leave: false, leave_kind: null, leave_label: null,
    ...overrides,
  }
}

const missingPunches = { punch_count: 0, first_punch_at: null, last_punch_at: null, presence_state: 'scheduled' } satisfies Partial<AttendanceRow>
const absentRow = row({ employee_id: 'G-3', ...missingPunches, presence_state: 'absent' })
const awaitedRow = row({ employee_id: 'G-4', ...missingPunches, absence_due_at: '2026-11-18T10:00:00Z' })
const allBuckets = [
  row(),
  row({ shift_code: 'night' }),
  row({ employee_id: 'G-2', punch_count: 2, final_out_at: '2026-11-18T07:00:00Z' }),
  absentRow,
  awaitedRow,
  row({ employee_id: 'G-5', on_leave: true, leave_kind: 'annual', leave_label: 'Annual Leave' }),
  row({ employee_id: 'G-6', on_leave: true, leave_kind: 'national_service' }),
  row({ employee_id: 'G-7', ...missingPunches, scheduled_start_at: '2026-11-18T09:00:00Z', absence_due_at: '2026-11-18T10:00:00Z' }),
]
const props = {
  operationalDate: '2026-11-18',
  now,
  who: null,
  onWhoChange: vi.fn(),
  attentionCount: 28,
  attentionAnchorId: 'summary-decisions',
  attentionTargetId: 'attendance-queue',
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await act(async () => { await i18n.changeLanguage('en') })
})

function bucketKey(bucket: OnSiteBucket): HTMLElement {
  const group = screen.getByRole('group', { name: i18n.t('attendance.onSiteNow.who') })
  return within(group).getByRole('button', { name: new RegExp(i18n.t(`attendance.onSiteNow.${bucket}`)) })
}

describe('OnSiteNowSummary', () => {
  it('counts people once across shifts and separates buckets from the residual', () => {
    const { container } = render(<OnSiteNowSummary {...props} rows={allBuckets} />)
    const summary = screen.getByRole('region', { name: i18n.t('attendance.onSiteNow.title') })
    expect(summary).toHaveTextContent(i18n.t('attendance.onSiteNow.people', { count: 7 }).replace(/<[^>]+>/g, ''))
    const counts: Record<OnSiteBucket, number> = { onSite: 1, left: 1, notArrived: 2, leave: 1, nationalService: 1 }
    for (const bucket of ON_SITE_BUCKETS) {
      const count = counts[bucket]
      const key = bucketKey(bucket)
      expect(key.querySelector('bdi')).toHaveTextContent(new RegExp(`^${count}$`))
      expect(key.querySelector('bdi')).toHaveAttribute('dir', 'ltr')
    }
    const residual = screen.getByRole('button', { name: new RegExp(i18n.t('attendance.onSiteNow.residual')) })
    expect(residual.querySelector('bdi')).toHaveTextContent(/^1$/)
    expect(residual).toHaveAccessibleDescription(i18n.t('attendance.onSiteNow.residualHint'))
    expect(screen.getByText('11:40').closest('bdi')).toHaveAttribute('dir', 'ltr')
    expect(Array.from(container.querySelectorAll('[data-bucket]'), (segment) => segment.getAttribute('data-bucket')))
      .toEqual(['onSite', 'left', 'notArrived', 'leave', 'nationalService'])
  })

  it.each([
    { rows: [absentRow, awaitedRow], absent: true, awaited: true },
    { rows: [absentRow], absent: true, awaited: false },
    { rows: [awaitedRow], absent: false, awaited: true },
    { rows: [row()], absent: false, awaited: false },
  ])('shows only nonzero Not-arrived sub-counts ($absent / $awaited)', ({ rows, absent, awaited }) => {
    render(<OnSiteNowSummary {...props} rows={rows} />)
    const key = within(bucketKey('notArrived'))
    for (const [label, shown] of [['splitAbsent', absent], ['splitAwaited', awaited]] as const) {
      const part = key.queryByText(i18n.t(`attendance.onSiteNow.${label}`))
      if (shown) {
        expect(part?.querySelector('bdi')).toHaveTextContent(/^1$/)
      } else {
        expect(part).not.toBeInTheDocument()
      }
    }
  })

  it('omits the current-on-site bucket for a past day', () => {
    render(<OnSiteNowSummary {...props} operationalDate="2026-11-17" rows={[]} />)
    expect(screen.getByRole('region', { name: i18n.t('attendance.onSiteNow.daySummary') })).toBeInTheDocument()
    const group = screen.getByRole('group', { name: i18n.t('attendance.onSiteNow.who') })
    expect(within(group).getAllByRole('button')).toHaveLength(4)
    expect(within(group).queryByRole('button', { name: new RegExp(i18n.t('attendance.onSiteNow.onSite')) })).not.toBeInTheDocument()
  })

  it('toggles a tier-one selection and clears it on the second click without recounting', () => {
    const onWhoChange = vi.fn()
    const { rerender, container } = render(<OnSiteNowSummary {...props} rows={allBuckets} onWhoChange={onWhoChange} />)
    const key = bucketKey('notArrived')
    expect(key).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(key)
    expect(onWhoChange).toHaveBeenLastCalledWith('notArrived')

    rerender(<OnSiteNowSummary {...props} rows={allBuckets} who="notArrived" onWhoChange={onWhoChange} />)
    expect(key).toHaveAttribute('aria-pressed', 'true')
    expect(key.querySelector('bdi')).toHaveTextContent(/^2$/)
    for (const segment of container.querySelectorAll('[data-bucket]')) {
      expect(segment.classList.contains('opacity-[0.22]')).toBe(segment.getAttribute('data-bucket') !== 'notArrived')
    }
    fireEvent.click(key)
    expect(onWhoChange).toHaveBeenLastCalledWith(null)
    rerender(<OnSiteNowSummary {...props} rows={allBuckets} onWhoChange={onWhoChange} />)
    expect(key).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelector('.opacity-\\[0\\.22\\]')).not.toBeInTheDocument()
  })

  it('keeps unselected zero keys disabled and unselectable, with no zero bar segment', () => {
    const onWhoChange = vi.fn()
    const { container } = render(<OnSiteNowSummary {...props} rows={[row()]} onWhoChange={onWhoChange} />)
    const key = bucketKey('left')
    expect(key).toHaveAttribute('aria-disabled', 'true')
    expect(key).toHaveAttribute('tabindex', '-1')
    expect(key.querySelector('bdi')).toHaveTextContent(/^0$/)
    fireEvent.click(key)
    expect(onWhoChange).not.toHaveBeenCalled()
    expect(container.querySelector('[data-bucket="left"]')).not.toBeInTheDocument()
  })

  it('lets operators reach and clear Left after a scope change drops its count to zero', () => {
    const onWhoChange = vi.fn()
    const { rerender, container } = render(<OnSiteNowSummary {...props} rows={allBuckets} who="left" onWhoChange={onWhoChange} />)
    rerender(<OnSiteNowSummary {...props} rows={[row()]} who="left" onWhoChange={onWhoChange} />)

    const left = bucketKey('left')
    const leave = bucketKey('leave')
    expect(left.querySelector('bdi')).toHaveTextContent(/^0$/)
    expect(left).toHaveAttribute('aria-pressed', 'true')
    expect(left).not.toHaveAttribute('aria-disabled', 'true')
    expect(left).toHaveAttribute('tabindex', '0')
    expect(container.querySelector('[data-bucket="left"]')).not.toBeInTheDocument()

    expect(leave).toHaveAttribute('aria-disabled', 'true')
    expect(leave).toHaveAttribute('tabindex', '-1')
    fireEvent.click(leave)
    expect(onWhoChange).not.toHaveBeenCalled()

    const onSite = bucketKey('onSite')
    act(() => onSite.focus())
    fireEvent.keyDown(onSite, { key: 'ArrowDown' })
    expect(left).toHaveFocus()
    fireEvent.click(left)
    expect(onWhoChange).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('renders an empty scoped day honestly without any bar segments or enabled keys', () => {
    const { container } = render(<OnSiteNowSummary {...props} rows={[]} />)
    const group = screen.getByRole('group', { name: i18n.t('attendance.onSiteNow.who') })
    for (const key of within(group).getAllByRole('button')) {
      expect(key).toHaveAttribute('aria-disabled', 'true')
      expect(key).toHaveAttribute('tabindex', '-1')
      expect(key.querySelector('bdi')).toHaveTextContent(/^0$/)
    }
    expect(container.querySelector('[data-bucket]')).not.toBeInTheDocument()
  })

  it('roves among nonzero keys with arrows and Home/End without changing day or selection', () => {
    const onWhoChange = vi.fn()
    const daySwitch = vi.fn()
    render(
      <div onKeyDown={daySwitch}>
        <OnSiteNowSummary {...props} rows={[row(), allBuckets[5], allBuckets[6]]} onWhoChange={onWhoChange} />
      </div>,
    )
    const onSite = bucketKey('onSite')
    const leave = bucketKey('leave')
    const nationalService = bucketKey('nationalService')
    expect(onSite).toHaveAttribute('tabindex', '0')
    act(() => onSite.focus())
    fireEvent.keyDown(onSite, { key: 'ArrowRight' })
    expect(leave).toHaveFocus()
    expect(onSite).toHaveAttribute('tabindex', '-1')
    expect(leave).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(leave, { key: 'End' })
    expect(nationalService).toHaveFocus()
    fireEvent.keyDown(nationalService, { key: 'Home' })
    expect(onSite).toHaveFocus()
    fireEvent.keyDown(onSite, { key: 'ArrowLeft' })
    expect(nationalService).toHaveFocus()
    expect(daySwitch).not.toHaveBeenCalled()
    expect(onWhoChange).not.toHaveBeenCalled()
  })

  it('mirrors roving arrows in Arabic and isolates the payload time and counts', async () => {
    await i18n.changeLanguage('ar')
    render(<OnSiteNowSummary {...props} rows={allBuckets} />)
    const onSite = bucketKey('onSite')
    const left = bucketKey('left')
    act(() => onSite.focus())
    fireEvent.keyDown(onSite, { key: 'ArrowLeft' })
    expect(left).toHaveFocus()
    fireEvent.keyDown(left, { key: 'ArrowRight' })
    expect(onSite).toHaveFocus()
    expect(onSite.querySelector('bdi')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('11:40').closest('bdi')).toHaveAttribute('dir', 'ltr')
  })

  it.each([0, 28])('links the unfiltered decision count %i to a focusable queue', (attentionCount) => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    render(
      <>
        <OnSiteNowSummary {...props} rows={allBuckets} attentionCount={attentionCount} />
        <AttentionQueue id={props.attentionTargetId} labelledBy={props.attentionAnchorId} rows={[]} now={now} operationalDate={props.operationalDate} onOpenEmployee={vi.fn()} />
      </>,
    )
    const anchor = screen.getByRole('link')
    const queue = screen.getByTestId('attendance-attention-queue')
    expect(anchor).toHaveAttribute('id', props.attentionAnchorId)
    expect(anchor).toHaveAttribute('href', `#${props.attentionTargetId}`)
    expect(anchor).toHaveTextContent(i18n.t('attendance.attention.anchor', { count: attentionCount }).replace(/<[^>]+>/g, ''))
    expect(anchor.querySelector('bdi')).toHaveAttribute('dir', 'ltr')
    expect(anchor.classList.contains('text-accent')).toBe(attentionCount > 0)
    fireEvent.click(anchor)
    expect(queue).toHaveFocus()
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })
  })

  it('names the desktop queue from the summary anchor and switches to its own title when stacked', () => {
    let desktop = true
    let update: (() => void) | undefined
    const media: MediaQueryList = {
      get matches() { return desktop },
      media: '(min-width: 64rem)',
      onchange: null,
      addEventListener: vi.fn((...args: unknown[]) => {
        const listener = args[1]
        if (typeof listener === 'function') update = () => listener()
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }
    vi.spyOn(window, 'matchMedia').mockReturnValue(media)
    render(
      <>
        <OnSiteNowSummary {...props} rows={[]} />
        <AttentionQueue id={props.attentionTargetId} labelledBy={props.attentionAnchorId} rows={[]} now={now} operationalDate={props.operationalDate} onOpenEmployee={vi.fn()} />
      </>,
    )
    const queue = screen.getByTestId('attendance-attention-queue')
    expect(queue).toHaveAttribute('aria-labelledby', props.attentionAnchorId)
    desktop = false
    act(() => update?.())
    const title = within(queue).getByRole('heading', { name: i18n.t('attendance.attention.title') })
    expect(title.parentElement).toHaveClass('lg:hidden')
    expect(queue).toHaveAttribute('aria-labelledby', title.id)
    expect(queue).toHaveAccessibleName(i18n.t('attendance.attention.title'))
  })
})
