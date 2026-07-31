/**
 * Service labels + glyphs for the Records rail, row badges and mobile filter.
 *
 * A record's service is decided by the backend (BookRead.service_id) — this
 * module only renders it. Names come from `_fields.json` via the already-cached
 * `/templates` query, so adding a form to TEMPLATE_FILES gives it a rail entry
 * with correct EN/AR names and no locale-file edit. Glyphs reuse the Services
 * gallery lookup so the two surfaces never drift.
 */
import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { BookFacetsResponse } from '@/lib/api'
import { api } from '@/lib/api'
import { emojiForTemplate } from '@/pages/application/formEmoji'
import type { RailItem } from './FormRail'
import type { SpineState } from './StatusSpine'

/** Mirrors app.core.form_kind.OTHER_SERVICE_ID. */
export const OTHER_SERVICE_ID = 'other'

const OTHER_GLYPH = '📄'

export function serviceGlyph(serviceId: string): string {
  return serviceId === OTHER_SERVICE_ID ? OTHER_GLYPH : emojiForTemplate(serviceId)
}

/**
 * `(serviceId) => localized label`. Shares the `['templates']` query key with
 * the Services gallery, so this costs no extra request in practice.
 */
export function useServiceLabel(): (serviceId: string) => string {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { data } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.listTemplates(),
    staleTime: Infinity,
  })
  return useCallback(
    (serviceId: string): string => {
      if (serviceId === OTHER_SERVICE_ID) return t('books.formKind.other')
      // No templates yet (pending or errored `data`) means no name in ANY
      // language — rendering the raw (English) id would leak into the AR UI.
      if (!data) return t('books.record.loading')
      const tpl = data.items.find((x) => x.id === serviceId)
      if (!tpl) return serviceId
      // Never cross-fall to the other language's name: an empty name_ar must
      // not resolve to the English name under an Arabic UI.
      return (isAr ? tpl.name_ar : tpl.name_en) || serviceId
    },
    [data, isAr, t],
  )
}

/** Rail entries: "All" first, then the payload's own order (TEMPLATE_FILES,
 *  "other" last, empties already omitted server-side). */
export function railItemsFrom(
  facets: BookFacetsResponse | undefined,
  allLabel: string,
  label: (serviceId: string) => string,
): RailItem[] {
  if (!facets) return []
  return [
    { serviceId: 'all', glyph: '🗂', label: allLabel, count: facets.total, states: [] },
    ...facets.services.map((s) => ({
      serviceId: s.id,
      glyph: serviceGlyph(s.id),
      label: label(s.id),
      count: s.count,
      // Mini-dots: the non-draft states actually present in this service.
      states: Object.entries(s.states)
        .filter(([state, n]) => state !== 'none' && n > 0)
        .map(([state]) => state),
    })),
  ]
}

/**
 * Records header subtitle — ONE decision both the desktop and mobile headers
 * render, so they can't diverge (that's how the mobile header missed the
 * facets-error case in the first place: two hand-copied ternaries instead of
 * one). Loading (either query) wins over error; error wins over the real count.
 */
export function bookHeaderText(
  status: { listPending: boolean; facetsPending: boolean; facetsError: boolean; total: number },
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (status.listPending || status.facetsPending) return t('books.subtitle')
  if (status.facetsError) return t('common.loadError')
  return t('books.pageMeta', { total: status.total })
}

/** Status-spine counts, scoped to the selected service ('all' = office-wide). */
export function spineCountsFrom(
  facets: BookFacetsResponse | undefined,
  railService: string,
): Record<SpineState, number> {
  const scope =
    railService === 'all'
      ? { count: facets?.total ?? 0, states: facets?.states ?? {} }
      : (facets?.services.find((s) => s.id === railService) ?? { count: 0, states: {} })
  const n = (k: string): number => scope.states[k] ?? 0
  return {
    all: scope.count,
    none: n('none'),
    pending: n('pending'),
    awaiting_scan: n('awaiting_scan'),
    returned: n('returned'),
    approved: n('approved'),
    rejected: n('rejected'),
  }
}
