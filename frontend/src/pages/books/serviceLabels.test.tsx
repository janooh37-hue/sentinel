/**
 * serviceLabels — rail and row labels come from _fields.json via /templates,
 * not from locale keys. The Arabic assertions are the point: an English-only
 * assertion cannot catch an AR leak when the English label equals the key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

import { api } from '@/lib/api'
import { OTHER_SERVICE_ID, serviceGlyph, useServiceLabel } from './serviceLabels'

// Mutable language so one file can assert both EN and AR (vi.mock is hoisted,
// so the holder must be created with vi.hoisted).
const i18nState = vi.hoisted(() => ({ lang: 'en' }))

// Real strings for the two keys this module actually renders, so a leak
// (English text under lng=ar) shows up as a failing assertion, not a
// same-for-both-languages passthrough key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => {
      if (k === 'books.formKind.other') return i18nState.lang === 'ar' ? 'سجلات أخرى' : 'Other records'
      if (k === 'books.record.loading') return i18nState.lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'
      return k
    },
    i18n: { language: i18nState.lang },
  }),
}))

vi.mock('@/lib/api', () => ({ api: { listTemplates: vi.fn() } }))

// Extra TemplateMeta fields (form_number/category/signing_path/has_code) are
// irrelevant to serviceLabels but required for api.listTemplates' real return
// type, since this fixture now also backs a typed mockResolvedValue below.
function tpl(id: string, name_en: string, name_ar: string) {
  return { id, name_en, name_ar, form_number: '', category: 'personnel' as const, signing_path: 'auto' as const, has_code: false }
}

const TEMPLATES = {
  items: [
    tpl('Report', 'Report', 'تقرير'),
    tpl('Warning Form', 'Warning Form', 'إنذار'),
    // Latent leak fixture: a real, known template whose Arabic name is
    // unset. id deliberately differs from name_en so a fallback to either
    // one is distinguishable in assertions below. Must not fall back to
    // the English name under lng=ar.
    tpl('blank-ar-id', 'Blank AR Form (EN)', ''),
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
  vi.mocked(api.listTemplates).mockReset().mockResolvedValue(TEMPLATES)
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

  it('renders the loading placeholder, not the raw id, before the templates query resolves (EN)', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useServiceLabel(), { wrapper: wrapperFor(qc) })
    expect(result.current('Report')).toBe('Loading…')
  })

  it('does NOT render the English id while the templates query is pending, under lng=ar', () => {
    i18nState.lang = 'ar'
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useServiceLabel(), { wrapper: wrapperFor(qc) })
    const label = result.current('Report')
    expect(label).not.toBe('Report')
    expect(label).toBe('جارٍ التحميل…')
  })

  it('does NOT render the English id once the templates query has errored, under lng=ar', async () => {
    i18nState.lang = 'ar'
    vi.mocked(api.listTemplates).mockReset().mockRejectedValue(new Error('network down'))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useServiceLabel(), { wrapper: wrapperFor(qc) })
    await waitFor(() => expect(qc.getQueryState(['templates'])?.status).toBe('error'))
    const label = result.current('Report')
    expect(label).not.toBe('Report')
    expect(label).toBe('جارٍ التحميل…')
  })

  it('still renders the Arabic name once resolved (regression guard)', () => {
    i18nState.lang = 'ar'
    expect(labelFn()('Report')).toBe('تقرير')
  })

  it('does NOT fall back to the English name when name_ar is empty, under lng=ar', () => {
    i18nState.lang = 'ar'
    const label = labelFn()('blank-ar-id')
    expect(label).not.toBe('Blank AR Form (EN)') // the EN-name leak this guards against
    expect(label).toBe('blank-ar-id') // falls to the raw id instead
  })
})
