/**
 * EmployeeMentionField — search an employee and insert into the announcement
 * message in one of two modes:
 *
 *   tag   (default) — inserts "@Name " and hands the parent a MentionTarget so
 *                     the send becomes a real WhatsApp @mention. Disabled for
 *                     employees whose contact number is unknown.
 *   plain           — inserts "Name (G-number[, designation])" as plain text
 *                     (the original behaviour). Designation checkbox only
 *                     visible in this mode.
 *
 * buildMention lives in ./mention.ts; MentionTarget is exported from there too.
 * Localizes name/designation to the active UI language (Arabic uses the Arabic
 * comma between name and designation).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import { buildMention } from './mention'
import type { MentionTarget } from './mention'

type MentionMode = 'tag' | 'plain'

export function EmployeeMentionField({
  onInsert,
}: {
  onInsert: (text: string, mention?: MentionTarget) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [q, setQ] = useState('')
  const [includeDesignation, setIncludeDesignation] = useState(false)
  const [mode, setMode] = useState<MentionMode>('tag')

  const empQuery = useQuery({
    queryKey: ['announce-mention-employees', q],
    queryFn: () => api.listEmployees({ q, limit: 6 }),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  })

  const ar = i18n.language.startsWith('ar')

  return (
    <div className="mt-3">
      {/* Mode switch */}
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[0.82em] text-muted-foreground">{t('sendToGroup.mention.label')}</span>
        <div className="ms-auto inline-flex rounded-full border border-border bg-surface p-0.5">
          {(['tag', 'plain'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-full px-2.5 py-1 text-[0.78em] font-semibold transition-colors ${
                mode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(m === 'tag' ? 'sendToGroup.mention.modeTag' : 'sendToGroup.mention.modePlain')}
            </button>
          ))}
        </div>
      </div>

      {/* Mode hint */}
      <p className="mb-1 text-[0.78em] text-muted-foreground">
        {t('sendToGroup.mention.modeHint')}
      </p>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('sendToGroup.mention.searchPlaceholder')}
        dir="auto"
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[0.85em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />

      {/* Designation checkbox — plain mode only */}
      {mode === 'plain' && (
        <label className="mt-1.5 flex w-fit items-center gap-2 text-[0.8em] text-muted-foreground">
          <input
            type="checkbox"
            checked={includeDesignation}
            onChange={(e) => setIncludeDesignation(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          {t('sendToGroup.mention.includeDesignation')}
        </label>
      )}

      {q.trim().length > 0 && (
        <ul className="mt-1 space-y-1">
          {(empQuery.data?.items ?? []).map((emp) => {
            const name = (ar ? emp.name_ar : emp.name_en) || emp.name_en || emp.name_ar || emp.id
            const noNumber = mode === 'tag' && !emp.contact

            return (
              <li key={emp.id}>
                <button
                  type="button"
                  disabled={noNumber}
                  onClick={() => {
                    if (mode === 'tag' && emp.contact) {
                      onInsert(`@${name} `, { name, number: emp.contact })
                    } else if (mode === 'plain') {
                      onInsert(buildMention(emp, i18n.language, includeDesignation), undefined)
                    }
                    setQ('')
                  }}
                  className="w-full rounded-md border border-border px-3 py-1.5 text-start text-[0.82em] hover:bg-surface-tinted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span dir="auto" className="text-foreground">
                    {(ar ? emp.name_ar : emp.name_en) || emp.name_en}
                  </span>
                  <span className="ms-1 text-muted-foreground">({emp.id})</span>
                  {noNumber && (
                    <span className="ms-1 text-[0.75em] text-muted-foreground">
                      {t('sendToGroup.mention.noNumber')}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
          {empQuery.data && empQuery.data.items.length === 0 && (
            <li className="px-3 py-2 text-[0.82em] text-muted-foreground" dir="auto">
              {t('sendToGroup.mention.noResults')}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
