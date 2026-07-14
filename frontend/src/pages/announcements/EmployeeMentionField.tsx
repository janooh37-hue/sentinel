/**
 * EmployeeMentionField — search an employee and insert a note (name + G-number,
 * optionally the designation) into the announcement message. Insertion is plain
 * text the operator can edit; there is no structured backend field.
 *
 * buildMention is exported and pure so the formatting is unit-tested directly.
 * Localizes name/designation to the active UI language (Arabic uses the Arabic
 * comma between name and designation).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api, type EmployeeListItem } from '@/lib/api'

export function buildMention(
  emp: EmployeeListItem,
  lang: string,
  includeDesignation: boolean,
): string {
  const ar = lang.startsWith('ar')
  const name = (ar ? emp.name_ar : emp.name_en) || emp.name_en || emp.name_ar || emp.id
  let out = `${name} (${emp.id})`
  if (includeDesignation) {
    const desig = (ar ? emp.position_ar : emp.position) || emp.position || emp.position_ar
    if (desig) out += ar ? `، ${desig}` : `, ${desig}`
  }
  return out
}

export function EmployeeMentionField({
  onInsert,
}: {
  onInsert: (text: string) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [q, setQ] = useState('')
  const [includeDesignation, setIncludeDesignation] = useState(false)

  const empQuery = useQuery({
    queryKey: ['announce-mention-employees', q],
    queryFn: () => api.listEmployees({ q, limit: 6 }),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  })

  const ar = i18n.language.startsWith('ar')

  return (
    <div className="mt-3">
      <label className="mb-1 block text-[0.82em] text-muted-foreground">
        {t('sendToGroup.mention.label')}
      </label>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('sendToGroup.mention.searchPlaceholder')}
        dir="auto"
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[0.85em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
      <label className="mt-1.5 flex w-fit items-center gap-2 text-[0.8em] text-muted-foreground">
        <input
          type="checkbox"
          checked={includeDesignation}
          onChange={(e) => setIncludeDesignation(e.target.checked)}
          className="h-3.5 w-3.5 accent-primary"
        />
        {t('sendToGroup.mention.includeDesignation')}
      </label>
      {q.trim().length > 0 && (
        <ul className="mt-1 space-y-1">
          {(empQuery.data?.items ?? []).map((emp) => (
            <li key={emp.id}>
              <button
                type="button"
                onClick={() => {
                  onInsert(buildMention(emp, i18n.language, includeDesignation))
                  setQ('')
                }}
                className="w-full rounded-md border border-border px-3 py-1.5 text-start text-[0.82em] hover:bg-surface-tinted"
              >
                <span dir="auto" className="text-foreground">
                  {(ar ? emp.name_ar : emp.name_en) || emp.name_en}
                </span>
                <span className="ms-1 text-muted-foreground">({emp.id})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
