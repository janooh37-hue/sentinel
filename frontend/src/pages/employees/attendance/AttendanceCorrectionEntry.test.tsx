/**
 * The shared attendance chrome: the status legend, and the correction entry
 * point that must not exist for a user who cannot correct.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { hasCapability, quickCorrection } = vi.hoisted(() => ({
  hasCapability: vi.fn(),
  quickCorrection: vi.fn(),
}))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set<string>(), isLoading: false, has: hasCapability }),
}))

// The overlay itself is tested on its own; here only who may open it matters.
vi.mock('./QuickCorrection', () => ({
  QuickCorrection: (props: { target: { caseId: number } | null }) => {
    quickCorrection(props.target)
    return props.target ? <div role="dialog">quick correction {props.target.caseId}</div> : null
  },
}))

import { AttendanceCorrectionProvider, CorrectAttendanceButton } from './AttendanceCorrectionEntry'
import { AttendanceLegend } from './AttendanceLegend'

const TARGET = {
  caseId: 42,
  employeeId: 'G-9001',
  employeeName: 'Ahmed Ali',
  operationalDate: '2026-08-19',
  shiftCode: 'morning',
}

function renderEntry(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AttendanceCorrectionProvider>
        <CorrectAttendanceButton target={TARGET} />
      </AttendanceCorrectionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  hasCapability.mockReset()
  quickCorrection.mockReset()
  await i18n.changeLanguage('en')
})

describe('CorrectAttendanceButton', () => {
  it('renders nothing without workforce.attendance.correct', () => {
    hasCapability.mockImplementation((cap: string) => cap !== 'workforce.attendance.correct')
    renderEntry()
    expect(screen.queryByTestId('attendance-correct-trigger')).toBeNull()
    expect(quickCorrection).not.toHaveBeenCalled()
  })

  it('opens Quick correction for that person-day with the capability', async () => {
    hasCapability.mockReturnValue(true)
    renderEntry()
    await userEvent.click(screen.getByRole('button', { name: /Correct attendance: Ahmed Ali, 2026-08-19/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('quick correction 42')
  })
})

describe('AttendanceLegend', () => {
  it('names every verdict once, National Service and leave included', () => {
    render(<AttendanceLegend />)
    const legend = screen.getByTestId('attendance-legend')
    for (const label of ['On site', 'Left', 'Inside grace', 'Late past grace', 'Single punch', 'Absent', 'Not due yet', 'On leave', 'National Service']) {
      expect(legend).toHaveTextContent(label)
    }
    expect(legend.querySelector('[data-state="national_service"]')).not.toBeNull()
    expect(legend.querySelector('[data-on-site="true"]')).not.toBeNull()
    // Rest days only exist on the month calendar.
    expect(legend.querySelector('[data-state="off"]')).toBeNull()
  })

  it('adds the rest-day dash for the month calendar', () => {
    render(<AttendanceLegend showOff />)
    expect(screen.getByTestId('attendance-legend').querySelector('[data-state="off"]')).not.toBeNull()
  })
})
