/**
 * MultiRecipientPickerField — chip-based multi-select used by the General
 * Book CC field.
 *
 * Same data source (GET /api/v1/general-book/recipients) and "+ Add new" flow
 * as the single-select RecipientPickerField, but selections accumulate as
 * removable chips beneath the input. The dropdown stays open after each pick
 * so the operator can chain selections; already-chosen recipients are
 * filtered out so they can't be added twice. Removing a chip puts the name
 * back in the list.
 *
 * Copy distinction: the single recipient picker is the *primary recipient*
 * surface; this picker is the *CC* surface. Round 4 made the copy reflect
 * that distinction — placeholders, inline-add, manage button, chip-list
 * aria-label and chip remove buttons all read as "CC", not "recipient". The
 * recipient_multi_picker field type only has one consumer in this app (the
 * General Book CC field), so we hardcode the CC copy here rather than
 * threading a `labelKind` through `_fields.json`.
 *
 * Form value is a `string[]` of recipient **names** (English). The backend's
 * General Book adapter joins them into the `{{ cc }}` token.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { CapabilityGate } from '@/components/shell/CapabilityGate'
import { api } from '@/lib/api'
import type { RecipientRead } from '@/lib/api'
import { RecipientManagerDialog } from '../RecipientManagerDialog'
import type { FieldProps } from '../types'

export function MultiRecipientPickerField({
  name,
  label_en,
  label_ar,
  required,
}: FieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const listboxId = useId()
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending blur-close timeout on unmount (avoid setState-after-unmount).
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current)
  }, [])

  const {
    control,
    formState: { errors },
  } = useFormContext()

  const qc = useQueryClient()

  const {
    data: recipients = [],
    isLoading,
    isError: isPickerError,
  } = useQuery<RecipientRead[]>({
    queryKey: ['general-book', 'recipients'],
    queryFn: () => api.listRecipients(),
    staleTime: 5 * 60 * 1000,
  })

  const createMut = useMutation({
    mutationFn: (recipientName: string) =>
      api.createRecipient({ name: recipientName }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['general-book', 'recipients'] })
      toast.success(t('application.cc.addedToast'))
      return created
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const error = (errors[name] as { message?: string } | undefined)?.message

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${name}-input`}>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Controller
        control={control}
        name={name}
        render={({ field }) => {
          // Normalize to string[] so callers that haven't initialised the field
          // (defaultValues={}) still render correctly.
          const selectedNames: string[] = Array.isArray(field.value)
            ? (field.value as string[])
            : []

          const isSelected = (name_: string) =>
            selectedNames.some(
              (n) => n.toLowerCase() === name_.toLowerCase(),
            )

          const q = query.trim().toLowerCase()
          const filtered = recipients.filter((r) => {
            if (isSelected(r.name)) return false
            if (!q) return true
            return (
              r.name.toLowerCase().includes(q) ||
              (r.name_ar ?? '').toLowerCase().includes(q)
            )
          })

          // "+ Add new" only when (a) the operator typed something, (b) it's
          // not already an existing recipient (by English or Arabic name), and
          // (c) it's not already chosen.
          const showAddInline =
            q.length > 0 &&
            !recipients.some(
              (r) =>
                r.name.toLowerCase() === q ||
                (r.name_ar ?? '').toLowerCase() === q,
            ) &&
            !isSelected(query.trim())

          const addName = (n: string) => {
            const trimmed = n.trim()
            if (!trimmed) return
            if (isSelected(trimmed)) return
            field.onChange([...selectedNames, trimmed])
          }

          const removeAt = (idx: number) => {
            const next = selectedNames.filter((_, i) => i !== idx)
            field.onChange(next)
          }

          const displayName = (r: RecipientRead) =>
            isAr && r.name_ar ? r.name_ar : r.name

          return (
            <>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <input
                    id={`${name}-input`}
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={open ? listboxId : undefined}
                    aria-autocomplete="list"
                    autoComplete="off"
                    className="flex h-9 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder={t('application.cc.searchPlaceholder')}
                    value={query}
                    onFocus={() => setOpen(true)}
                    onBlur={() => {
                      // Delay so an onMouseDown selection registers before the
                      // dropdown unmounts.
                      blurTimer.current = setTimeout(() => setOpen(false), 200)
                    }}
                    onChange={(e) => {
                      setQuery(e.target.value)
                      if (!open) setOpen(true)
                    }}
                  />
                  {open && (
                    <div
                      id={listboxId}
                      role="listbox"
                      className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-md"
                    >
                      {isLoading ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          {t('common.loading')}
                        </div>
                      ) : filtered.length === 0 && !showAddInline ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          {t('common.noResults')}
                        </div>
                      ) : (
                        <>
                          {filtered.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              role="option"
                              aria-selected={false}
                              className="flex w-full flex-col px-3 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted"
                              onMouseDown={(e) => {
                                // Prevent the input's onBlur from firing first.
                                e.preventDefault()
                                addName(r.name)
                                setQuery('')
                                // Keep the dropdown open — the explicit ask is
                                // chained click-to-add. The blur handler is
                                // bypassed by preventDefault above.
                              }}
                            >
                              <span>{displayName(r)}</span>
                              {r.name_ar && !isAr && (
                                <span className="text-xs text-muted-foreground">
                                  {r.name_ar}
                                </span>
                              )}
                            </button>
                          ))}
                          {showAddInline && (
                            <button
                              type="button"
                              role="option"
                              aria-selected={false}
                              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-start text-sm text-primary hover:bg-muted focus-visible:bg-muted"
                              onMouseDown={async (e) => {
                                e.preventDefault()
                                const trimmed = query.trim()
                                setQuery('')
                                try {
                                  const created =
                                    await createMut.mutateAsync(trimmed)
                                  // Add the canonical name from the created
                                  // row so spellings stay in sync.
                                  addName(created.name)
                                } catch {
                                  // error already toasted by mutation
                                }
                              }}
                            >
                              <span aria-hidden>+</span>
                              <span>{t('application.cc.addNew')}</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Manage button — requires books.manage capability */}
                <CapabilityGate cap="books.manage" requestable>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setManagerOpen(true)}
                    aria-label={t('application.cc.manage')}
                    title={t('application.cc.manage')}
                  >
                    ⚙
                  </Button>
                </CapabilityGate>
              </div>

              {/* Selected chips */}
              {selectedNames.length > 0 && (
                <ul
                  className="mt-1 flex flex-wrap gap-1.5"
                  aria-label={t('application.cc.selected')}
                >
                  {selectedNames.map((n, idx) => (
                    <li key={`${n}-${idx}`}>
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 ps-3 pe-1 text-xs font-medium text-primary">
                        <span className="max-w-[14rem] truncate">{n}</span>
                        <button
                          type="button"
                          onClick={() => removeAt(idx)}
                          aria-label={t('application.cc.remove', { name: n })}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <X className="h-3 w-3" strokeWidth={2} aria-hidden />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        }}
      />

      {isPickerError && (
        <span role="alert" className="text-xs text-destructive">
          {t('application.pickerLoadError')}
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}

      <RecipientManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
      />
    </div>
  )
}
