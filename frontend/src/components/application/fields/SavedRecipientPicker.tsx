import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { api, apiErrorMessage, type RecipientRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { RecipientManagerDialog } from '../RecipientManagerDialog'

interface Props {
  id?: string
  inputRef?: (node: HTMLInputElement | null) => void
  onBlur?: () => void
  label: string
  value: number | string | string[] | null
  onChange: (value: number | string | string[] | null) => void
  mode: 'id' | 'name' | 'multiple'
  required?: boolean
  disabled?: boolean
  error?: string
  hint?: string
  maxNames?: number
  maxNameLength?: number
}

/** General Book's saved designation list, shared by its form fields and Ledger paper fields. */
export function SavedRecipientPicker({ id, inputRef, onBlur, label, value, onChange, mode, required, disabled = false, error, hint, maxNames = Infinity, maxNameLength }: Props): React.JSX.Element {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-list`
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const canManage = useCapabilities().has('books.edit')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [managerOpen, setManagerOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef({ value, onChange, disabled })
  useLayoutEffect(() => { latest.current = { value, onChange, disabled } }, [value, onChange, disabled])
  const qc = useQueryClient()
  const { data: recipients = [], isLoading, isError } = useQuery({
    queryKey: ['general-book', 'recipients'], queryFn: () => api.listRecipients(), staleTime: 5 * 60_000,
  })
  const create = useMutation({
    mutationFn: (name: string) => api.createRecipient({ name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['general-book', 'recipients'] })
      toast.success(t(mode === 'multiple' ? 'application.cc.addedToast' : 'application.recipientAdded'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const wasCreating = useRef(false)
  useEffect(() => {
    if (wasCreating.current && !create.isPending && !disabled) input.current?.focus()
    wasCreating.current = create.isPending
  }, [create.isPending, disabled])
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, listId, open])
  const multiple = mode === 'multiple'
  const names = Array.isArray(value) ? value : []
  const full = multiple && names.length >= maxNames
  const blocked = disabled || create.isPending
  const displayName = (r: RecipientRead): string => isAr && r.name_ar ? r.name_ar : r.name
  const selected = recipients.find((r) => r.id === value)
  const q = query.trim().toLowerCase()
  const validName = (name: string): boolean => maxNameLength === undefined || (name.trim().length > 0 && name.trim().length <= maxNameLength)
  const matches = recipients.filter((r) => !names.some((n) => n.trim().toLowerCase() === r.name.trim().toLowerCase()) && (!q || r.name.toLowerCase().includes(q) || r.name_ar?.toLowerCase().includes(q)))
  const filtered = matches.filter((r) => validName(r.name))
  const showAdd = canManage && q.length > 0 && query.trim().length <= 500 && !full && !names.some((n) => n.trim().toLowerCase() === q) && !recipients.some((r) => r.name.trim().toLowerCase() === q || r.name_ar?.trim().toLowerCase() === q)
  const count = full ? 0 : filtered.length + Number(showAdd)
  const choose = (r: RecipientRead): void => {
    const name = r.name.trim()
    if (latest.current.disabled || !validName(name)) return
    if (multiple) {
      const current = Array.isArray(latest.current.value) ? latest.current.value : []
      if (current.length >= maxNames || current.some((n) => n.trim().toLowerCase() === name.toLowerCase())) return
      latest.current.onChange([...current, name])
    } else latest.current.onChange(mode === 'id' ? r.id : name)
    setQuery('')
    setActive(-1)
    setOpen(multiple)
  }
  const pick = async (index: number): Promise<void> => {
    if (blocked || full) return
    if (index < filtered.length) choose(filtered[index])
    else if (showAdd) {
      const name = query.trim()
      try { choose(await create.mutateAsync(name)) } catch { /* Mutation reports the error; keep the query for retry. */ }
    }
  }
  const describedBy = [hint && `${inputId}-hint`, (error || isError) && `${inputId}-error`].filter(Boolean).join(' ') || undefined
  return <div className="flex min-w-0 flex-col gap-1.5">
    <label htmlFor={inputId} className="text-sm font-medium">{label}</label>
    <div className="flex gap-1.5">
      <div className="relative min-w-0 flex-1">
        <input ref={(node) => { input.current = node; inputRef?.(node) }} id={inputId} role="combobox" dir="auto" autoComplete="off" maxLength={mode === 'id' ? undefined : 500}
          aria-expanded={open && !blocked} aria-controls={open && !blocked ? listId : undefined} aria-autocomplete="list"
          aria-activedescendant={open && !blocked && active >= 0 && active < count ? `${listId}-${active}` : undefined}
          aria-required={required} aria-invalid={Boolean(error)} aria-describedby={describedBy} aria-busy={create.isPending}
          disabled={blocked} readOnly={full} placeholder={t(multiple ? 'application.cc.searchPlaceholder' : 'application.searchRecipients')}
          className="flex min-h-10 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          value={mode === 'name' ? String(value ?? '') : open || multiple ? query : selected ? displayName(selected) : ''}
          onFocus={() => { setOpen(true); setQuery(''); setActive(-1) }}
          onBlur={() => { setOpen(false); setActive(-1); onBlur?.() }}
          onChange={(event) => { setQuery(event.target.value); setActive(-1); setOpen(true); if (mode === 'name') onChange(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1) }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true)
              setActive((index) => count === 0 ? -1 : index < 0 ? event.key === 'ArrowDown' ? 0 : count - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count)
            }
            if (event.key === 'Enter' && open) { event.preventDefault(); if (active >= 0) void pick(active) }
          }} />
        {open && !blocked && <div id={listId} role="listbox" className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-md">
          {isLoading ? <p role="status" className="px-3 py-2 text-sm">{t('common.loading')}</p> : <>
            {filtered.length < matches.length && <p role="status" className="px-3 py-2 text-sm text-muted-foreground">{t('application.savedNameLength', { max: maxNameLength })}</p>}
            {count === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">{t('common.noResults')}</p>}
            {!full && filtered.map((r, index) => <button key={r.id} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={active === index}
              className="flex min-h-10 w-full flex-col px-3 py-1.5 text-start text-sm hover:bg-surface-tinted aria-selected:bg-surface-tinted"
              onMouseDown={(event) => event.preventDefault()} onClick={() => void pick(index)}>
              <bdi>{displayName(r)}</bdi>{r.name_ar && !isAr && <bdi className="text-xs text-muted-foreground">{r.name_ar}</bdi>}
            </button>)}
            {showAdd && <button id={`${listId}-${filtered.length}`} type="button" role="option" tabIndex={-1} aria-selected={active === filtered.length}
              className="flex min-h-10 w-full items-center gap-1.5 px-3 py-1.5 text-start text-sm text-primary-text hover:bg-surface-tinted aria-selected:bg-surface-tinted"
              onMouseDown={(event) => event.preventDefault()} onClick={() => void pick(filtered.length)}>+ {t(multiple ? 'application.cc.addNew' : 'application.addRecipient')} <bdi>{query.trim()}</bdi></button>}
          </>}
        </div>}
      </div>
      {!multiple && value != null && value !== '' && <Button type="button" variant="secondary" disabled={blocked} aria-label={t('application.clearRecipient')} onClick={() => { onChange(mode === 'id' ? null : ''); setQuery(''); input.current?.focus() }}>×</Button>}
      {canManage && <Button type="button" variant="secondary" disabled={blocked} aria-label={t(multiple ? 'application.cc.manage' : 'application.manageRecipients')} onClick={() => setManagerOpen(true)}>⚙</Button>}
    </div>
    {multiple && names.length > 0 && <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={t('application.cc.selected')}>
      {names.map((name, index) => <li key={`${name}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-soft py-1 ps-3 pe-1 text-xs font-medium text-primary-text">
        <bdi className="max-w-[14rem] truncate">{name}</bdi><button type="button" disabled={blocked} className="inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-tinted focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('application.cc.remove', { name })}
          onClick={() => { onChange(names.filter((_, i) => i !== index)); input.current?.focus() }}><X className="size-3" aria-hidden="true" /></button>
      </li>)}
    </ul>}
    {hint && <p id={`${inputId}-hint`} className="text-[0.78em] text-muted-foreground">{hint}</p>}
    {(error || isError) && <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">{error || t('application.pickerLoadError')}</p>}
    {canManage && <RecipientManagerDialog open={managerOpen && !disabled} onOpenChange={setManagerOpen} />}
  </div>
}
