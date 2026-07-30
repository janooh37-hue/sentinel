/**
 * serviceLabels — rail and row labels come from _fields.json via /templates,
 * not from locale keys. The Arabic assertions are the point: an English-only
 * assertion cannot catch an AR leak when the English label equals the key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

import { OTHER_SERVICE_ID, serviceGlyph, useServiceLabel } from './serviceLabels'

// Mutable language so one file can assert both EN and AR (vi.mock is hoisted,
// so the holder must be created with vi.hoisted).
const i18nState = vi.hoisted(() => ({ lang: 'en' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      k === 'books.formKind.other'
        ? i18nState.lang === 'ar'
          ? 'سجلات أخرى'
          : 'Other records'
        : k,
    i18n: { language: i18nState.lang },
  }),
}))

const TEMPLATES = {
  items: [
    { id: 'Report', name_en: 'Report', name_ar: 'تقرير' },
    { id: 'Warning Form', name_en: 'Warning Form', name_ar: 'إنذار' },
  ],
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

function labelFn(): (serviceId: string) => string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['templates'], TEMPLATES)
  return renderHook(() => useServiceLabel(), { wrapper: wrapperFor(qc) }).result.current
}

beforeEach(() => {
  i18nState.lang = 'en'
})

describe('serviceGlyph', () => {
  it('uses the Services-tile glyph for a real service', () => {
    expect(serviceGlyph('Report')).toBe('📊')
    expect(serviceGlyph('Warning Form')).toBe('⚠️')
  })

  it('falls back to a generic doc for Other', () => {
    expect(serviceGlyph(OTHER_SERVICE_ID)).toBe('📄')
  })
})

describe('useServiceLabel', () => {
  it('returns the English name under lng=en', () => {
    expect(labelFn()('Report')).toBe('Report')
  })

  it('returns the ARABIC name under lng=ar', () => {
    i18nState.lang = 'ar'
    const label = labelFn()
    expect(label('Report')).toBe('تقرير')
    expect(label('Warning Form')).toBe('إنذار')
  })

  it('localises the Other label', () => {
    i18nState.lang = 'ar'
    expect(labelFn()(OTHER_SERVICE_ID)).toBe('سجلات أخرى')
  })

  it('falls back to the raw id for an unknown service', () => {
    expect(labelFn()('Ghost Form')).toBe('Ghost Form')
  })

  it('falls back to the raw id before the templates query resolves', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useServiceLabel(), { wrapper: wrapperFor(qc) })
    expect(result.current('Report')).toBe('Report')
  })
})
