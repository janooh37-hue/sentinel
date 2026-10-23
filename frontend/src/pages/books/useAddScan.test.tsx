import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { toast } from '@/lib/toast'
import { useAddScan } from './useAddScan'

const api = vi.hoisted(() => ({ postIntake: vi.fn(), addBookAttachment: vi.fn() }))
vi.mock('@/lib/api', () => ({ api, apiErrorMessage: (error: Error) => error.message }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/toast', () => ({ toast: {
  loading: vi.fn(() => 'reading-scan'), success: vi.fn(), info: vi.fn(), error: vi.fn(), dismiss: vi.fn(),
} }))

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return renderHook(() => useAddScan(1), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  })
}

const file = new File([], 'scan.pdf')
const match = { mode: 'returned_form', book_id: 1, ref_number: 'GS-0410' }
beforeEach(() => { vi.clearAllMocks() })

describe('useAddScan toast lifecycle', () => {
  it('morphs reading into filed success, keeping the raw reference', async () => {
    api.postIntake.mockResolvedValue(match)
    api.addBookAttachment.mockResolvedValue(undefined)
    const { result } = setup()
    await act(() => result.current.submit(file))
    expect(toast.loading).toHaveBeenCalledWith('books.pane.scanReading')
    expect(toast.success).toHaveBeenCalledWith('books.pane.scanFiledHere', { id: 'reading-scan', reference: 'GS-0410' })
    expect(toast.dismiss).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
  })

  it('dismisses reading when a different match opens confirmation', async () => {
    api.postIntake.mockResolvedValue({ ...match, book_id: 2 })
    const { result } = setup()
    await act(() => result.current.submit(file))
    expect(result.current.otherMatch).toEqual({ bookId: 2, ref: 'GS-0410', file })
    expect(toast.dismiss).toHaveBeenCalledWith('reading-scan')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('morphs reading into information when no reference matches', async () => {
    api.postIntake.mockResolvedValue({ mode: 'external' })
    const { result } = setup()
    await act(() => result.current.submit(file))
    expect(toast.info).toHaveBeenCalledWith('books.pane.scanNoRef', { id: 'reading-scan' })
    expect(toast.dismiss).not.toHaveBeenCalled()
  })

  it.each(['reading', 'attachment'])('morphs reading into an error after a failed %s', async (step) => {
    api.postIntake.mockResolvedValue(match)
    if (step === 'reading') api.postIntake.mockRejectedValue(new Error('failed'))
    else api.addBookAttachment.mockRejectedValue(new Error('failed'))
    const { result } = setup()
    await act(() => result.current.submit(file))
    expect(toast.error).toHaveBeenCalledWith('failed', { id: 'reading-scan' })
    expect(toast.dismiss).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
  })
})
