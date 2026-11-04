import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, type EmployeeLookupItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { uniformKeys } from './uniformQueries'

export type UniformEmployee = Pick<EmployeeLookupItem, 'id' | 'name_en' | 'name_ar'>

interface Props {
  value: UniformEmployee | null
  onChange: (employee: UniformEmployee | null) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  disabled?: boolean
  recipientsOnly?: boolean
}

/** Shared identity picker; returns can restrict the lookup to current holders. */
export function EmployeeSearch({ value, onChange, inputRef, disabled = false, recipientsOnly = false }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [query, setQuery] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const debounced = useDebouncedValue(query, 250).trim()
  const employees = useQuery({
    queryKey: ['uniform-employee-lookup', debounced],
    queryFn: () => api.lookupEmployees({ q: debounced, limit: 8 }),
    enabled: !recipientsOnly && !disabled && !value && debounced.length > 0,
    staleTime: 30_000,
  })
  const recipients = useQuery({
    queryKey: uniformKeys.recipients(debounced),
    queryFn: () => api.listUniformRecipients(debounced),
    enabled: recipientsOnly && !disabled && !value && debounced.length > 0,
  })
  const allRecipients = useQuery({
    queryKey: uniformKeys.recipients(''),
    queryFn: () => api.listUniformRecipients(''),
    enabled: recipientsOnly && !disabled && !value,
  })
  const results = recipientsOnly ? recipients : employees
  const matches = recipientsOnly
    ? (recipients.data ?? []).filter(row => row.held_total > 0).slice(0, 8).map(row => ({ id: row.employee_id, name_en: row.name_en, name_ar: row.name_ar }))
    : employees.data?.items ?? []
  const nobody = recipientsOnly && allRecipients.isSuccess && !allRecipients.data.some(row => row.held_total > 0)
  const label = t(recipientsOnly ? 'assets.uniform.returnedBy' : 'assets.uniform.takenBy')
  const showResults = !value && !dismissed && !!query.trim() && query.trim() === debounced
  function choose(employee: UniformEmployee) {
    setQuery('')
    onChange(employee)
  }
  function dismiss(event: React.KeyboardEvent) {
    event.preventDefault()
    event.stopPropagation()
    setDismissed(true)
    ref.current?.focus()
  }
  return <section className="min-w-0 space-y-2">
    {value ? <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised p-3">
      <div className="min-w-0">{recipientsOnly && <p className="text-xs text-muted-foreground">{label}</p>}<p className="break-words font-semibold" dir="auto">{pickEmployeeName(value, i18n.language)}</p><bdi dir="ltr" className="text-sm text-muted-foreground">{value.id}</bdi></div>
      <Button type="button" variant="secondary" className="min-h-11" disabled={disabled} onClick={() => { onChange(null); setQuery(''); setDismissed(false); requestAnimationFrame(() => ref.current?.focus()) }}>{t('assets.uniform.change')}</Button>
    </div> : <>
      <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
      <Input ref={ref} id={id} type="search" role="searchbox" dir="auto" autoComplete="off" disabled={disabled} placeholder={t('assets.uniform.pickerPh')} value={query}
        className="min-h-11"
        onChange={event => { setQuery(event.target.value); setDismissed(false) }}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (showResults && !results.isPending && !results.isError && matches.length === 1) choose(matches[0])
          } else if (event.key === 'ArrowDown' && showResults) { event.preventDefault(); resultRefs.current[0]?.focus() }
          else if (event.key === 'Escape' && showResults) dismiss(event)
        }} />
      {nobody && <p className="text-sm text-muted-foreground">{t('assets.uniform.returnEmpty')}</p>}
      {showResults && <ul id={`${id}-results`} className="overflow-hidden rounded-md border border-border">
        {results.isPending && <li role="status" className="p-3 text-sm text-muted-foreground">{t('assets.uniform.loading')}</li>}
        {results.isError && <li className="flex flex-wrap items-center gap-2 p-3"><span role="alert" className="text-sm text-destructive-text">{t('assets.uniform.lookupError')}</span><Button type="button" variant="ghost" className="min-h-11" onClick={() => void results.refetch()}>{t('assets.uniform.retry')}</Button></li>}
        {!results.isPending && !results.isError && matches.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t('assets.uniform.pickerEmpty')}</li>}
        {!results.isError && matches.map((employee, index) => <li key={employee.id} className="border-b border-hairline last:border-0">
          <button type="button" ref={button => { resultRefs.current[index] = button }} disabled={disabled} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => choose(employee)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); resultRefs.current[Math.min(matches.length - 1, index + 1)]?.focus() }
              else if (event.key === 'ArrowUp') { event.preventDefault(); if (index === 0) ref.current?.focus(); else resultRefs.current[index - 1]?.focus() }
              else if (event.key === 'Escape') dismiss(event)
            }}>
            <span dir="auto" className="font-medium">{pickEmployeeName(employee, i18n.language)}</span><bdi dir="ltr" className="text-sm text-muted-foreground">{employee.id}</bdi><span className="text-sm">{t('assets.uniform.choose')}</span>
          </button>
        </li>)}
      </ul>}
    </>}
  </section>
}
