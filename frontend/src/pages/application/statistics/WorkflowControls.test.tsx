import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { WorkflowControls } from './WorkflowControls'
import { workflowMonth, workflowSubmission } from './workflowFixtures'
import type { UseInmateRegister } from './useInmateRegister'

const actions = { prepareMonth: vi.fn(), reviewMonth: vi.fn(), approveMonth: vi.fn(), returnMonth: vi.fn(), reopenMonth: vi.fn() }
function state(overrides: Partial<UseInmateRegister> = {}): UseInmateRegister {
  return { month: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn(),
    history: [], historyLoading: false, historyError: null, selectedReport: undefined,
    reportLoading: false, reportError: null, refreshReport: vi.fn(),
    reviewers: [{ user_id: 2, name_ar: 'مراجع تجريبي', employee_id: 'G200' }],
    managers: [{ user_id: 3, name_ar: 'مدير تجريبي', employee_id: 'G300' }],
    candidatesLoading: false, candidatesError: null, createManualRow: vi.fn(), updateManualRow: vi.fn(),
    deleteManualRow: vi.fn(), completeImport: vi.fn(), isWriting: false, mutationError: null, ...actions, ...overrides }
}
const tr = (key: string) => i18n.t(`inmateStats.workflow.${key}`)
beforeEach(() => { vi.clearAllMocks(); void i18n.changeLanguage('en') })

describe('monthly report action safeguards', () => {
  it('requires viewing the current draft before preparation while an archived report is visible', async () => {
    const month = workflowMonth()
    const { rerender } = render(<WorkflowControls month={month} register={state()} viewedSubmissionId={9} viewedDraftFingerprint={null} onOpenReport={vi.fn()} onCorrectEntry={vi.fn()} />)
    await userEvent.click(screen.getByRole('combobox', { name: tr('select.reviewer') }))
    await userEvent.click(screen.getByRole('option', { name: /G200/ }))
    expect(screen.getByRole('button', { name: tr('prepare') })).toBeDisabled()
    month.workflow.blockers = [{ code: 'INMATE_REGISTER_MONTH_NOT_ENDED' }]
    rerender(<WorkflowControls month={month} register={state()} viewedSubmissionId={null} viewedDraftFingerprint={month.projection_fingerprint} onOpenReport={vi.fn()} onCorrectEntry={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: tr('prepare') }))
    expect(actions.prepareMonth).toHaveBeenCalledWith({ expected_version: 0, expected_projection_fingerprint: 'draft-fingerprint', reviewer_user_id: 2 })
  })

  it('lets a reviewer pass the exact opened report to an eligible manager before month-end', async () => {
    const month = workflowMonth()
    month.workflow = { ...month.workflow, version: 3, state: 'awaiting_review', active_submission_id: 42, allowed_actions: ['review', 'return'], blockers: [{ code: 'INMATE_REGISTER_MONTH_NOT_ENDED' }] }
    const props = { month, viewedDraftFingerprint: null, onOpenReport: vi.fn(), onCorrectEntry: vi.fn() }
    const { rerender } = render(<WorkflowControls {...props} viewedSubmissionId={null} register={state()} />)
    await userEvent.click(screen.getByRole('combobox', { name: tr('select.manager') }))
    await userEvent.click(screen.getByRole('option', { name: /G300/ }))
    expect(screen.getByRole('button', { name: tr('review') })).toBeDisabled()
    rerender(<WorkflowControls {...props} viewedSubmissionId={42} register={state({ selectedReport: workflowSubmission() })} />)
    await userEvent.click(screen.getByRole('button', { name: tr('review') }))
    expect(actions.reviewMonth).toHaveBeenCalledWith({ expected_version: 3, submission_id: 42, manager_user_id: 3 })
  })

  it('never approves an archived, stale or still-loading report, even with current server approval permission', () => {
    const month = workflowMonth()
    month.workflow = { ...month.workflow, state: 'awaiting_manager', active_submission_id: 42, allowed_actions: ['approve', 'return'] }
    const props = { month, viewedDraftFingerprint: null, onOpenReport: vi.fn(), onCorrectEntry: vi.fn() }
    const { rerender } = render(<WorkflowControls {...props} viewedSubmissionId={41} register={state({ selectedReport: workflowSubmission({ submission_id: 41, current: false }) })} />)
    expect(screen.getByRole('button', { name: tr('approve') })).toBeDisabled()
    rerender(<WorkflowControls {...props} viewedSubmissionId={42} register={state({ selectedReport: workflowSubmission({ stale: true }) })} />)
    expect(screen.getByRole('button', { name: tr('approve') })).toBeDisabled()
    rerender(<WorkflowControls {...props} viewedSubmissionId={42} register={state({ selectedReport: workflowSubmission(), reportLoading: true })} />)
    expect(screen.getByRole('button', { name: tr('approve') })).toBeDisabled()
    expect(actions.approveMonth).not.toHaveBeenCalled()
  })

  it('confirms final approval with the selected submission and leaves unperformed actors empty', async () => {
    const month = workflowMonth()
    month.workflow = { ...month.workflow, version: 4, state: 'awaiting_manager', active_submission_id: 42, allowed_actions: ['approve'], manager: { user_id: 3, employee_id: 'G300', name_ar: 'مدير تجريبي', eligible: true } }
    render(<WorkflowControls month={month} register={state({ selectedReport: workflowSubmission() })} viewedSubmissionId={42} viewedDraftFingerprint={null} onOpenReport={vi.fn()} onCorrectEntry={vi.fn()} />)
    expect(within(screen.getByRole('list')).queryByText('G300')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: tr('approve') }))
    expect(actions.approveMonth).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: tr('approve') }))
    expect(actions.approveMonth).toHaveBeenCalledWith({ expected_version: 4, submission_id: 42 })
  })

  it('requires a reason and explicit confirmation for reopening', async () => {
    const month = workflowMonth({ closed: true })
    month.workflow = { ...month.workflow, state: 'closed', version: 7, allowed_actions: ['reopen'] }
    render(<WorkflowControls month={month} register={state()} viewedSubmissionId={null} viewedDraftFingerprint={null} onOpenReport={vi.fn()} onCorrectEntry={vi.fn()} />)
    const reopen = screen.getByRole('button', { name: i18n.t('inmateStats.actions.reopen') })
    expect(reopen).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: tr('reason') }), { target: { value: 'Correct wing assignments' } })
    await userEvent.click(reopen)
    expect(actions.reopenMonth).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t('inmateStats.actions.reopen') }))
    expect(actions.reopenMonth).toHaveBeenCalledWith({ expected_version: 7, reason: 'Correct wing assignments' })
  })
})
