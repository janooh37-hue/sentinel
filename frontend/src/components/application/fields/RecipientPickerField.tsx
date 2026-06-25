/**
 * RecipientPickerField — searchable combobox for General Book recipient selection.
 *
 * Fetches GET /api/v1/general-book/recipients via TanStack Query.
 * A gear button (books.manage capability) opens RecipientManagerDialog for
 * add/delete. Inline "+ Add recipient" option in the dropdown lets users
 * add a new recipient without leaving the form.
 *
 * Sends `recipient_id` (number | null) as the form value.
 */

import { useId, useState } from 'react'
import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { CapabilityGate } from '@/components/shell/CapabilityGate'
import { api } from '@/lib/api'
import type { RecipientRead } from '@/lib/api'
import { RecipientManagerDialog } from '../RecipientManagerDialog'
import type { FieldProps } from '../types'

export function RecipientPickerField({
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
      toast.success(isAr ? 'تمت إضافة المستلم' : 'Recipient added')
      return created
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const q = query.trim().toLowerCase()
  const filtered = q
    ? recipients.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.name_ar ?? '').toLowerCase().includes(q),
      )
    : recipients

  /** True when the typed query doesn't exactly match any existing recipient
   *  (matching either the English name or, when present, the Arabic name). */
  const showAddInline =
    q.length > 0 &&
    !recipients.some(
      (r) =>
        r.name.toLowerCase() === q ||
        (r.name_ar ?? '').toLowerCase() === q,
    )

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
          const selected =
            recipients.find((r) => r.id === field.value) ?? null

          const displayName = (r: RecipientRead) =>
            isAr && r.name_ar ? r.name_ar : r.name

          return (
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
                  placeholder={t('application.searchRecipients')}
                  value={open ? query : (selected ? displayName(selected) : '')}
                  onFocus={() => {
                    setOpen(true)
                    setQuery('')
                  }}
                  onBlur={() => {
                    // Delay so click on option registers first
                    setTimeout(() => {
                      setOpen(false)
                    }, 200)
                  }}
                  onChange={(e) => setQuery(e.target.value)}
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
                            aria-selected={field.value === r.id}
                            className="flex w-full flex-col px-3 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted"
                            onMouseDown={() => {
                              field.onChange(r.id)
                              setOpen(false)
                              setQuery('')
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
                            onMouseDown={async () => {
                              const trimmed = query.trim()
                              setOpen(false)
                              setQuery('')
                              try {
                                const created = await createMut.mutateAsync(trimmed)
                                field.onChange(created.id)
                              } catch {
                                // error already toasted by mutation
                              }
                            }}
                          >
                            <span aria-hidden>+</span>
                            <span>
                              {isAr
                                ? `إضافة "${query.trim()}"`
                                : `Add "${query.trim()}"`}
                            </span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Clear button when a value is selected */}
              {field.value != null && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    field.onChange(null)
                    setQuery('')
                  }}
                  aria-label={isAr ? 'مسح المستلم' : 'Clear recipient'}
                >
                  ×
                </Button>
              )}

              {/* Manage button — requires books.manage capability */}
              <CapabilityGate cap="books.manage" requestable>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setManagerOpen(true)}
                  aria-label={t('application.manageRecipients')}
                  title={t('application.manageRecipients')}
                >
                  ⚙
                </Button>
              </CapabilityGate>
            </div>
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
