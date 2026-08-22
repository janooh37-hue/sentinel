/**
 * EmployeesSectionTabs — the Employees section switcher.
 *
 * Behaviours pinned here:
 *   1. Directory and Attendance link to their routes and the active tab is
 *      marked with aria-current="page".
 *   2. The attention badge appears only when there is something to decide.
 *   3. Attendance is hidden entirely without workforce.people.view, so an
 *      operator never sees a tab that would 403.
 *   4. Time Sheet is the last tab and needs `timesheet.view`.
 *   5. Every tab carries ONE language — the Arabic build renders Arabic labels
 *      with no English companion beside them.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hasCapability = vi.fn<(cap: string) => boolean>()

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set<string>(),
    isLoading: false,
    has: hasCapability,
  }),
}))

// Both bundles, because one case asserts the Arabic labels themselves: the
// global test setup registers English only.
import i18n from '@/lib/i18n'

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

  it('links ORG-tree and marks it active on its own route', () => {
    renderTabs({}, '/employees/org-tree')

    const orgTree = linkTo('/employees/org-tree')
    expect(orgTree).toBeDefined()
    expect(orgTree).toHaveAttribute('aria-current', 'page')
    // Sibling sections stay reachable from it.
    expect(linkTo('/employees')).toBeDefined()
    expect(linkTo('/duty-locations')).toBeDefined()
  })

  it('hides ORG-tree without employees.view', () => {
    hasCapability.mockImplementation((cap) => cap !== 'employees.view')

    renderTabs({})

    expect(linkTo('/employees/org-tree')).toBeUndefined()
    expect(linkTo('/employees')).toBeDefined()
  })

  it('orders Time Sheet last and renders one language per tab', () => {
    renderTabs({}, '/employees/timesheet')

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/employees',
      '/employees/attendance',
      '/employees/org-tree',
      '/duty-locations',
      '/employees/timesheet',
    ])
    expect(linkTo('/employees/timesheet')).toHaveAttribute('aria-current', 'page')
    // The bilingual companion spans are gone, so nothing inside the switcher
    // declares the opposite direction and nothing needs bidi isolation.
    expect(document.querySelector('[dir="rtl"]')).toBeNull()
  })

  it('hides Time Sheet without timesheet.view', () => {
    const { unmount } = renderTabs({}, '/employees')
    expect(linkTo('/employees/timesheet')).toBeDefined()
    unmount()

    hasCapability.mockImplementation((cap) => cap !== 'timesheet.view')
    renderTabs({}, '/employees')

    expect(linkTo('/employees/timesheet')).toBeUndefined()
    // Its ungated neighbour still renders, so this is the gate and not a
    // switcher that failed to mount.
    expect(linkTo('/duty-locations')).toBeDefined()
  })
})

describe('EmployeesSectionTabs (Arabic)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('labels the tabs in Arabic with no English companion', () => {
    renderTabs({}, '/employees/timesheet')

    expect(screen.getByText('كشف الحضور الشهري')).toBeInTheDocument()
    expect(screen.queryByText('Time Sheet')).not.toBeInTheDocument()
    // Attendance carried the companion span that made the tab bilingual; an
    // English leak beside the Arabic label is exactly what was removed.
    expect(screen.getByText('الحضور')).toBeInTheDocument()
    expect(screen.queryByText('Attendance')).not.toBeInTheDocument()
  })
})
