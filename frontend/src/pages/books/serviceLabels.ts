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

import { api } from '@/lib/api'
import { emojiForTemplate } from '@/pages/application/formEmoji'

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
      const tpl = data?.items.find((x) => x.id === serviceId)
      if (!tpl) return serviceId
      return (isAr ? tpl.name_ar : tpl.name_en) || tpl.name_en || serviceId
    },
    [data, isAr, t],
  )
}
