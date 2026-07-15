/**
 * DirectEmployeesField — pick employees (by G-number or name) as direct
 * (private-chat) recipients for a Send-to-Group announcement. Multi-select,
 * no cap; employees without a usable mobile are shown disabled.
 * Search reuses the same employee query as EmployeeMentionField.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import { mentionDigits } from './mention'

export interface DirectEmployee {
  id: string
  name_en: string | null
  name_ar: string | null
  contact: string | null
}

export function DirectEmployeesField({
  selected,
  onAdd,
  onRemove,
}: {
  selected: DirectEmployee[]
  onAdd: (emp: DirectEmployee) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [q, setQ] = useState('')
  const ar = i18n.language.startsWith('ar')

  const empQuery = useQuery({
    queryKey: ['announce-direct-employees', q],
    queryFn: () => api.listEmployees({ q, limit: 6 }),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  })

  const selectedIds = new Set(selected.map((e) => e.id))
  const localName = (e: { id: string; name_en: string | null; name_ar?: string | null }): string =>
    (ar ? e.name_ar : e.name_en) || e.name_en || e.name_ar || e.id

  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <p className="mb-2 text-[0.9em] font-semibold text-foreground">
        {t('sendToGroup.direct.title')}
      </p>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('sendToGroup.direct.searchPlaceholder')}
        aria-label={t('sendToGroup.direct.searchPlaceholder')}
        dir="auto"
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[0.85em] text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />

      {q.trim().length > 0 && (
        <ul className="mt-1 space-y-1">
          {(empQuery.data?.items ?? [])
            .filter((emp) => !selectedIds.has(emp.id))
            .map((emp) => {
              const usable = !!emp.contact && mentionDigits(emp.contact) !== ''
              return (
                <li key={emp.id}>
                  <button
                    type="button"
                    disabled={!usable}
                    onClick={() => {
                      onAdd({
                        id: emp.id,
                        name_en: emp.name_en,
                        name_ar: emp.name_ar,
                        contact: emp.contact ?? null,
                      })
                      setQ('')
                    }}
                    className="w-full rounded-md border border-border px-3 py-1.5 text-start text-[0.82em] hover:bg-surface-tinted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span dir="auto" className="text-foreground">{localName(emp)}</span>
                    <span className="ms-1 text-muted-foreground">({emp.id})</span>
                    {!usable && (
                      <span className="ms-1 text-[0.75em] text-muted-foreground">
                        {t('sendToGroup.direct.noMobile')}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          {empQuery.data && empQuery.data.items.length === 0 && (
            <li className="px-3 py-2 text-[0.82em] text-muted-foreground" dir="auto">
              {t('sendToGroup.direct.noResults')}
            </li>
          )}
        </ul>
      )}

      {selected.length === 0 ? (
        <p className="mt-2 text-[0.78em] text-muted-foreground" dir="auto">
          {t('sendToGroup.direct.empty')}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {selected.map((emp) => (
            <li
              key={emp.id}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[0.85em] text-foreground" dir="auto">
                {localName(emp)}
                <span className="ms-1 text-muted-foreground">({emp.id})</span>
              </span>
              <button
                type="button"
                aria-label={t('sendToGroup.direct.remove', { name: localName(emp) })}
                onClick={() => onRemove(emp.id)}
                className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-accent/10 hover:text-accent"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
