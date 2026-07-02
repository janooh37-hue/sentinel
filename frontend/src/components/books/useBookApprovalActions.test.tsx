import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { toast } from 'sonner'

import { useBookApprovalActions } from './useBookApprovalActions'
import * as apiMod from '@/lib/api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

describe('useBookApprovalActions', () => {
  it('decide invalidates books/awaiting/dashboard and calls onDecided(act)', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(apiMod.api, 'decideBook').mockResolvedValue({} as any)
    const onDecided = vi.fn()
    const { result } = renderHook(
      () => useBookApprovalActions({ bookId: 5, onDecided, onSigned: vi.fn() }),
      { wrapper: wrapperFor(qc) },
    )
    result.current.decideMutation.mutate({ act: 'reject', note: 'x' })
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('reject'))
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(['books']))
    expect(keys).toContain(JSON.stringify(['books', 'awaiting']))
    expect(keys).toContain(JSON.stringify(['dashboard']))
  })

  it('sign shows the NO_SIGNATURE hint and does not call onSigned', async () => {
    const qc = new QueryClient()
    vi.spyOn(apiMod.api, 'signBook').mockRejectedValue(
      new apiMod.ApiError(400, 'NO_SIGNATURE', 'no sig'),
    )
    const onSigned = vi.fn()
    const { result } = renderHook(
      () => useBookApprovalActions({ bookId: 5, onDecided: vi.fn(), onSigned }),
      { wrapper: wrapperFor(qc) },
    )
    result.current.signMutation.mutate()
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('books.approval.noSignatureHint'),
    )
    expect(onSigned).not.toHaveBeenCalled()
  })
})
