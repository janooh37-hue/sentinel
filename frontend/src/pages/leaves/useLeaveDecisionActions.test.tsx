import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { toast } from '@/lib/toast'

import { useLeaveDecisionActions } from './useLeaveDecisionActions'
import * as apiMod from '@/lib/api'
import i18n from '@/lib/i18n'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const editedLeave: apiMod.LeaveRead = {
  id: 7, employee_id: 'G100', leave_type: 'Annual Leave',
  start_date: '2026-08-02', end_date: '2026-08-25', days: 24,
  status: 'Pending', notes: 'Updated notes', request_date: null,
  doc_path: null, certificate_path: null, created_at: '2026-07-01T10:00:00',
}

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

  it('edits only the supplied fields, caches the result and invalidates leave and book queries', async () => {
    await i18n.changeLanguage('en')
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const update = vi.spyOn(apiMod.api, 'updateLeave').mockResolvedValueOnce(editedLeave)
    const onMutated = vi.fn()
    const { result } = renderHook(
      () => useLeaveDecisionActions({ leaveId: 7, employeeId: 'G100', onMutated }),
      { wrapper: wrapperFor(qc) },
    )
    result.current.editMutation.mutate({ start_date: '2026-08-02', notes: 'Updated notes' })
    await waitFor(() => expect(onMutated).toHaveBeenCalledOnce())
    expect(update).toHaveBeenLastCalledWith(7, { start_date: '2026-08-02', notes: 'Updated notes' })
    expect(qc.getQueryData(['leave', 7])).toEqual(editedLeave)
    for (const queryKey of [['leave', 7], ['leaves-list'], ['leave-balance', 'G100'], ['books']]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey })
    }
    expect(toast.success).toHaveBeenCalledWith('Leave updated')
  })

  it('invalidates linked books as well as leave queries after an approved leave amendment', async () => {
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const amend = vi.spyOn(apiMod.api, 'amendLeave').mockResolvedValueOnce(editedLeave)
    const onMutated = vi.fn()
    const { result } = renderHook(
      () => useLeaveDecisionActions({ leaveId: 7, employeeId: 'G100', onMutated }),
      { wrapper: wrapperFor(qc) },
    )
    result.current.amendMutation.mutate({ end_date: '2026-08-25', reason: 'Corrected dates' })
    await waitFor(() => expect(onMutated).toHaveBeenCalledOnce())
    expect(amend).toHaveBeenCalledWith(7, { end_date: '2026-08-25', reason: 'Corrected dates' })
    for (const queryKey of [['leave', 7], ['leaves-list'], ['leave-balance', 'G100'], ['books']]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey })
    }
  })

  it.each([
    ['LEAVE_DATES_FORBIDDEN', 'datesForbidden'],
    ['LEAVE_DATES_INVALID', 'datesInvalid'],
    ['LEAVE_DUPLICATE', 'duplicate'],
  ])('localizes %s on edit without closing the editor', async (code, key) => {
    await i18n.changeLanguage('en')
    const qc = new QueryClient()
    vi.spyOn(apiMod.api, 'updateLeave').mockRejectedValueOnce(new apiMod.ApiError(422, code, 'Raw error'))
    const onMutated = vi.fn()
    const { result } = renderHook(
      () => useLeaveDecisionActions({ leaveId: 7, employeeId: 'G100', onMutated }),
      { wrapper: wrapperFor(qc) },
    )
    result.current.editMutation.mutate({ end_date: '2026-08-25' })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(i18n.t(`leaves.edit.errors.${key}`)))
    expect(onMutated).not.toHaveBeenCalled()
  })
})
