/**
 * LedgerEntryForm — RHF + Zod form for create / edit ledger entries.
 *
 * Renders as a full-page view inside LedgerPage when the user clicks
 * "New entry" or edits an existing one. A back button returns to the
 * timeline list.
 */

import { useEffect, useState } from 'react'
import { useForm, FormProvider, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { LedgerEntryRead } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CounterpartyPicker } from './CounterpartyPicker'
import { RichEditor } from '@/components/ui/rich-editor'
import { pickEmployeeName } from '@/lib/employeeName'

// ─── Zod schema ─────────────────────────────────────────────────────────────

const schema = z.object({
  entry_date: z.string().min(1, 'Required'),
  direction: z.enum(['incoming', 'outgoing', 'internal']),
  channel: z.enum(['email', 'phone', 'in_person', 'fax', 'letter', 'other']),
  counterparty: z.string().min(1, 'Required'),
  subject: z.string().min(1, 'Required'),
  notes_html: z.string().optional().nullable(),
  tags: z.array(z.string()),
  related_book_id: z.number().nullable().optional(),
  related_employee_id: z.string().nullable().optional(),
})

type FormValues = z.infer<typeof schema>

/** Sentinel for the cleared ("—") relation items — Radix Select forbids a
 *  literal empty value, so we map this to `null` on change. */
const NO_RELATION = '__none__'

// ─── Tag chip input ───────────────────────────────────────────────────────────

function TagInput({
  value,
  onChange,
}: {
  value: string[]
  onChange: (tags: string[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  function addTag(raw: string): void {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.includes(s))
    if (parts.length > 0) onChange([...value, ...parts])
  }

  function removeTag(idx: number): void {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5">
      {value.map((tag, i) => (
        <span
          key={i}
          className="flex items-center gap-1 rounded-sm bg-surface-tinted px-1.5 py-0.5 text-xs font-medium text-foreground"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(i)}
            className="text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={value.length === 0 ? t('ledger.form.tags') : ''}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
            e.preventDefault()
            addTag(draft)
            setDraft('')
          }
          if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            removeTag(value.length - 1)
          }
        }}
        onBlur={() => {
          if (draft.trim()) {
            addTag(draft)
            setDraft('')
          }
        }}
        className="min-w-[80px] flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </div>
  )
}

// ─── LedgerEntryForm ─────────────────────────────────────────────────────────

interface CreateMode {
  mode: 'create'
  initial?: undefined
}
interface EditMode {
  mode: 'edit'
  initial: LedgerEntryRead
}

type LedgerEntryFormProps = (CreateMode | EditMode) & {
  onClose: () => void
  onSaved: (entry: LedgerEntryRead) => void
}

