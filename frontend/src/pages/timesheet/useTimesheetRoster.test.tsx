import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { TimesheetGridResponse } from '@/lib/api'
import {
  TIMESHEET_DESIGNATIONS_KEY,
  timesheetMonthKey,
  useCreateTimesheetDesignation,
  useSetTimesheetRoster,
  useTimesheetDesignations,
  useTimesheetGrid,
  useUpdateTimesheetDesignation,
} from './useTimesheet'

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const designation = {
  id: 12,
  name_en: 'Guard',
  name_ar: 'حارس',
  rank_order: 1,
  sheet: 'main',
  active: true,
  system_key: null,
}

const MONTH: TimesheetGridResponse = {
  year: 2026,
  month: 8,
  days_in_month: 31,
  sheet: 'drivers',
  post_count: 249,
  rows: [],
  blocking: [],
  warnings: [],
  removed: [],
  closed_at: null,
  closed_by: null,
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(toast.error).mockReset()
  vi.spyOn(api, 'listDesignations')
  vi.spyOn(api, 'createTimesheetDesignation')
  vi.spyOn(api, 'updateTimesheetDesignation')
  vi.spyOn(api, 'setTimesheetRoster')
  vi.spyOn(api, 'getTimesheet')
})

/**
 * The sibling workbook the roster editor reads while a cross-sheet move is
 * being staged is the SAME month query pointed at the other sheet, so the read
 * is gated rather than duplicated: a page that is not staging anything must not
 * pay for a second workbook (design §"Draft and save").
 */
describe('useTimesheetGrid gating', () => {
  it('asks for nothing while it is disabled, and asks once it is enabled', async () => {
    vi.mocked(api.getTimesheet).mockResolvedValue(MONTH)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const params = { year: 2026, month: 8, sheet: 'drivers' as const }
    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => useTimesheetGrid(params, on),
      { wrapper: wrapperFor(queryClient), initialProps: { on: false } },
    )

    // Disabled is not "loading forever with a request in flight": nothing was
    // asked for, and the caller still gets the stable empties it renders from.
    expect(api.getTimesheet).not.toHaveBeenCalled()
    expect(result.current.rows).toEqual([])
    expect(queryClient.getQueryData(timesheetMonthKey(params))).toBeUndefined()

    rerender({ on: true })

    await waitFor(() => expect(result.current.grid).toEqual(MONTH))
    expect(api.getTimesheet).toHaveBeenCalledTimes(1)
    expect(api.getTimesheet).toHaveBeenCalledWith(params)
  })

  it('reads the month by default, so every existing caller is unchanged', async () => {
    vi.mocked(api.getTimesheet).mockResolvedValue(MONTH)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      () => useTimesheetGrid({ year: 2026, month: 8, sheet: 'main' }),
      { wrapper: wrapperFor(queryClient) },
    )

    await waitFor(() => expect(result.current.grid).toEqual(MONTH))
  })
})

