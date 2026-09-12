import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, type InmateRegisterEntry } from '@/lib/api'
import i18n from '@/lib/i18n'
import { StatisticsTab } from './StatisticsTab'
import { inmateRegisterKey } from './useInmateRegister'
import { workflowMonth, workflowSubmission } from './workflowFixtures'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    getInmateRegisterMonth: vi.fn(), getInmateRegisterSubmissions: vi.fn(),
    getInmateRegisterSubmission: vi.fn(), getInmateRegisterTasks: vi.fn(),
  } }
})
const row = (name: string): InmateRegisterEntry => ({ id: name, name, origin: 'derived', row_no: 1, population: 'citizens',
  uid: '', nationality_label: 'الإمارات', nationality_code: 'AE', violation_date: '2026-08-06', duty_unit: 'Unit 1',
  details_text: 'Synthetic details', wing: '1A', holding_no: '', reporter_id: 'G100', reporter_name: 'Synthetic reporter',
  source_book_id: 1, source_version_no: 1, source_row_index: 0, source_ref_number: 'IV-1', incomplete_marks: [],
  missing: [], duplicate_of: null, completion_book_id: null, manual: null })
const live = () => {
  const month = workflowMonth({ entries: [row('Current draft inmate')], counts: { citizens: 1, expats: 0, pending: 0, total: 1 } })
  month.workflow = { ...month.workflow, state: 'awaiting_manager', allowed_actions: ['approve'], active_submission_id: 42 }
  return month
}
function mount(search: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/application?stats_month=2026-08${search}`]}><StatisticsTab /></MemoryRouter></QueryClientProvider>)
  return client
}
beforeEach(() => {
  vi.clearAllMocks(); void i18n.changeLanguage('en')
  vi.mocked(api.getInmateRegisterMonth).mockResolvedValue(live())
  vi.mocked(api.getInmateRegisterTasks).mockResolvedValue({ count: 0, items: [] })
  vi.mocked(api.getInmateRegisterSubmissions).mockResolvedValue([
    { id: 41, sequence: 1, origin: 'workflow', created_at: '2026-08-10T08:00:00Z', approved_at: null, report_state: 'prepared', current: false, stale: true },
    { id: 42, sequence: 2, origin: 'workflow', created_at: '2026-08-20T08:00:00Z', approved_at: null, report_state: 'reviewed', current: true, stale: false },
  ])
  vi.mocked(api.getInmateRegisterSubmission).mockImplementation(async (_, id) => workflowSubmission({ submission_id: id, current: id === 42, stale: id === 41,
    entries: [row(id === 41 ? 'Archived inmate' : 'Submitted inmate')], counts: { citizens: 1, expats: 0, pending: 0, total: 1 } }))
})
describe('immutable report selection', () => {
  it('opens an exact history link and does not replace it when the active submission changes', async () => {
    const client = mount('&stats_submission=41')
    expect((await screen.findAllByText('Archived inmate')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Current draft inmate')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('inmateStats.workflow.approve') })).toBeDisabled()
    const changed = live(); changed.workflow.active_submission_id = 77
    act(() => client.setQueryData(inmateRegisterKey(2026, 8), changed))
    expect(screen.getAllByText('Archived inmate').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: i18n.t('inmateStats.views.register') }))
    expect(screen.getAllByText('Current draft inmate').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: i18n.t('inmateStats.views.export') }))
    expect((await screen.findAllByText('Archived inmate')).length).toBeGreaterThan(0)
  })

  it('defaults export to the active submission and exposes an explicit draft choice', async () => {
    mount('')
    await screen.findAllByText('Current draft inmate')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('inmateStats.views.export') }))
    expect((await screen.findAllByText('Submitted inmate')).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('combobox', { name: i18n.t('inmateStats.workflow.reportSelection') }))
    await userEvent.click(screen.getByRole('option', { name: i18n.t('inmateStats.workflow.currentDraft') }))
    expect((await screen.findAllByText('Current draft inmate')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Submitted inmate')).not.toBeInTheDocument()
  })

  it.each([403, 404])('shows a %s report error without substituting current data', async (status) => {
    vi.mocked(api.getInmateRegisterSubmission).mockRejectedValue(new ApiError(status, 'FORBIDDEN', 'Synthetic error'))
    mount('&stats_submission=999')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(i18n.t(`inmateStats.workflow.${status === 403 ? 'reportForbidden' : 'reportNotFound'}`)))
    expect(screen.queryByText('Current draft inmate')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('inmateStats.workflow.approve') })).toBeDisabled()
  })

  it.each(['0', '-1', '1e2', '4.2', '9007199254740992'])('rejects invalid submission %s before loading a report', (value) => {
    mount(`&stats_submission=${value}`)
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('inmateStats.workflow.invalidLink'))
    expect(api.getInmateRegisterMonth).not.toHaveBeenCalled()
  })
})
