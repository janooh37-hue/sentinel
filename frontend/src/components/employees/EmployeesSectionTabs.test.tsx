/**
 * EmployeesSectionTabs — the Employees section switcher.
 *
 * Behaviours pinned here:
 *   1. Directory and Attendance link to their routes and the active tab is
 *      marked with aria-current="page".
 *   2. The attention badge appears only when there is something to decide.
 *   3. Attendance is hidden entirely without workforce.people.view, so an
 *      operator never sees a tab that would 403.
 *   4. The Arabic label is bidi-isolated — without it a following number or
 *      clock range renders reversed.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hasCapability = vi.fn<(cap: string) => boolean>()

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set<string>(),
    isLoading: false,
    has: hasCapability,
  }),
}))

import { EmployeesSectionTabs } from './EmployeesSectionTabs'

function renderTabs(
  props: React.ComponentProps<typeof EmployeesSectionTabs> = {},
  at = '/employees',
) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <EmployeesSectionTabs {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  hasCapability.mockReturnValue(true)
})

describe('EmployeesSectionTabs', () => {
  // Queried by href, not by label: whether i18n resolves real copy or echoes
  // keys depends on which other suites ran first, and the route is the contract.
  const linkTo = (href: string): HTMLElement | undefined =>
    screen.getAllByRole('link').find((link) => link.getAttribute('href') === href)

  it('links both destinations and marks the active one', () => {
    renderTabs({ attentionCount: null }, '/employees/attendance')

    expect(linkTo('/employees')).toBeDefined()
    const attendance = linkTo('/employees/attendance')
    expect(attendance).toBeDefined()
    // NavLink owns aria-current: the route is the active tab.
    expect(attendance).toHaveAttribute('aria-current', 'page')
  })

  it('shows the attention count only when there is one', () => {
    const { unmount } = renderTabs({ attentionCount: 20 })
    expect(screen.getByTestId('attendance-attention-badge')).toHaveTextContent('20')
    unmount()

    renderTabs({ attentionCount: null })
    expect(screen.queryByTestId('attendance-attention-badge')).not.toBeInTheDocument()
  })

  it('hides a zero count rather than advertising nothing to do', () => {
    renderTabs({ attentionCount: 0 })
    expect(screen.queryByTestId('attendance-attention-badge')).not.toBeInTheDocument()
  })

  it('hides Attendance without workforce.people.view', () => {
    hasCapability.mockImplementation((cap) => cap !== 'workforce.people.view')

    renderTabs({ attentionCount: 5 })

    expect(linkTo('/employees')).toBeDefined()
    expect(linkTo('/employees/attendance')).toBeUndefined()
  })

  it('isolates the Arabic label so adjacent numbers are not reordered', () => {
    renderTabs({ attentionCount: 20 }, '/employees/attendance')

    const attendance = linkTo('/employees/attendance')
    const arabic = attendance?.querySelector('[dir="rtl"]')
    expect(arabic).not.toBeNull()
    expect(arabic?.className).toContain('isolate-bidi')
  })
})
