import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type ArmorySafeRead } from '@/lib/api'
import i18n from '@/lib/i18n'

import {
  armoryErrorMessage, armoryErrorRecovery, armoryKeys, useArmoryCacheLifecycle, useArmoryMonthlyCountDraft,
  useArmoryPeople, useArmorySafes, useArmorySettings, useArmoryShiftCheckDraft, useCreateArmorySafe,
} from './armoryQueries'

const access = vi.hoisted(() => ({ principal: 1 as number | null, view: true, edit: true, loading: false }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'armory.view' ? access.view : cap === 'armory.edit' && access.edit, isLoading: access.loading }),
}))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: access.principal === null ? null : { id: access.principal, email: 'armorer@example.test', employee_id: 'T-0001' }, status: 'authed' }),
}))

const SAFE: ArmorySafeRead = { id: 4, name_en: 'Test Safe A', name_ar: 'خزنة اختبار أ', vehicle_site: null, duty_post: null, created_at: '2025-02-04T06:00:00Z' }
const OTHER_SAFE = { ...SAFE, id: 5, name_en: 'Test Safe B', name_ar: 'خزنة اختبار ب' }
const PEOPLE_FILTER = { purpose: 'witness', safe_id: SAFE.id } as const
const SERVER_DETAIL = 'Test backend detail must not be shown'

function queryHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children) }
}

beforeEach(async () => {
  Object.assign(access, { principal: 1, view: true, edit: true, loading: false })
  await i18n.changeLanguage('en')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
})

