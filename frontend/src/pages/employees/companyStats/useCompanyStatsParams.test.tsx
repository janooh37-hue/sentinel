import { act, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { useCompanyStatsParams } from './useCompanyStatsParams'

function renderParams(search = '') {
  return renderHook(() => ({ params: useCompanyStatsParams('2026-11-20'), search: useLocation().search }), {
    wrapper: ({ children }: PropsWithChildren) => (
      <MemoryRouter initialEntries={[`/employees/company-stats${search}`]}>{children}</MemoryRouter>
    ),
  })
}

describe('useCompanyStatsParams', () => {
  it('defaults to three months ending on the last closed Dubai date', () => {
    const { result } = renderParams()

    expect(result.current.params).toMatchObject({
      preset: '3m', range: { from: '2026-08-21', to: '2026-11-19' },
      company: null, unit: 'days', trend: 'absence', sort: 'score',
    })
    expect(result.current.search).toBe('')
  })

  it('canonicalises invalid filter values and stray dates without losing unrelated params', () => {
    const { result } = renderParams('?period=year&unit=hours&trend=salary&sort=name&from=2026-09-01&to=2026-10-01&company=%20&keep=1')

    expect(result.current.params).toMatchObject({ preset: '3m', company: null, unit: 'days', trend: 'absence', sort: 'score' })
    expect(result.current.search).toBe('?keep=1')
  })

  it('keeps an explicit custom range and Unassigned scope in a deep link', () => {
    const { result } = renderParams('?period=custom&from=2026-10-01&to=2026-10-15&company=__unassigned__')

    expect(result.current.params).toMatchObject({
      preset: 'custom', range: { from: '2026-10-01', to: '2026-10-15' }, company: '__unassigned__',
    })

    act(() => result.current.params.update({ preset: '1m' }))
    expect(result.current.params.range).toEqual({ from: '2026-10-21', to: '2026-11-19' })
    expect(result.current.search).toBe('?period=1m&company=__unassigned__')
  })

  it.each([
    'from=2026-02-30&to=2026-03-01',
    'from=2026-11-18&to=2026-11-01',
    'from=2024-08-20&to=2026-11-19',
    'from=2026-11-20&to=2026-11-21',
    'from=2026-09-01',
  ])('repairs an invalid custom range (%s) without leaving custom mode', (dates) => {
    const { result } = renderParams(`?period=custom&${dates}`)

    expect(result.current.params.preset).toBe('custom')
    expect(result.current.params.range).toEqual({ from: '2026-08-21', to: '2026-11-19' })
    const search = new URLSearchParams(result.current.search)
    expect(search.get('from')).toBe('2026-08-21')
    expect(search.get('to')).toBe('2026-11-19')
  })

  it('preserves a requested future end that the API can clamp to a closed date', () => {
    const { result } = renderParams('?period=custom&from=2026-11-01&to=2026-12-01')

    expect(result.current.params.range).toEqual({ from: '2026-11-01', to: '2026-12-01' })
  })

  it('merges consecutive patches before React Router commits the next render', () => {
    const { result } = renderParams('?period=1m')
    const update = result.current.params.update

    act(() => {
      update({ preset: 'custom' })
      update({ to: '2026-11-01', company: 'السرية الأولى' })
      update({ unit: 'count', trend: 'late', sort: 'single_punch' })
    })

    expect(result.current.params).toMatchObject({
      preset: 'custom', range: { from: '2026-10-21', to: '2026-11-01' },
      company: 'السرية الأولى', unit: 'count', trend: 'late', sort: 'single_punch',
    })
    expect(new URLSearchParams(result.current.search).get('company')).toBe('السرية الأولى')
  })
})
