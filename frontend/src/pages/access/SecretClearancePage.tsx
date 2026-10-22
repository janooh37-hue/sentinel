/**
 * SecretClearancePage — admins and managers grant or remove the per-user
 * "Secret clearance" (`books.secret`). Toggles apply immediately (no confirm)
 * and roll back if the server refuses. Admins are always cleared (locked) and
 * nobody edits their own clearance; the backend enforces both.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'

import { NotifyEmployeeToggle } from '@/components/notify/NotifyEmployeeToggle'
import { Input } from '@/components/ui/input'
import { api, apiErrorMessage, type SecretClearanceRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'

const KEY = ['secret-clearance'] as const

export function SecretClearancePage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const isAr = i18n.language.startsWith('ar')

  const listQuery = useQuery({ queryKey: KEY, queryFn: () => api.listSecretClearance() })

  const toggle = useMutation({
    mutationFn: ({ userId, enabled }: { userId: number; enabled: boolean }) =>
      api.setSecretClearance(userId, enabled),
    onMutate: async ({ userId, enabled }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const previous = qc.getQueryData<SecretClearanceRead[]>(KEY)
      qc.setQueryData<SecretClearanceRead[]>(KEY, (rows) =>
        rows?.map((row) => (row.user_id === userId ? { ...row, cleared: enabled } : row)),
      )
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(KEY, context.previous)
      toast.error(apiErrorMessage(err))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  })

  const nameOf = (row: SecretClearanceRead): string =>
    (isAr && row.name_ar?.trim() ? row.name_ar : row.name) || '—'

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = listQuery.data ?? []
    if (!needle) return all
    return all.filter((row) =>
      [row.name, row.name_ar, row.g_number].some((v) => v?.toLowerCase().includes(needle)),
    )
  }, [listQuery.data, query])

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[860px] flex-1 px-4 pb-10 pt-4 md:px-8 md:pt-6">
        <header className="mb-5">
          <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('access.eyebrow')}
          </div>
          <h1 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
            {t('access.secretClearance.title')}
          </h1>
          <p className="mt-1 text-[0.86em] text-muted-foreground">
            {t('access.secretClearance.description')}
          </p>
        </header>

        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('access.secretClearance.search')}
          aria-label={t('access.secretClearance.search')}
          className="mb-4 h-11"
        />

        {listQuery.isLoading ? (
          <p className="text-[0.86em] text-muted-foreground">{t('common.loading')}</p>
        ) : listQuery.isError ? (
          <p role="alert" className="text-[0.86em] text-accent">
            {apiErrorMessage(listQuery.error)}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[0.86em] text-muted-foreground">{t('access.secretClearance.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const self = row.user_id === user?.id
              const hint = row.locked
                ? t('access.secretClearance.lockedAdmin')
                : self
                  ? t('access.secretClearance.self')
                  : [row.g_number, t(`access.roleName.${row.role}`, { defaultValue: row.role })]
                      .filter(Boolean)
                      .join(' · ')
              return (
                <li key={row.user_id}>
                  <NotifyEmployeeToggle
                    checked={row.cleared}
                    disabled={row.locked || self}
                    onChange={(enabled) => toggle.mutate({ userId: row.user_id, enabled })}
                    label={nameOf(row)}
                    hint={hint}
                    className="bg-surface"
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