describe('timesheet roster and designation hooks', () => {
  it('loads the designation catalog under the shared key', async () => {
    vi.mocked(api.listDesignations).mockResolvedValue([designation])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useTimesheetDesignations(), {
      wrapper: wrapperFor(queryClient),
    })

    await waitFor(() => expect(result.current.data).toEqual([designation]))
    expect(queryClient.getQueryData(TIMESHEET_DESIGNATIONS_KEY)).toEqual([designation])
  })

  it('invalidates the shared designation key after create and update', async () => {
    vi.mocked(api.createTimesheetDesignation).mockResolvedValue(designation)
    vi.mocked(api.updateTimesheetDesignation).mockResolvedValue(designation)
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    queryClient.setQueryData(TIMESHEET_DESIGNATIONS_KEY, [designation])
    queryClient.setQueryData(['timesheet', 2026, 8, 'main'], { rows: [] })
    queryClient.setQueryData(['timesheet', 2026, 8, 'drivers'], { rows: [] })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = wrapperFor(queryClient)
    const create = renderHook(() => useCreateTimesheetDesignation(), { wrapper })
    const update = renderHook(() => useUpdateTimesheetDesignation(), { wrapper })

    await create.result.current.mutateAsync({ name_en: 'Guard', name_ar: 'حارس', sheet: 'main' })
    await update.result.current.mutateAsync({ id: 12, input: { name_en: 'Guard 2', name_ar: 'حارس 2' } })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: TIMESHEET_DESIGNATIONS_KEY })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['timesheet'] })
    expect(invalidate).toHaveBeenCalledTimes(3)
  })

  it('preserves the structured ApiError when a designation write rejects', async () => {
    const error = new ApiError(409, 'DESIGNATION_EXISTS', 'Already exists', { name: 'Guard' })
    vi.mocked(api.createTimesheetDesignation).mockRejectedValue(error)
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const { result } = renderHook(() => useCreateTimesheetDesignation(), {
      wrapper: wrapperFor(queryClient),
    })

    await expect(
      result.current.mutateAsync({ name_en: 'Guard', name_ar: 'حارس', sheet: 'main' }),
    ).rejects.toBe(error)
    expect(toast.error).toHaveBeenCalledWith('Already exists')
  })
  it('quiet designation writes preserve ApiError rejection without showing a toast', async () => {
    const error = new ApiError(409, 'DESIGNATION_EXISTS', 'Already exists')
    vi.mocked(api.createTimesheetDesignation).mockRejectedValue(error)
    vi.mocked(api.updateTimesheetDesignation).mockRejectedValue(error)
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const wrapper = wrapperFor(queryClient)
    const create = renderHook(() => useCreateTimesheetDesignation({ quiet: true }), { wrapper })
    const update = renderHook(() => useUpdateTimesheetDesignation({ quiet: true }), { wrapper })

    await expect(
      create.result.current.mutateAsync({ name_en: 'Guard', name_ar: 'حارس', sheet: 'main' }),
    ).rejects.toBe(error)
    await expect(
      update.result.current.mutateAsync({ id: 12, input: { name_en: 'Guard 2', name_ar: 'حارس 2' } }),
    ).rejects.toBe(error)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('sends the exact roster payload and invalidates both selected-month sheets', async () => {
    vi.mocked(api.setTimesheetRoster).mockResolvedValue(undefined)
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    const { result } = renderHook(() => useSetTimesheetRoster(), {
      wrapper: wrapperFor(queryClient),
    })
    const payload = {
      year: 2026,
      month: 8,
      assignments: [{ employee_id: 'G7160', designation_id: 5 }],
    }

    await result.current.mutateAsync(payload)

    expect(api.setTimesheetRoster).toHaveBeenCalledWith(payload)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: timesheetMonthKey({ ...payload, sheet: 'main' }) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: timesheetMonthKey({ ...payload, sheet: 'drivers' }) })
  })
})

describe('timesheet API client contract', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(JSON.stringify(designation), { status: 200 })),
    )
  })

  it('uses the catalog write routes and roster batch route', async () => {
    vi.restoreAllMocks()
    await api.createTimesheetDesignation({ name_en: 'Guard', name_ar: 'حارس', sheet: 'main' })
    await api.updateTimesheetDesignation(12, { name_en: 'Guard 2', name_ar: 'حارس 2' })
    await api.setTimesheetRoster({
      year: 2026,
      month: 8,
      assignments: [{ employee_id: 'G7160', designation_id: 5 }],
    })

    const calls = vi.mocked(fetch).mock.calls
    expect(calls[0]?.[0]).toBe('/api/v1/timesheet/designations')
    expect(calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(calls[1]?.[0]).toBe('/api/v1/timesheet/designations/12')
    expect(calls[1]?.[1]).toMatchObject({ method: 'PATCH' })
    expect(calls[2]?.[0]).toBe('/api/v1/timesheet/2026/8/roster')
    expect(calls[2]?.[1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(String(calls[2]?.[1] && (calls[2]?.[1] as RequestInit).body))).toEqual({
      assignments: [{ employee_id: 'G7160', designation_id: 5 }],
    })
  })
})
