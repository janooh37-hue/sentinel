import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'

import { ageDays, ageGroup, useFileSignedCopy, useScanBack, useScanBackUpload } from './useScanBack'
import * as apiMod from '@/lib/api'


const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(
      MemoryRouter,
      null,
      createElement(QueryClientProvider, { client: qc }, children),
    )
}

beforeEach(() => vi.clearAllMocks())

// Real wire shape: `Book.created_at` is stored naive LOCAL (Asia/Dubai) but is
// serialized with an explicit `+04:00` offset by `ORMBase._tag_timezone`
// (backend/app/schemas/_base.py) — never bare, never space-separated. Build the
// fixture from an absolute instant `t`, portably (no hardcoding the test
// runner's own timezone): shift the instant 4h forward, format as UTC so the
// printed digits are the Dubai wall-clock face, then swap 'Z' for the explicit
// offset that's actually on the wire.
function dubaiWire(t: number): string {
  return new Date(t + 4 * 3600_000).toISOString().replace('Z', '+04:00')
}

describe('ageDays', () => {
  it('is 0 for a record created moments ago', () => {
    expect(ageDays(dubaiWire(Date.now()))).toBe(0)
  })

  it('floors 10 days + 1 hour to 10 (a +4h misparse would floor this to 9)', () => {
    const t = Date.now() - (10 * 24 + 1) * 3600_000
    expect(ageDays(dubaiWire(t))).toBe(10)
  })

  it('floors 10 days + 23 hours to 10 (a -4h misparse would floor this to 11)', () => {
    const t = Date.now() - (10 * 24 + 23) * 3600_000
    expect(ageDays(dubaiWire(t))).toBe(10)
  })
})

describe('ageGroup', () => {
  it('buckets by the spec boundaries', () => {
    expect(ageGroup(40)).toBe('overMonth')
    expect(ageGroup(30)).toBe('overMonth')
    expect(ageGroup(29)).toBe('weeks')
    expect(ageGroup(14)).toBe('weeks')
    expect(ageGroup(13)).toBe('recent')
    expect(ageGroup(2)).toBe('recent')
  })
})

describe('useScanBack permissions', () => {
  it('does not query when books.edit is granted without books.view', async () => {
    capabilityState.allowed = new Set(['books.edit'])
    const listAwaitingScanBooks = vi
      .spyOn(apiMod.api, 'listAwaitingScanBooks')
      .mockResolvedValue([])
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useScanBack(), { wrapper: wrapperFor(qc) })
    await waitFor(() => expect(qc.isFetching()).toBe(0))

    expect(result.current.enabled).toBe(false)
    expect(listAwaitingScanBooks).not.toHaveBeenCalled()
  })
})

describe('useFileSignedCopy', () => {
  it('resolves (never rejects) on a failed upload, and toasts the error exactly once', async () => {
    const qc = new QueryClient()
    vi.spyOn(apiMod.api, 'addBookAttachment').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFileSignedCopy(), { wrapper: wrapperFor(qc) })

    // mutateAsync rejects on failure even though onError already fires (that's
    // the documented difference from `mutate`) — file() must swallow it so every
    // fire-and-forget `void onFile(...)` call site (row, dock, gate) stays safe.
    await expect(
      result.current.file(1, 'GS-0410', new File([], 'x.pdf')),
    ).resolves.toBeUndefined()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('surfaces a structured backend error message', async () => {
    const qc = new QueryClient()
    vi.spyOn(apiMod.api, 'addBookAttachment').mockRejectedValue(
      new apiMod.ApiError(422, 'BOOK_BARCODE_REF_MISMATCH', 'Reference barcode does not match'),
    )
    const { result } = renderHook(() => useFileSignedCopy(), { wrapper: wrapperFor(qc) })
    await result.current.file(1, 'GS-0410', new File([], 'x.pdf'))
    expect(toast.error).toHaveBeenCalledWith('Reference barcode does not match')
  })

  it('uses the localized fallback for an unstructured error', async () => {
    const qc = new QueryClient()
    vi.spyOn(apiMod.api, 'addBookAttachment').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFileSignedCopy(), { wrapper: wrapperFor(qc) })
    await result.current.file(1, 'GS-0410', new File([], 'x.pdf'))
    expect(toast.error).toHaveBeenCalledWith('scanBack.uploadError')
  })
})

describe('useScanBackUpload', () => {
  it('files a barcode match and refreshes books and notification counts', async () => {
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    vi.spyOn(apiMod.api, 'scanBack').mockResolvedValue({
      book_id: 1,
      ref_number: '1/5/141',
      outcome: 'filed',
    })
    const { result } = renderHook(() => useScanBackUpload(), { wrapper: wrapperFor(qc) })

    act(() => result.current.upload(new File([], 'x.pdf')))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('scanBack.autoFiled'))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications', 'counts'] })
  })

  it('parks an uncertain scan in the inbox with an informational toast', async () => {
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    vi.spyOn(apiMod.api, 'scanBack').mockResolvedValue({
      book_id: 1,
      ref_number: '1/5/141',
      outcome: 'parked',
    })
    const { result } = renderHook(() => useScanBackUpload(), { wrapper: wrapperFor(qc) })

    act(() => result.current.upload(new File([], 'x.pdf')))
    await waitFor(() => expect(toast.info).toHaveBeenCalled())

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['scan-inbox'] })
    expect(toast.error).not.toHaveBeenCalled()
  })
})
