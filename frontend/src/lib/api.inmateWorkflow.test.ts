import { afterEach, expect, it, vi } from 'vitest'

import { api } from './api'

afterEach(() => vi.unstubAllGlobals())

it('pins a selected report export to its submission while preserving scope and language', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new Blob(['xlsx'])))
  vi.stubGlobal('fetch', fetch)
  await api.fetchInmateRegisterExport(
    { year: 2026, month: 8, submission_id: 42, language: 'ar', populations: ['citizens', 'expats'] },
    'report.xlsx',
  )
  const url = new URL(String(fetch.mock.calls[0]?.[0]), 'http://localhost')
  expect(url.searchParams.get('submission_id')).toBe('42')
  expect(url.searchParams.getAll('populations')).toEqual(['citizens', 'expats'])
  expect(url.searchParams.get('language')).toBe('ar')
})

it('exposes a stale approval conflict with server details to the workflow caller', async () => {
  const error = {
    code: 'INMATE_REGISTER_STALE_PROJECTION',
    message: 'Prepare again',
    details: { submission_id: 42 },
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  })))
  await expect(api.approveInmateRegisterMonth(
    { year: 2026, month: 8 },
    { expected_version: 2, submission_id: 42 },
  )).rejects.toMatchObject({ status: 409, ...error })
})
