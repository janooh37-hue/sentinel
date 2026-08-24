/**
 * The two download hooks: how the file reaches disk, and what a failure does.
 *
 * This is the app's first real save-as — every other blob helper opens a
 * preview in a tab — so the object-URL lifetime and the promise contract have
 * no in-repo precedent to inherit and are pinned here instead.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: { fetchTimesheetExport: vi.fn(), fetchTimesheetEmployeeExport: vi.fn() },
  apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

import { api } from '@/lib/api'

import { useTimesheetDownload } from './useTimesheet'

const fetchExport = vi.mocked(api.fetchTimesheetExport)

const ARGS = { year: 2026, month: 7, sheet: 'main', variant: 'attendance' } as const

const createObjectURL = vi.fn(() => 'blob:workbook')
const revokeObjectURL = vi.fn()
/** Revoke calls counted at the moment the browser was handed the anchor. */
let revokedAtClick = -1

function renderDownload() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return renderHook(() => useTimesheetDownload(), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  revokedAtClick = -1
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  // jsdom navigates on a real anchor click; the spy also samples the revoke
  // count at exactly the instant the download starts.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    revokedAtClick = revokeObjectURL.mock.calls.length
  })
})

afterEach(() => vi.restoreAllMocks())

describe('useTimesheetDownload', () => {
  it('revokes the object URL only after the download has started', async () => {
    fetchExport.mockResolvedValue({ blob: new Blob(['x']), filename: 'kashf.xlsx' })
    const { result } = renderDownload()

    await act(async () => {
      await result.current.download(ARGS)
    })

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    // Firefox CANCELS the download when the blob URL is revoked before the
    // download's own fetch begins — no file, and no error to explain it.
    expect(revokedAtClick).toBe(0)
    expect(revokeObjectURL).not.toHaveBeenCalled()

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
    })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:workbook')
  })

  it('reports a failure without rejecting the promise the caller will not catch', async () => {
    fetchExport.mockRejectedValue(new Error('The month is closed.'))
    const { result } = renderDownload()

    // The natural Task 9 handler: `onClick={() => void download(args)}`. A
    // rethrow here is an unhandled promise rejection, which vitest fails on.
    await act(async () => {
      void result.current.download(ARGS)
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The month is closed.'))
    expect(revokeObjectURL).not.toHaveBeenCalled()

    // And the awaited form resolves rather than throwing.
    await expect(result.current.download(ARGS)).resolves.toBeUndefined()
  })
})
