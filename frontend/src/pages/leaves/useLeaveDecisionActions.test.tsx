import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { toast } from '@/lib/toast'

import { useLeaveDecisionActions } from './useLeaveDecisionActions'
import * as apiMod from '@/lib/api'
import i18n from '@/lib/i18n'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

describe('useLeaveDecisionActions', () => {
  it('invalidates leave, leaves-list and leave-balance on update (drift fix)', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(apiMod.api, 'updateLeave').mockResolvedValue({} as any)
    const onMutated = vi.fn()
    const { result } = renderHook(
      () => useLeaveDecisionActions({ leaveId: 7, employeeId: 'G100', onMutated }),
      { wrapper: wrapperFor(qc) },
    )
    result.current.updateMutation.mutate({ status: 'Approved', n: '' })
    await waitFor(() => expect(onMutated).toHaveBeenCalled())
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(['leave', 7]))
    expect(keys).toContain(JSON.stringify(['leaves-list']))
    expect(keys).toContain(JSON.stringify(['leave-balance', 'G100']))
  })

  it('routes delete to onDeleted (not onMutated) when provided', async () => {
    const qc = new QueryClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(apiMod.api, 'deleteLeave').mockResolvedValue({} as any)
    const onMutated = vi.fn()
    const onDeleted = vi.fn()
    const { result } = renderHook(
      () => useLeaveDecisionActions({ leaveId: 7, employeeId: 'G100', onMutated, onDeleted }),
      { wrapper: wrapperFor(qc) },
    )
    result.current.deleteMutation.mutate()
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(onMutated).not.toHaveBeenCalled()
  })

  it('sends notify_employee=false on an approve opt-out, and defaults it true otherwise', async () => {
    const qc = new QueryClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(apiMod.api, 'updateLeave').mockResolvedValue({} as any)
    const onMutated = vi.fn()
    const { result } = renderHook(
      () => useLeaveDecisionActions({ leaveId: 7, employeeId: 'G100', onMutated }),
      { wrapper: wrapperFor(qc) },
    )
    result.current.updateMutation.mutate({ status: 'Approved', n: 'ok', notify: false })
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenLastCalledWith(7, {
      status: 'Approved',
      notes: 'ok',
      notify_employee: false,
    })
    // A decision with no `notify` (e.g. reject) keeps notifying.
    result.current.updateMutation.mutate({ status: 'Rejected', n: '' })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(spy).toHaveBeenLastCalledWith(7, {
      status: 'Rejected',
      notes: undefined,
      notify_employee: true,
    })
  })

  it('explains a sign-gated leave approval using the localized record reference', async () => {
    await i18n.changeLanguage('en')
    const qc = new QueryClient()
    const rawMessage = 'This leave is controlled by the record signature.'
    vi.spyOn(apiMod.api, 'updateLeave').mockRejectedValueOnce(
      new apiMod.ApiError(422, 'LEAVE_SIGN_GATED', rawMessage, {
        ref_number: 'HR-42',
        book_id: 42,
      }),
    )
    const { result } = renderHook(
      () => useLeaveDecisionActions({ leaveId: 7, employeeId: 'G100', onMutated: vi.fn() }),
      { wrapper: wrapperFor(qc) },
    )

    result.current.updateMutation.mutate({ status: 'Approved', n: '' })

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Decided by another record',
      { reference: 'HR-42', description: 'This leave is approved when the manager signs that record.' },
    ))
    expect(toast.error).not.toHaveBeenCalledWith(rawMessage)
  })
})
