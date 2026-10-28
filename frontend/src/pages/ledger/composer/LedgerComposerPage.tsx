/**
 * Ledger Book composer — `/ledger/compose/:draftId`. A private draft with no
 * number: Tab, Grade, Importance, ordered Subject lines and the HugeRTE body,
 * autosaved as the writer types.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useId, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { GradeSelect } from '@/components/books/GradeSelect'
import { GRADE_META } from '@/components/books/grades'
import { ledgerDraftKey } from '@/components/books/ledgerBookKeys'
import { Button } from '@/components/ui/button'
import { api, type LedgerDraftRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import { composerSchema, valuesFromDraft, type ComposerValues } from './composerForm'
import { ImportancePicker } from './ImportancePicker'
import { LedgerBodyEditor } from './LedgerBodyEditor'
import { SubjectLines } from './SubjectLines'
import { useDraftAutosave, type SaveState } from './useDraftAutosave'

const AUTOSAVE_MS = 800

type FieldErrors = Partial<Record<'tab' | 'subjects' | 'body', string>>

export function LedgerComposerPage({ autosaveMs = AUTOSAVE_MS }: { autosaveMs?: number }): React.JSX.Element {
  const { t } = useTranslation()
  const draftId = Number(useParams().draftId)
  const query = useQuery({ queryKey: ledgerDraftKey(draftId), queryFn: () => api.getLedgerDraft(draftId), staleTime: Infinity })
  if (query.isError) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-3 p-6">
        <p role="alert">{t('ledgerBook.composer.loadFailed')}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>{t('ledgerBook.composer.retry')}</Button>
      </div>
    )
  }
  if (!query.data) return <p role="status" className="p-6 text-muted-foreground">{t('ledgerBook.composer.loading')}</p>
  return <Composer key={draftId} draft={query.data} autosaveMs={autosaveMs} />
}

function Composer({ draft, autosaveMs }: { draft: LedgerDraftRead; autosaveMs: number }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const tabId = useId()
  const [initial] = useState(() => valuesFromDraft(draft))
  const form = useForm<ComposerValues>({ resolver: zodResolver(composerSchema), defaultValues: initial })
  const values = useWatch({ control: form.control }) as ComposerValues
  const autosave = useDraftAutosave(draft.id, values, initial, autosaveMs)
  const [errors] = useState<FieldErrors>({})
  const classifications = useQuery({
    queryKey: ['books', 'classifications'],
    queryFn: () => api.listBookClassifications(),
    staleTime: Infinity,
  })
  const tabs = classifications.data?.items ?? []
  const grade = GRADE_META[values.grade]
  const GradeIcon = grade.icon
  const draftLabel = t('ledgerBook.composer.draftLabel', { number: draft.draft_number })

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          to="/ledger?tab=books"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-[0.84em] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
          {t('ledgerBook.composer.back')}
        </Link>
        <h1 className="me-auto text-lg font-semibold">
          <span className="text-muted-foreground">{t('ledgerBook.composer.title')} · </span>
          <bdi>{draftLabel}</bdi>
        </h1>
        <SaveStatus state={autosave.state} />
      </header>

      <div
        className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-[0.84em] font-semibold', grade.className || 'bg-muted text-muted-foreground')}
        data-grade={values.grade}
      >
        {GradeIcon && <GradeIcon aria-hidden="true" className="size-4" />}
        {t('ledgerBook.composer.fields.gradeBanner', { label: t('books.grade.label'), grade: t(grade.label) })}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={tabId} className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.fields.tab')}</label>
          <Controller
            control={form.control}
            name="tab"
            render={({ field }) => (
              <select
                id={tabId}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                aria-invalid={errors.tab ? true : undefined}
                aria-describedby={errors.tab ? `${tabId}-error` : undefined}
                className="min-h-10 w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.84em] text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              >
                <option value="">{t('ledgerBook.composer.fields.tabPlaceholder')}</option>
                {tabs.map((c) => (
                  <option key={c.code} value={c.tab}>
                    {t('ledgerBook.composer.fields.tabOption', { tab: c.tab, name: isAr ? c.name_ar : c.name_en })}
                  </option>
                ))}
              </select>
            )}
          />
          {errors.tab && <p id={`${tabId}-error`} role="alert" className="text-[0.78em] text-destructive">{errors.tab}</p>}
        </div>
        <Controller
          control={form.control}
          name="grade"
          render={({ field }) => <GradeSelect value={field.value} onChange={field.onChange} />}
        />
        <Controller
          control={form.control}
          name="importance"
          render={({ field }) => <ImportancePicker value={field.value} onChange={field.onChange} />}
        />
      </div>

      <Controller
        control={form.control}
        name="subjects"
        render={({ field }) => <SubjectLines value={field.value} onChange={field.onChange} error={errors.subjects} />}
      />

      <div className="flex flex-col gap-1">
        <span className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.body.label')}</span>
        <Controller
          control={form.control}
          name="body_html"
          render={({ field }) => (
            <LedgerBodyEditor
              value={field.value}
              onChange={field.onChange}
              label={t('ledgerBook.composer.body.label')}
              invalid={Boolean(errors.body)}
            />
          )}
        />
        {errors.body && <p role="alert" className="text-[0.78em] text-destructive">{errors.body}</p>}
      </div>
    </div>
  )
}

function SaveStatus({ state }: { state: SaveState }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <p role="status" className={cn('text-[0.78em]', state === 'failed' ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
      {state === 'saving' && t('ledgerBook.composer.save.saving')}
      {state === 'saved' && t('ledgerBook.composer.save.saved')}
      {state === 'failed' && t('ledgerBook.composer.save.failed')}
    </p>
  )
}
