import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { api, type WorkforceCoverageParams } from '@/lib/api'
import { WorkforceCoverageSheet } from './WorkforceCoverageSheet'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getWorkforceCoverage: vi.fn(),
    },
  }
})

function pageFor(params: WorkforceCoverageParams) {
  if (params.parent_kind === 'organization') {
    return {
      items: [
        { kind: 'department' as const, department: 'Security', scheduled: 12, excused: 1, expected: 11, evaluated_count: 11, pending_or_error_excluded_count: 0, working: 10, child_count: 1 },
        { kind: 'department' as const, department: 'Operations', scheduled: 6, excused: 0, expected: 6, evaluated_count: 0, pending_or_error_excluded_count: 6, working: null, child_count: 1 },
      ],
    }
  }
  if (params.parent_kind === 'department') {
    return {
      items: [{ kind: 'duty_unit' as const, department: params.department, duty_unit: `${params.department} Gate`, scheduled: 4, excused: 0, expected: 4, evaluated_count: 4, pending_or_error_excluded_count: 0, working: 4, child_count: 1 }],
    }
  }
  return {
    items: [{ kind: 'duty_post' as const, department: params.department, duty_unit: params.duty_unit, duty_post: 'North gate', scheduled: 2, excused: 0, expected: 2, evaluated_count: 2, pending_or_error_excluded_count: 0, working: 2, child_count: 0, employee_id: 'G1001' }],
  }
}

function renderSheet(open = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <WorkforceCoverageSheet open={open} onOpenChange={vi.fn()} operationalDate="2026-08-24" />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  void i18n.changeLanguage('en')
  vi.mocked(api.getWorkforceCoverage).mockReset()
  vi.mocked(api.getWorkforceCoverage).mockImplementation(async (params) => pageFor(params))
})

describe('WorkforceCoverageSheet', () => {
  it('loads only when opened and narrows hierarchy without rendering employee identity', async () => {
    const view = renderSheet()
    expect(api.getWorkforceCoverage).not.toHaveBeenCalled()

    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <I18nextProvider i18n={i18n}>
          <WorkforceCoverageSheet open onOpenChange={vi.fn()} operationalDate="2026-08-24" />
        </I18nextProvider>
      </QueryClientProvider>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Security' }))
    await waitFor(() => expect(api.getWorkforceCoverage).toHaveBeenLastCalledWith(expect.objectContaining({ parent_kind: 'department', department: 'Security' })))

    await user.click(await screen.findByRole('button', { name: 'Security Gate' }))
    await waitFor(() => expect(api.getWorkforceCoverage).toHaveBeenLastCalledWith(expect.objectContaining({ parent_kind: 'duty_unit', department: 'Security', duty_unit: 'Security Gate' })))
    expect(await screen.findByText('North gate')).toBeInTheDocument()
    expect(screen.queryByText('G1001')).not.toBeInTheDocument()
  })

  it('resets descendants when a different department is selected and backs up one level', async () => {
    renderSheet(true)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Security' }))
    await user.click(await screen.findByRole('button', { name: 'Security Gate' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('button', { name: 'Security Gate' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All departments' }))
    await user.click(await screen.findByRole('button', { name: 'Operations' }))
    await waitFor(() => expect(api.getWorkforceCoverage).toHaveBeenLastCalledWith(expect.objectContaining({ parent_kind: 'department', department: 'Operations' })))
  })

  it('labels withheld working totals as pending verification rather than zero', async () => {
    renderSheet(true)
    expect(await screen.findByText('Pending verification')).toBeInTheDocument()
    expect(screen.queryByText('On duty 0')).not.toBeInTheDocument()
  })

  it('loads the next cursor page only when requested', async () => {
    const root = pageFor({ operational_date: '2026-08-24', parent_kind: 'organization' })
    vi.mocked(api.getWorkforceCoverage)
      .mockReset()
      .mockResolvedValueOnce({ items: root.items.slice(0, 1), next_cursor: 'page-two' })
      .mockResolvedValueOnce({ items: root.items.slice(1), next_cursor: null })

    renderSheet(true)
    const user = userEvent.setup()

    expect(await screen.findByRole('button', { name: 'Security' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => expect(api.getWorkforceCoverage).toHaveBeenLastCalledWith(expect.objectContaining({ parent_kind: 'organization', cursor: 'page-two' })))
    expect(await screen.findByRole('button', { name: 'Operations' })).toBeInTheDocument()
  })
})
