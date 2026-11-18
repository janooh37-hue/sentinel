/**
 * The shared attendance chrome: the status legend, and the correction entry
 * point that must not exist for a user who cannot correct.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { createMemoryRouter, Link, Route, RouterProvider, Routes, useLocation } from 'react-router-dom'
import type * as ApiModule from '@/lib/api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { hasCapability, getAttendanceCase } = vi.hoisted(() => ({
  hasCapability: vi.fn(),
  getAttendanceCase: vi.fn(),
}))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set<string>(), isLoading: false, has: hasCapability }),
}))

vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof ApiModule>()
  return { ...real, api: { ...real.api, getAttendanceCase } }
})

import { AttendanceCorrectionProvider, CorrectAttendanceButton } from './AttendanceCorrectionEntry'
import { AttendanceLegend } from './AttendanceLegend'
import type { AttendanceCase } from '@/lib/api'

const TARGET = {
  caseId: 42,
  employeeId: 'G-9001',
  employeeName: 'Ahmed Ali',
  operationalDate: '2026-08-19',
  shiftCode: 'morning',
}

const SECOND_TARGET = { ...TARGET, caseId: 43, employeeId: 'G-9002', employeeName: 'Omar Hassan' }
const CASE: AttendanceCase = {
  id: 42,
  employee_id: TARGET.employeeId,
  name_en: TARGET.employeeName,
  operational_date: TARGET.operationalDate,
  scheduled_start_at: '2026-08-19T03:00:00Z',
  scheduled_end_at: '2026-08-19T11:00:00Z',
  shift_code_snapshot: 'morning',
  organization_snapshot_state: 'assigned',
  effective: { presence_state: 'on_duty', first_in_at: '2026-08-19T03:10:00Z' },
}

function RouteLocation(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="correction-route">{location.pathname}{location.search}</output>
}

function renderEntry(initialEntries = ['/employees/attendance']) {
  const router = createMemoryRouter([{
    path: '*',
    element: <>
      <header><Link to="/employees">Employee directory</Link></header>
      <RouteLocation />
      <Routes>
        <Route path="/employees/attendance" element={
          <AttendanceCorrectionProvider>
            <CorrectAttendanceButton target={TARGET} />
            <CorrectAttendanceButton target={SECOND_TARGET} />
          </AttendanceCorrectionProvider>
        } />
        <Route path="/employees" element={<div>Employee directory destination</div>} />
      </Routes>
    </>,
  }], { initialEntries })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  return { router }
}

beforeEach(async () => {
  hasCapability.mockReset()
  getAttendanceCase.mockReset().mockImplementation(async (caseId: number) => ({
    data: caseId === 42 ? CASE : { ...CASE, id: 43, employee_id: SECOND_TARGET.employeeId, name_en: SECOND_TARGET.employeeName },
    etag: `case-${caseId}`,
  }))
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CorrectAttendanceButton', () => {
  it('renders nothing without workforce.attendance.correct', () => {
    hasCapability.mockImplementation((cap: string) => cap !== 'workforce.attendance.correct')
    renderEntry()
    expect(screen.queryByTestId('attendance-correct-trigger')).toBeNull()
    expect(getAttendanceCase).not.toHaveBeenCalled()
  })

  it('opens Quick correction for that person-day with the capability', async () => {
    hasCapability.mockReturnValue(true)
    renderEntry()
    await userEvent.click(screen.getByRole('button', { name: /Correct attendance: Ahmed Ali, 2026-08-19/ }))
    expect(await screen.findByLabelText('In time (24h)')).toHaveValue('07:10')
    expect(screen.getByRole('dialog')).toHaveTextContent('Ahmed Ali')
    expect(getAttendanceCase).toHaveBeenCalledWith(42)
  })

  it.each(['desktop', 'mobile'] as const)('guards a dirty target switch on %s and preserves the draft until Discard', async (surface) => {
    if (surface === 'mobile') {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query === '(max-width: 640px)', media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => false,
      }))
    }
    hasCapability.mockReturnValue(true)
    const user = userEvent.setup()
    renderEntry()
    const firstTrigger = screen.getByRole('button', { name: /Correct attendance: Ahmed Ali/ })
    const secondTrigger = screen.getByRole('button', { name: /Correct attendance: Omar Hassan/ })
    await user.click(firstTrigger)
    await screen.findByLabelText('In time (24h)')
    await user.type(screen.getByLabelText('Reason details'), 'Keep Ahmed’s draft')
    const requestSecond = async (): Promise<void> => {
      // A modal sheet blocks pointer access to the background, but external
      // selections must still use the same guard as desktop trigger clicks.
      if (surface === 'mobile') fireEvent.click(secondTrigger)
      else await user.click(secondTrigger)
    }
    await requestSecond()
    const confirmation = await screen.findByRole('alertdialog')
    expect(getAttendanceCase).not.toHaveBeenCalledWith(43)
    await user.click(within(confirmation).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Ahmed Ali')
    expect(screen.getByLabelText('Reason details')).toHaveValue('Keep Ahmed’s draft')
    await requestSecond()
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Omar Hassan'))
    expect(screen.getByLabelText('Reason details')).toHaveValue('')
    expect(getAttendanceCase).toHaveBeenCalledWith(43)
    await user.click(screen.getByRole('button', { name: 'Close correction' }))
    await waitFor(() => expect(secondTrigger).toHaveFocus())
  })

  it('switches a clean panel immediately and treats its current target as a no-op', async () => {
    hasCapability.mockReturnValue(true)
    const user = userEvent.setup()
    renderEntry()
    const firstTrigger = screen.getByRole('button', { name: /Correct attendance: Ahmed Ali/ })
    await user.click(firstTrigger)
    await screen.findByLabelText('In time (24h)')
    await user.click(firstTrigger)
    expect(screen.getByRole('dialog')).toHaveTextContent('Ahmed Ali')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Correct attendance: Omar Hassan/ }))
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Omar Hassan'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('guards a top-navigation Link outside the provider until the dirty draft is discarded', async () => {
    hasCapability.mockReturnValue(true)
    const user = userEvent.setup()
    renderEntry()
    await user.click(screen.getByRole('button', { name: /Correct attendance: Ahmed Ali/ }))
    await screen.findByLabelText('In time (24h)')
    await user.type(screen.getByLabelText('Reason details'), 'Confirmed against gate register')
    const navigation = screen.getByRole('link', { name: 'Employee directory' })
    await user.click(navigation)
    const confirmation = await screen.findByRole('alertdialog')
    expect(screen.getByTestId('correction-route')).toHaveTextContent('/employees/attendance')
    expect(screen.queryByText('Employee directory destination')).not.toBeInTheDocument()
    await user.click(within(confirmation).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByTestId('correction-route')).toHaveTextContent('/employees/attendance')
    expect(screen.getByLabelText('Reason details')).toHaveValue('Confirmed against gate register')
    await user.click(navigation)
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    expect(await screen.findByText('Employee directory destination')).toBeInTheDocument()
    expect(screen.getByTestId('correction-route')).toHaveTextContent('/employees')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('guards history Back until Discard and keeps the route and draft when editing continues', async () => {
    hasCapability.mockReturnValue(true)
    const user = userEvent.setup()
    const { router } = renderEntry(['/employees', '/employees/attendance'])
    await user.click(screen.getByRole('button', { name: /Correct attendance: Ahmed Ali/ }))
    await screen.findByLabelText('In time (24h)')
    await user.type(screen.getByLabelText('Reason details'), 'Confirmed against gate register')
    await act(async () => { await router.navigate(-1) })
    const confirmation = await screen.findByRole('alertdialog')
    expect(screen.getByTestId('correction-route')).toHaveTextContent('/employees/attendance')
    await user.click(within(confirmation).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByTestId('correction-route')).toHaveTextContent('/employees/attendance')
    expect(screen.getByLabelText('Reason details')).toHaveValue('Confirmed against gate register')
    await act(async () => { await router.navigate(-1) })
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    expect(await screen.findByText('Employee directory destination')).toBeInTheDocument()
    expect(screen.getByTestId('correction-route')).toHaveTextContent('/employees')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  it('explains the corrected notch with a notched dot', () => {
    render(<AttendanceLegend />)
    const legend = screen.getByTestId('attendance-legend')
    expect(legend).toHaveTextContent('Corrected')
    expect(legend).toHaveTextContent('notch = corrected')
    expect(legend.querySelector('[data-corrected="true"]')).not.toBeNull()
  })
})
