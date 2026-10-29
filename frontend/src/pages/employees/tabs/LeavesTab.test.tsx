import { fireEvent, render as renderWithTestingLibrary, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type * as ApiModule from '@/lib/api'
import { ApiError } from '@/lib/api'

const { hasCapability, listEmployeeLeaves } = vi.hoisted(() => ({
  hasCapability: vi.fn<(cap: string) => boolean>(() => true),
  listEmployeeLeaves: vi.fn(),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: hasCapability }),
}))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { listEmployeeLeaves },
}))

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithTestingLibrary(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  hasCapability.mockReturnValue(true)
  listEmployeeLeaves.mockReset().mockResolvedValue([])
})
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

import type { RecentLeaveRead } from '@/lib/api'
import { LeavesTab } from './LeavesTab'

const legacyBilingualLeave: RecentLeaveRead = {
  id: 1,
  leave_type: 'Sick Leave - الإجازة المرضية',
  status: 'Approved - موافق',
  start_date: '2026-03-25',
  end_date: '2026-03-26',
  days: 2,
  linked_documents: [],
}

describe('LeavesTab', () => {
  it('normalizes a legacy bilingual status to the success pill (not neutral)', () => {
    render(
      <LeavesTab
        employeeId="G1"
        leaves={[legacyBilingualLeave]}
        onPreviewDocs={vi.fn()}
      />,
    )
    const pill = screen.getByLabelText('status-Approved')
    expect(pill.className).toContain('text-success')
    expect(pill.className).not.toContain('text-muted-foreground')
  })

  it('renders a linked leave as a real button and previews documents in backend order', () => {
    const onPreviewDocs = vi.fn()
    const linkedLeave: RecentLeaveRead = {
      ...legacyBilingualLeave,
      id: 2,
      leave_type: 'Annual Leave',
      linked_documents: [
        { id: 81, template_id: 'leave_application', created_at: '2026-03-01T08:00:00Z' },
        { id: 82, template_id: 'duty_resumption', created_at: '2026-03-28T08:00:00Z' },
      ],
    }

    render(
      <LeavesTab
        employeeId="G1"
        leaves={[linkedLeave]}
        onPreviewDocs={onPreviewDocs}
      />,
    )

    const row = screen.getByText('leaves.type.Annual Leave').closest('button')
    expect(row).toHaveAttribute('type', 'button')
    expect(row).toHaveClass('focus-visible:ring-inset')
    expect(row).not.toHaveClass('focus-visible:ring-offset-1')
    fireEvent.click(row!)
    expect(onPreviewDocs).toHaveBeenCalledWith([
      { id: 81, name: 'leave_application' },
      { id: 82, name: 'duty_resumption' },
    ])
  })

  it('leaves an unlinked leave without a dead button affordance', () => {
    render(
      <LeavesTab
        employeeId="G1"
        leaves={[legacyBilingualLeave]}
        onPreviewDocs={vi.fn()}
      />,
    )

    expect(screen.getByText('leaves.type.Sick Leave - الإجازة المرضية').closest('button')).toBeNull()
  })
})

it.each(['leaves.view', 'employees.view'])('suppresses history and cached snapshot when %s is denied', (denied) => {
  hasCapability.mockImplementation((cap) => cap !== denied)
  render(<LeavesTab employeeId="G1" leaves={[legacyBilingualLeave]} onPreviewDocs={vi.fn()} />)
  expect(screen.getByRole('alert')).toHaveTextContent('common.forbidden')
  expect(screen.queryByText('leaves.type.Sick Leave - الإجازة المرضية')).not.toBeInTheDocument()
  expect(screen.queryByText('employee.leaves.empty')).not.toBeInTheDocument()
  expect(listEmployeeLeaves).not.toHaveBeenCalled()
})

it('shows a server refusal instead of an empty history or stale snapshot', async () => {
  listEmployeeLeaves.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Denied'))
  render(<LeavesTab employeeId="G1" leaves={[legacyBilingualLeave]} onPreviewDocs={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('common.forbidden')
  expect(screen.queryByText('employee.leaves.empty')).not.toBeInTheDocument()
  expect(screen.queryByText('leaves.type.Sick Leave - الإجازة المرضية')).not.toBeInTheDocument()
})
