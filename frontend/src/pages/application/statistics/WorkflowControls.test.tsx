import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { WorkflowControls } from './WorkflowControls'
import { workflowMonth } from './workflowFixtures'
import type { UseInmateRegister } from './useInmateRegister'

function state(overrides: Partial<UseInmateRegister> = {}): UseInmateRegister {
  return {
    month: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    reviewers: [{ user_id: 2, name_ar: 'مراجع تجريبي', employee_id: 'G200' }],
    managers: [{ user_id: 3, name_ar: 'مدير تجريبي', employee_id: 'G300' }],
    candidatesLoading: false,
    candidatesError: null,
    retryCandidates: vi.fn(),
    createManualRow: vi.fn(),
    updateManualRow: vi.fn(),
    deleteManualRow: vi.fn(),
    completeImport: vi.fn(),
    prepareMonth: vi.fn(),
    reviewMonth: vi.fn(),
    returnMonth: vi.fn(),
    approveMonth: vi.fn(),
    reopenMonth: vi.fn(),
    isWriting: false,
    mutationError: null,
    ...overrides,
  }
}

const label = (key: string) => i18n.t(`inmateStats.workflow.${key}`)

beforeEach(() => {
  void i18n.changeLanguage('en')
})

describe('monthly report workflow controls', () => {
  it('shows only actions allowed by the current workflow state', () => {
    const month = workflowMonth()
    const { rerender } = render(
      <WorkflowControls month={month} register={state()} onCorrectEntry={vi.fn()} />,
    )

    expect(screen.getByRole('button', { name: label('prepare') })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: label('review') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: label('approve') })).not.toBeInTheDocument()

    month.workflow = {
      ...month.workflow,
      state: 'awaiting_manager',
      allowed_actions: ['approve', 'return'],
    }
    rerender(<WorkflowControls month={month} register={state()} onCorrectEntry={vi.fn()} />)

    expect(screen.queryByRole('button', { name: label('prepare') })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: label('approve') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: label('return') })).toBeInTheDocument()
  })

  it('surfaces mutation and candidate failures and retries the candidate query', () => {
    const retryCandidates = vi.fn()
    render(
      <WorkflowControls
        month={workflowMonth()}
        register={state({
          mutationError: 'Workflow changed',
          candidatesError: new Error('offline'),
          retryCandidates,
        })}
        onCorrectEntry={vi.fn()}
      />,
    )

    const alerts = screen.getAllByRole('alert')
    expect(alerts[0]).toHaveTextContent('Workflow changed')
    expect(alerts[1]).toHaveTextContent(i18n.t('inmateStats.workflow.candidatesError'))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(retryCandidates).toHaveBeenCalledOnce()
  })
})
