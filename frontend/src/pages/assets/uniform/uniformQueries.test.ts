import { createElement, type PropsWithChildren } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '@/lib/api'
import i18n from '@/lib/i18n'
import {
  invalidateUniformQueries, uniformErrorMessage, uniformKeys,
  useCreateUniformIssue, useUniformEmployee,
} from './uniformQueries'

afterEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children)
  return { client, wrapper }
}

describe('Uniform query cache', () => {
  it('invalidates every uniform projection without invalidating other asset caches', async () => {
    const { client } = setup()
    const keys = [uniformKeys.items(), uniformKeys.items(true), uniformKeys.receipts,
      uniformKeys.issues(), uniformKeys.issues('G1'), uniformKeys.returns('G1'),
      uniformKeys.adjustments, uniformKeys.recipients('Ali'), uniformKeys.employee('G1'), uniformKeys.summary]
    for (const key of keys) client.setQueryData(key, [])
    client.setQueryData(['store', 'items'], [])
    await invalidateUniformQueries(client)
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryState(['store', 'items'])?.isInvalidated).toBe(false)
    client.clear()
  })

  it('refreshes cached holdings after a successful hand-out but not a rejected hand-out', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(uniformKeys.employee('G1'), { holdings: [] })
    const request = vi.spyOn(api, 'createUniformIssue').mockRejectedValueOnce(new ApiError(409, 'uniform_insufficient_stock', 'Shortage'))
    const { result, unmount } = renderHook(() => useCreateUniformIssue(), { wrapper })
    const body = { employee_id: 'G1', lines: [{ item_id: 1, size_id: 2, qty: 1 }] }
    await act(async () => { await expect(result.current.mutateAsync(body)).rejects.toBeInstanceOf(ApiError) })
    expect(client.getQueryState(uniformKeys.employee('G1'))?.isInvalidated).toBe(false)
    request.mockReset().mockResolvedValueOnce({ id: 1, employee_id: 'G1', issued_on: '2026-11-04', note: null, created_by_id: 1, created_at: '2026-11-04', voided_at: null, voided_by_id: null, void_reason: null, lines: body.lines })
    await act(async () => { await result.current.mutateAsync(body) })
    expect(client.getQueryState(uniformKeys.employee('G1'))?.isInvalidated).toBe(true)
    unmount()
    client.clear()
  })

  it('does not request employee holdings until an employee is selected', async () => {
    const { client, wrapper } = setup()
    const request = vi.spyOn(api, 'getUniformEmployee').mockResolvedValue({ holdings: [], issues: [], returns: [] })
    const { result, rerender, unmount } = renderHook(({ id }) => useUniformEmployee(id), { initialProps: { id: '' }, wrapper })
    expect(request).not.toHaveBeenCalled()
    rerender({ id: 'G1' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(request).toHaveBeenCalledWith('G1')
    unmount()
    client.clear()
  })
})

describe('uniformErrorMessage', () => {
  it.each(['en', 'ar'])('maps drawing, stock and version conflicts in %s', async language => {
    await i18n.changeLanguage(language)
    for (const [status, code, key] of [
      [409, 'uniform_drawing_in_use', 'drawingInUse'],
      [409, 'uniform_insufficient_stock', 'insufficientStock'],
      [412, 'uniform_version_conflict', 'versionConflict'],
    ] as const) {
      const message = uniformErrorMessage(new ApiError(status, code, 'Server detail'))
      expect(message).toBe(i18n.t(`assets.uniform.errors.${key}`))
      expect(message).not.toBe('Server detail')
      expect(message).not.toContain('assets.uniform.')
    }
  })

  it('limits status fallbacks to unknown Uniform conflict codes', async () => {
    await i18n.changeLanguage('en')
    expect(uniformErrorMessage(new ApiError(409, 'uniform_new_conflict', 'detail'))).toBe(i18n.t('assets.uniform.errors.conflict'))
    expect(uniformErrorMessage(new ApiError(412, 'uniform_new_version', 'detail'))).toBe(i18n.t('assets.uniform.errors.versionConflict'))
    expect(uniformErrorMessage(new ApiError(422, 'uniform_unknown_validation', 'Validation detail'))).toBe('Validation detail')
    expect(uniformErrorMessage(new ApiError(409, 'STORE_CONFLICT', 'Store detail'))).toBe('Store detail')
    expect(uniformErrorMessage(new ApiError(403, 'FORBIDDEN', 'Denied'))).toBe(i18n.t('common.forbiddenError'))
    expect(uniformErrorMessage(new TypeError('fetch failed'))).toBe(i18n.t('errors.network'))
    expect(uniformErrorMessage(null)).toBe(i18n.t('errors.generic'))
  })
})