export function LedgerEntryForm({
  mode,
  initial,
  onClose,
  onSaved,
}: LedgerEntryFormProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()

  // Esc closes the form. HugeRTE's iframe captures its own keydown, so
  // typing inside the editor doesn't fire this listener.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const today = new Date().toISOString().slice(0, 10)

  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      entry_date: initial?.entry_date ?? today,
      direction: (initial?.direction as FormValues['direction']) ?? 'outgoing',
      channel: (initial?.channel as FormValues['channel']) ?? 'email',
      counterparty: initial?.counterparty ?? '',
      subject: initial?.subject ?? '',
      notes_html: initial?.notes_html ?? '',
      tags: initial?.tags ?? [],
      related_book_id: initial?.related_book_id ?? null,
      related_employee_id: initial?.related_employee_id ?? null,
    },
  })

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = methods

  const createMutation = useMutation({
    mutationFn: (values: FormValues) =>
      api.createLedgerEntry({
        entry_date: values.entry_date,
        direction: values.direction,
        channel: values.channel,
        counterparty: values.counterparty,
        subject: values.subject,
        notes_html: values.notes_html ?? null,
        tags: values.tags,
        related_book_id: values.related_book_id ?? null,
        related_employee_id: values.related_employee_id ?? null,
      }),
    onSuccess: (entry) => {
      void qc.invalidateQueries({ queryKey: ['ledger'] })
      toast.success(t('ledger.toast.created'))
      onSaved(entry)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const updateMutation = useMutation({
    mutationFn: (values: FormValues) =>
      api.updateLedgerEntry(initial!.id, {
        entry_date: values.entry_date,
        direction: values.direction,
        channel: values.channel,
        counterparty: values.counterparty,
        subject: values.subject,
        notes_html: values.notes_html ?? null,
        tags: values.tags,
        related_book_id: values.related_book_id ?? null,
        related_employee_id: values.related_employee_id ?? null,
      }),
    onSuccess: (entry) => {
      void qc.invalidateQueries({ queryKey: ['ledger'] })
      void qc.invalidateQueries({ queryKey: ['ledger-entry', initial!.id] })
      toast.success(t('ledger.toast.updated'))
      onSaved(entry)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  function onSubmit(values: FormValues): void {
    if (mode === 'create') {
      createMutation.mutate(values)
    } else {
      updateMutation.mutate(values)
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  // Book combobox data
  const booksQuery = useQuery({
    queryKey: ['books', { limit: 200 }],
    queryFn: () => api.listBooks({ limit: 200 }),
    staleTime: 60_000,
  })

  // Employee combobox data
  const employeesQuery = useQuery({
    queryKey: ['employees', { limit: 300 }],
    queryFn: () => api.listEmployees({ limit: 300 }),
    staleTime: 60_000,
  })

  const DIRECTIONS: Array<{ value: FormValues['direction']; labelKey: string }> = [
    { value: 'incoming', labelKey: 'ledger.direction.incoming' },
    { value: 'outgoing', labelKey: 'ledger.direction.outgoing' },
    { value: 'internal', labelKey: 'ledger.direction.internal' },
  ]

  const CHANNELS: Array<{ value: FormValues['channel']; labelKey: string }> = [
    { value: 'email', labelKey: 'ledger.channel.email' },
    { value: 'phone', labelKey: 'ledger.channel.phone' },
    { value: 'in_person', labelKey: 'ledger.channel.in_person' },
    { value: 'fax', labelKey: 'ledger.channel.fax' },
    { value: 'letter', labelKey: 'ledger.channel.letter' },
    { value: 'other', labelKey: 'ledger.channel.other' },
  ]

  return (
    /* Full-page view — header + footer pinned, body scrolls. */
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-surface-tinted"
      role="region"
      aria-label={mode === 'create' ? t('ledger.newEntry') : t('common.edit')}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
          aria-label={t('common.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          <span>{t('common.back', { defaultValue: 'Back' })}</span>
        </button>
        <span className="text-border">/</span>
        <h2 className="text-base font-semibold text-foreground">
          {mode === 'create' ? t('ledger.newEntry') : t('common.edit')}
        </h2>
      </div>

      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {/* Top row — three short metadata fields in a 3-col grid. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Entry Date */}
            <div className="flex flex-col gap-1.5">
              <Label>{t('ledger.form.entryDate')}</Label>
              <input
                type="date"
                {...register('entry_date')}
                className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {errors.entry_date && (
                <span className="text-xs text-accent">{errors.entry_date.message}</span>
              )}
            </div>

            {/* Direction */}
            <div className="flex flex-col gap-1.5">
              <Label>{t('ledger.form.direction')}</Label>
              <Controller
                control={control}
                name="direction"
                render={({ field }) => (
                  <div className="flex gap-3">
                    {DIRECTIONS.map(({ value, labelKey }) => (
                      <label key={value} className="flex cursor-pointer items-center gap-1.5 text-sm">
                        <input
                          type="radio"
                          value={value}
                          checked={field.value === value}
                          onChange={() => field.onChange(value)}
                          className="accent-primary"
                        />
                        {t(labelKey)}
                      </label>
                    ))}
                  </div>
                )}
              />
            </div>

            {/* Channel */}
            <div className="flex flex-col gap-1.5">
              <Label>{t('ledger.form.channel')}</Label>
              <Controller
                control={control}
                name="channel"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger aria-label={t('ledger.form.channel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map(({ value, labelKey }) => (
                        <SelectItem key={value} value={value}>
                          {t(labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            </div>

            {/* Counterparty */}
            <div className="flex flex-col gap-1.5">
              <Label>{t('ledger.form.counterparty')}</Label>
              <Controller
                control={control}
                name="counterparty"
                render={({ field }) => (
                  <CounterpartyPicker
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              {errors.counterparty && (
                <span className="text-xs text-accent">{errors.counterparty.message}</span>
              )}
            </div>

            {/* Subject */}
            <div className="flex flex-col gap-1.5">
              <Label>{t('ledger.form.subject')}</Label>
              <Input {...register('subject')} />
              {errors.subject && (
                <span className="text-xs text-accent">{errors.subject.message}</span>
              )}
            </div>

            {/* Notes — compact toolbar for per-entry notes. The full Word-like
             * ribbon lives on the General Book template (arabic_rich_full). */}
            <RichEditor
              name="notes_html"
              variant="minimal"
              label_en="Notes"
              label_ar="ملاحظات"
              required={false}
            />

            {/* Tags */}
            <div className="flex flex-col gap-1.5">
              <Label>{t('ledger.form.tags')}</Label>
              <Controller
                control={control}
                name="tags"
                render={({ field }) => (
                  <TagInput value={field.value} onChange={field.onChange} />
                )}
              />
            </div>

            {/* Related Book + Employee in a 2-col row. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>{t('ledger.form.relatedBook')}</Label>
              <Controller
                control={control}
                name="related_book_id"
                render={({ field }) => (
                  <Select
                    value={field.value != null ? String(field.value) : NO_RELATION}
                    onValueChange={(v) =>
                      field.onChange(v === NO_RELATION ? null : Number(v))
                    }
                  >
                    <SelectTrigger aria-label={t('ledger.form.relatedBook')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_RELATION}>—</SelectItem>
                      {(booksQuery.data?.items ?? []).map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.ref_number} — {b.subject}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* Related Employee */}
            <div className="flex flex-col gap-1.5 sm:col-span-1">
              <Label>{t('ledger.form.relatedEmployee')}</Label>
              <Controller
                control={control}
                name="related_employee_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NO_RELATION}
                    onValueChange={(v) => field.onChange(v === NO_RELATION ? null : v)}
                  >
                    <SelectTrigger aria-label={t('ledger.form.relatedEmployee')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_RELATION}>—</SelectItem>
                      {(employeesQuery.data?.items ?? []).map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.id} — {pickEmployeeName(emp, i18n.language)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            </div>

            </div>
          </div>
          {/* Sticky footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-background px-6 py-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isPending || isSubmitting}>
              {t('ledger.form.save')}
            </Button>
          </div>
        </form>
      </FormProvider>
    </div>
  )
}