describe('Armory reads', () => {
  it('binds keys and data to the authenticated principal', async () => {
    const request = vi.spyOn(api, 'listArmorySafes').mockResolvedValueOnce([SAFE]).mockResolvedValueOnce([OTHER_SAFE])
    const { client, wrapper } = queryHarness()
    client.setQueryData(['my-capabilities'], ['armory.view'])
    const { result, rerender } = renderHook(() => {
      useArmoryCacheLifecycle()
      return useArmorySafes()
    }, { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([SAFE]))
    expect(client.getQueryData(['armory', 1, 'safes'])).toEqual([SAFE])
    expect(armoryKeys.find(1, { q: 'Test' })).toEqual(['armory', 1, 'find', { q: 'Test' }])
    expect(armoryKeys.serial(2, 99)).toEqual(['armory', 2, 'serial', 99])

    access.principal = 2
    rerender()
    expect(result.current.data).toBeUndefined()
    expect(client.getQueryData(['armory', 1, 'safes'])).toBeUndefined()
    await waitFor(() => expect(result.current.data).toEqual([OTHER_SAFE]))
    expect(client.getQueryData(['armory', 2, 'safes'])).toEqual([OTHER_SAFE])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each([
    { view: false, loading: false, principal: 1 },
    { view: true, loading: true, principal: 1 },
    { view: true, loading: false, principal: null },
  ])('does not fetch or expose cached data without confirmed viewing access (%j)', overrides => {
    Object.assign(access, overrides)
    const request = vi.spyOn(api, 'listArmorySafes').mockResolvedValue([OTHER_SAFE])
    const { client, wrapper } = queryHarness()
    client.setQueryData(armoryKeys.safes(access.principal), [SAFE])
    const { result } = renderHook(useArmorySafes, { wrapper })
    expect(result.current.data).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  it('requires both capabilities for people, check drafts, count drafts and settings', async () => {
    const people = vi.spyOn(api, 'listArmoryPeople').mockResolvedValue([])
    const shiftDraft = vi.spyOn(api, 'getArmoryShiftCheckDraft').mockResolvedValue({
      safe: SAFE, snapshot_token: 'test-shift-token', expected: [],
      window: {
        time_zone: 'Asia/Dubai', shift_date: '2025-02-04', shift_kind: 'day', starts_at: '2025-02-04T06:00:00+04:00',
        ends_at: '2025-02-04T18:00:00+04:00', next_ends_at: '2025-02-05T06:00:00+04:00', grace_minutes: 15,
      },
      reconciliation: { signed_out: [], in_custody: [], in_repair: [], missing: [], lost: [], assigned_count: 0 },
    })
    const monthDraft = vi.spyOn(api, 'getArmoryMonthlyCountDraft').mockResolvedValue({ safe: SAFE, month: '2025-02', snapshot_token: 'test-month-token', items: [] })
    const settings = vi.spyOn(api, 'getArmorySettings').mockResolvedValue({
      data: { version: 1, current: { day_start: '06:00', night_start: '18:00', grace_minutes: 15, effective_on: null }, pending: null }, etag: 'test-version',
    })
    const { wrapper } = queryHarness()
    access.edit = false
    const { result, rerender } = renderHook(() => ({
      people: useArmoryPeople(PEOPLE_FILTER), shift: useArmoryShiftCheckDraft(SAFE.id),
      month: useArmoryMonthlyCountDraft(SAFE.id), settings: useArmorySettings(),
    }), { wrapper })
    for (const read of [people, shiftDraft, monthDraft, settings]) expect(read).not.toHaveBeenCalled()

    access.view = false
    access.edit = true
    rerender()
    for (const read of [people, shiftDraft, monthDraft, settings]) expect(read).not.toHaveBeenCalled()

    access.view = true
    rerender()
    expect(people).toHaveBeenCalledExactlyOnceWith(PEOPLE_FILTER)
    expect(shiftDraft).toHaveBeenCalledExactlyOnceWith(SAFE.id)
    expect(monthDraft).toHaveBeenCalledExactlyOnceWith(SAFE.id)
    expect(settings).toHaveBeenCalledExactlyOnceWith()
    await waitFor(() => expect(result.current.settings.data?.etag).toBe('test-version'))

    access.edit = false
    rerender()
    for (const read of Object.values(result.current)) expect(read.data).toBeUndefined()
  })

  it.each([401, 403])('masks and removes cached data after an HTTP %i', async status => {
    const error = new ApiError(status, `HTTP_${status}`, SERVER_DETAIL)
    vi.spyOn(api, 'listArmorySafes').mockResolvedValueOnce([SAFE]).mockRejectedValueOnce(error)
    const { client, wrapper } = queryHarness()
    const { result } = renderHook(useArmorySafes, { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([SAFE]))
    await act(async () => { await result.current.refetch() })
    await waitFor(() => {
      expect(result.current.error).toBe(error)
      expect(result.current.data).toBeUndefined()
      expect(client.getQueryData(armoryKeys.safes(1))).toBeUndefined()
    })
  })

  it('clears protected caches when the capability gate unmounts Armory after revocation', () => {
    const { client, wrapper } = queryHarness()
    client.setQueryData(['my-capabilities'], ['armory.view'])
    client.setQueryData(armoryKeys.safes(1), [SAFE])
    client.setQueryData(['unrelated'], true)
    const { unmount } = renderHook(useArmoryCacheLifecycle, { wrapper })
    client.setQueryData(['my-capabilities'], [])
    unmount()
    expect(client.getQueryData(armoryKeys.safes(1))).toBeUndefined()
    expect(client.getQueryData(['unrelated'])).toBe(true)
  })
})

describe('Armory mutations', () => {
  it('refreshes active Armory reads and invalidates every other Armory key, not unrelated domains', async () => {
    const list = vi.spyOn(api, 'listArmorySafes').mockResolvedValueOnce([SAFE]).mockResolvedValueOnce([SAFE, OTHER_SAFE])
    const create = vi.spyOn(api, 'createArmorySafe').mockResolvedValue(OTHER_SAFE)
    const { client, wrapper } = queryHarness()
    const keys = [armoryKeys.find(1, { q: 'Test' }), armoryKeys.clearance(2, 'T-0002'), armoryKeys.movements(1)]
    for (const key of keys) client.setQueryData(key, { test: true })
    client.setQueryData(['unrelated'], true)
    const { result } = renderHook(() => ({ safes: useArmorySafes(), create: useCreateArmorySafe() }), { wrapper })
    await waitFor(() => expect(result.current.safes.data).toEqual([SAFE]))
    const body = { name_en: OTHER_SAFE.name_en, name_ar: OTHER_SAFE.name_ar }
    await act(async () => { await result.current.create.mutateAsync(body) })
    expect(create).toHaveBeenCalledExactlyOnceWith(body)
    await waitFor(() => expect(result.current.safes.data).toEqual([SAFE, OTHER_SAFE]))
    expect(list).toHaveBeenCalledTimes(2)
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false)
  })
})

describe('Armory error copy and recovery', () => {
  it.each([
    [409, 'armory_serial_unavailable', {}, 'This serial is no longer available. Review the refreshed list.'],
    [404, 'armory_not_found', { resource: 'safe' }, 'The safe was not found.'],
    [404, 'armory_not_found', { resource: 'unknown_resource' }, 'The record was not found. It may have changed.'],
    [409, 'armory_unknown_conflict', {}, 'This record changed. Review the current data.'],
    [409, 'HTTP_409', {}, 'This record changed. Review the current data.'],
  ])('localizes status %i and code %s', (status, code, details, expected) => {
    expect(armoryErrorMessage(new ApiError(status, code, SERVER_DETAIL, details))).toBe(expected)
  })

  it('uses Arabic copy for mapped and fallback errors, without exposing the backend message', async () => {
    await i18n.changeLanguage('ar')
    expect(armoryErrorMessage(new ApiError(409, 'armory_duplicate_serial', SERVER_DETAIL))).toBe('هذا الرقم التسلسلي مسجّل مسبقًا.')
    expect(armoryErrorMessage(new ApiError(404, 'armory_not_found', SERVER_DETAIL, { resource: 'safe' }))).toBe('لم يُعثر على الخزنة.')
    expect(armoryErrorMessage(new ApiError(409, 'armory_unknown_conflict', SERVER_DETAIL))).toBe('تغيّر هذا السجل. راجع البيانات الحالية.')
    expect(armoryErrorMessage(new ApiError(401, 'HTTP_401', SERVER_DETAIL))).toBe(i18n.t('errors.generic'))
    expect(armoryErrorMessage(new ApiError(403, 'HTTP_403', SERVER_DETAIL))).toBe(i18n.t('common.forbiddenError'))
    expect(armoryErrorMessage(new ApiError(500, 'armory_unknown_error', SERVER_DETAIL))).toBe(i18n.t('errors.generic'))
    expect(armoryErrorMessage(new ApiError(500, 'armory_unknown_error', SERVER_DETAIL))).not.toContain(SERVER_DETAIL)
  })

  it.each([
    [409, 'armory_duplicate_serial', 'refresh'],
    [409, 'armory_insufficient_stock', 'refresh'],
    [409, 'armory_stale_return', 'revalidate'],
    [422, 'armory_course_required', 'revalidate'],
    [422, 'armory_self_issue', 'revalidate'],
    [409, 'armory_stale_check', 'redraft'],
    [409, 'armory_stale_count', 'redraft'],
    [409, 'armory_already_decided', 'redraft'],
    [412, 'armory_version_mismatch', 'reload'],
    [409, 'armory_duplicate_item', 'none'],
    [409, 'armory_unknown_conflict', 'none'],
    [409, 'constructor', 'none'],
  ])('maps status %i and code %s to %s recovery', (status, code, recovery) => {
    expect(armoryErrorRecovery(new ApiError(status, code, SERVER_DETAIL))).toBe(recovery)
  })
})
