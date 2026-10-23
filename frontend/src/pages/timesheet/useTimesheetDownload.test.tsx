/**
 * The two download hooks: how the file reaches disk, and what a failure does.
 *
 * This is the app's first real save-as — every other blob helper opens a
 * preview in a tab — so the object-URL lifetime and the promise contract have
 * no in-repo precedent to inherit and are pinned here instead.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { toast } from '@/lib/toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ApiModule from '@/lib/api'

vi.mock('@/lib/toast', () => ({ toast: { loading: vi.fn(() => 'pending-download'), dismiss: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { fetchTimesheetExport: vi.fn(), fetchTimesheetEmployeeExport: vi.fn() },
}))

import { api } from '@/lib/api'

import { useEmployeeSheetDownload, useTimesheetDownload } from './useTimesheet'

const fetchExport = vi.mocked(api.fetchTimesheetExport)

const ARGS = { year: 2026, month: 7, sheet: 'main', variant: 'attendance' } as const

const createObjectURL = vi.fn(() => 'blob:workbook')
const revokeObjectURL = vi.fn()
/** Revoke calls counted at the moment the browser was handed the anchor. */
let revokedAtClick = -1

function renderDownload<T>(hook: () => T) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return renderHook(hook, {
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
    const { result } = renderDownload(useTimesheetDownload)

    await act(async () => {
      await result.current.download(ARGS)
    })

    expect(toast.loading).toHaveBeenCalledWith('timesheet.release.downloadingWorkbook')
    expect(toast.success).toHaveBeenCalledWith('timesheet.release.workbookDownloaded', { id: 'pending-download' })
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
    const { result } = renderDownload(useTimesheetDownload)

    // The natural Task 9 handler: `onClick={() => void download(args)}`. A
    // rethrow here is an unhandled promise rejection, which vitest fails on.
    await act(async () => {
      void result.current.download(ARGS)
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Something went wrong', { id: 'pending-download' }))
    expect(toast.loading).toHaveBeenCalledWith('timesheet.release.downloadingWorkbook')
    expect(revokeObjectURL).not.toHaveBeenCalled()

    // And the awaited form resolves rather than throwing.
    await expect(result.current.download(ARGS)).resolves.toBeUndefined()
  })

  it('resolves the loading toast when saving the workbook throws', async () => {
    fetchExport.mockResolvedValue({ blob: new Blob(['x']), filename: 'kashf.xlsx' })
    createObjectURL.mockImplementationOnce(() => { throw new Error('Download unavailable') })
    const { result } = renderDownload(useTimesheetDownload)

    await act(async () => { await result.current.download(ARGS) })

    expect(toast.loading).toHaveBeenCalledWith('timesheet.release.downloadingWorkbook')
    expect(toast.error).toHaveBeenCalledWith('Something went wrong', { id: 'pending-download' })
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('useEmployeeSheetDownload', () => {
  const args = { employeeId: 'G100', year: 2026, month: 7, months: 1 } as const

  it('morphs loading into success after downloading the employee sheet', async () => {
    vi.mocked(api.fetchTimesheetEmployeeExport).mockResolvedValue({ blob: new Blob(['x']), filename: 'employee.xlsx' })
    const { result } = renderDownload(useEmployeeSheetDownload)

    await act(async () => { await result.current.download(args) })

    expect(toast.loading).toHaveBeenCalledWith('timesheet.employee.downloadingSheet')
    expect(toast.success).toHaveBeenCalledWith('timesheet.employee.sheetDownloaded', { id: 'pending-download' })
  })

  it('morphs loading into an error without rejecting the download promise', async () => {
    vi.mocked(api.fetchTimesheetEmployeeExport).mockRejectedValue(new Error('Sheet unavailable'))
    const { result } = renderDownload(useEmployeeSheetDownload)

    await act(async () => { await expect(result.current.download(args)).resolves.toBeUndefined() })

    expect(toast.loading).toHaveBeenCalledWith('timesheet.employee.downloadingSheet')
    expect(toast.error).toHaveBeenCalledWith('Something went wrong', { id: 'pending-download' })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('resolves the loading toast when saving the employee sheet throws', async () => {
    vi.mocked(api.fetchTimesheetEmployeeExport).mockResolvedValue({ blob: new Blob(['x']), filename: 'employee.xlsx' })
    createObjectURL.mockImplementationOnce(() => { throw new Error('Download unavailable') })
    const { result } = renderDownload(useEmployeeSheetDownload)

    await act(async () => { await result.current.download(args) })

    expect(toast.error).toHaveBeenCalledWith('Something went wrong', { id: 'pending-download' })
    expect(toast.success).not.toHaveBeenCalled()
  })
})
