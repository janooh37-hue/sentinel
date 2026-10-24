/**
 * Guided department setup: choose heads → names and people → deputies and
 * services → review and turn on. Saved departments are the only resume state;
 * choices in steps 1–2 live here until "Create selected departments".
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type DepartmentRead, type OrgNodeRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { departmentErrorMessage, departmentName, invalidateDepartmentData } from '@/lib/departments'
import { pickEmployeeName } from '@/lib/employeeName'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { DepartmentPeopleDialog, DepartmentServicesDialog } from './DepartmentDialogs'
import { DraftNameFields, DraftPreviewSummary } from './DepartmentDraft'
import { personPosition, serviceLabel, type DraftNames } from './labels'
import {
  applyServiceSelection,
  attentionOf,
  managersUnder,
  previewDrafts,
  unitSuggestions,
  type ManagerSuggestion,
  type ServiceMode,
} from './model'
import { PersonSearch } from './PersonSearch'
import { BackLink, LABEL, LINK_BUTTON, LiveEditsNotice, PANEL, QueryFailure, ViewHeading } from './ui'
import { useOrgData, type OrgRoute, type SetupStep } from './useOrgData'

const STEPS: readonly SetupStep[] = [1, 2, 3, 4]

export function DepartmentSetup({ step, go }: { step: SetupStep; go: (next: Partial<OrgRoute>) => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string[]>([])
  const [names, setNames] = useState<Record<string, DraftNames>>({})
  const [leaving, setLeaving] = useState(false)
  const keepNames = useCallback((next: Record<string, DraftNames>) => setNames((current) => ({ ...current, ...next })), [])
  const toStep = (next: SetupStep): void => go({ view: 'setup', step: next })
  const unsaved = selected.length > 0

  return (
    <div className="space-y-5 pb-24 md:pb-0">
      <BackLink onClick={() => (unsaved ? setLeaving(true) : go({}))} />
      <ViewHeading title={t('orgDepartments.setup.title')}>{t('orgDepartments.setup.intro')}</ViewHeading>
      <nav aria-label={t('orgDepartments.setup.progress')}>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STEPS.map((value) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => toStep(value)}
                aria-current={value === step ? 'step' : undefined}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-start text-[0.84em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  value === step ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-hairline bg-surface text-muted-foreground hover:bg-surface-tinted',
                )}
              >
                <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.85em] font-semibold tabular-nums', value === step ? 'bg-primary text-primary-foreground' : 'bg-surface-tinted text-foreground')}>{value}</span>
                <span className="min-w-0">{t(`orgDepartments.setup.steps.${value}`)}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <p className="sr-only" aria-live="polite">{t('orgDepartments.setup.stepOf', { step, name: t(`orgDepartments.setup.steps.${step}`) })}</p>

      {step === 1 && <ChooseHeads selected={selected} setSelected={setSelected} onNext={() => toStep(2)} onCancel={() => (unsaved ? setLeaving(true) : go({}))} />}
      {step === 2 && (
        <NamesAndPeople
          selected={selected}
          names={names}
          onKeep={keepNames}
          onCreated={(headIds) => setSelected((current) => current.filter((id) => !headIds.includes(id)))}
          onRemove={(headId) => setSelected((current) => current.filter((id) => id !== headId))}
          onBack={() => toStep(1)}
          onNext={() => toStep(3)}
        />
      )}
      {step === 3 && <Configure onBack={() => toStep(2)} onNext={() => toStep(4)} />}
      {step === 4 && <AccessLimitsReview onBack={() => toStep(3)} onDone={() => go({})} />}

      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={t('orgDepartments.setup.leaveTitle')}
        description={t('orgDepartments.setup.leaveHint', { count: selected.length })}
        confirmLabel={t('orgDepartments.setup.leave')}
        onConfirm={() => go({})}
      />
    </div>
  )
}

/** Bottom action bar: sticky above the phone tab bar, inline from md up. */
function StepActions({ children, summary }: { children: React.ReactNode; summary?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-hairline bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:-mx-8 sm:px-8 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none">
      {summary ? <p className="me-auto text-[0.86em] text-foreground">{summary}</p> : null}
      {children}
    </div>
  )
}

// ── Step 1: choose heads ───────────────────────────────────────────────────

function ChooseHeads({ selected, setSelected, onNext, onCancel }: {
  selected: string[]
  setSelected: React.Dispatch<React.SetStateAction<string[]>>
  onNext: () => void
  onCancel: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { tree, departments, exceptions, index } = useOrgData()
  const suggestions = useMemo(() => unitSuggestions(index), [index])
  const headed = useMemo(
    () => new Map((departments.data ?? []).map((department) => [department.head_employee_id, department])),
    [departments.data],
  )
  const placed = useMemo(() => new Set((exceptions.data ?? []).map((exception) => exception.employee_id)), [exceptions.data])
  const blockedReason = (person: OrgNodeRead): string | null => {
    const department = headed.get(person.id)
    if (department) return t('orgDepartments.headPicker.alreadyHeads', { name: bidi(departmentName(department, lang)) })
    if (placed.has(person.id)) return t('orgDepartments.headPicker.placedByHand')
    return null
  }
  const toggle = (id: string, on: boolean): void => setSelected((current) => on ? [...new Set([...current, id])] : current.filter((value) => value !== id))

  if (tree.isPending || departments.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />
  if (tree.isError) return <QueryFailure error={tree.error} retry={() => void tree.refetch()} />

  return (
    <section aria-labelledby="setup-heads" className="space-y-4">
      <div className="max-w-[72ch] space-y-1.5">
        <h3 id="setup-heads" className="text-[1.05em] font-semibold text-foreground">{t('orgDepartments.setup.headsTitle')}</h3>
        <p className="text-[0.88em] text-muted-foreground">{t('orgDepartments.setup.headsIntro')}</p>
        <p className="text-[0.88em] text-muted-foreground">{t('orgDepartments.setup.nestingHint')}</p>
      </div>

      <div>
        <p className={cn(LABEL, 'mb-2')}>{t('orgDepartments.setup.suggestions')}</p>
        {suggestions.length === 0 ? (
          <p className="text-[0.88em] text-muted-foreground">{t('orgDepartments.setup.noSuggestions')}</p>
        ) : (
          <ul className={cn(PANEL, 'divide-y divide-hairline')}>
            {suggestions.map((suggestion) => (
              <HeadOption
                key={suggestion.person.id}
                suggestion={suggestion}
                level={0}
                selected={selected}
                onToggle={toggle}
                blockedReason={blockedReason}
              />
            ))}
          </ul>
        )}
      </div>

      <div className={cn(PANEL, 'px-4 py-4')}>
        <PersonSearch
          people={tree.data ?? []}
          label={t('orgDepartments.setup.findManager')}
          onPick={(person) => toggle(person.id, true)}
          meta={(person) => selected.includes(person.id)
            ? t('orgDepartments.setup.alreadySelected')
            : t('orgDepartments.team', { count: index.branchSize(person.id) })}
          disabledReason={blockedReason}
        />
      </div>

      {selected.length > 0 && (
        <div>
          <p className={cn(LABEL, 'mb-2')}>{t('orgDepartments.setup.selectedTitle', { count: selected.length })}</p>
          <ul className="flex flex-wrap gap-2">
            {selected.map((id) => {
              const person = index.byId.get(id)
              const name = person ? pickEmployeeName(person, lang) : id
              return (
                <li key={id} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border bg-surface ps-3 pe-1 text-[0.84em] text-foreground">
                  <bdi>{name}</bdi>
                  <button
                    type="button"
                    onClick={() => toggle(id, false)}
                    aria-label={t('orgDepartments.setup.deselect', { name })}
                    className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <StepActions summary={t('orgDepartments.setup.selectedCount', { count: selected.length })}>
        <Button variant="outline" className="min-h-11" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button className="min-h-11" disabled={selected.length === 0} onClick={onNext}>
          {t('orgDepartments.setup.review', { count: selected.length })}
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
        </Button>
      </StepActions>
    </section>
  )
}

function HeadOption({ suggestion, level, selected, onToggle, blockedReason }: {
  suggestion: ManagerSuggestion
  level: number
  selected: string[]
  onToggle: (id: string, on: boolean) => void
  blockedReason: (person: OrgNodeRead) => string | null
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { index } = useOrgData()
  const [open, setOpen] = useState(false)
  const { person, branchSize, unit } = suggestion
  const managers = useMemo(() => (open ? managersUnder(index, person.id) : []), [index, open, person.id])
  const canSplit = (index.reports.get(person.id) ?? []).some((report) => (index.reports.get(report.id)?.length ?? 0) > 0)
  const reason = blockedReason(person)
  const name = pickEmployeeName(person, lang)
  const position = personPosition(person, lang)
  const checkboxId = `head-${person.id}`

  return (
    <li>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
        {reason ? (
          <Check className="mt-1 h-4 w-4 shrink-0 text-success" aria-hidden />
        ) : (
          <input
            id={checkboxId}
            type="checkbox"
            checked={selected.includes(person.id)}
            onChange={(event) => onToggle(person.id, event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-primary"
          />
        )}
        <label htmlFor={reason ? undefined : checkboxId} className={cn('min-w-0 flex-1', !reason && 'cursor-pointer')}>
          <bdi className="block break-words text-[0.92em] font-semibold text-foreground">{name}</bdi>
          <span className="mt-0.5 block text-[0.8em] text-muted-foreground">
            {[position, level === 0 ? unit : null].filter(Boolean).map((value, position_) => (
              <span key={position_}>{position_ > 0 && ' · '}<bdi>{value}</bdi></span>
            ))}
          </span>
          <span className={cn('mt-0.5 block text-[0.84em]', reason ? 'text-muted-foreground' : 'text-foreground')}>
            {reason ?? t('orgDepartments.team', { count: branchSize })}
          </span>
        </label>
        {canSplit && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className={cn(LINK_BUTTON, 'basis-full ps-7 sm:basis-auto sm:ps-2')}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
            {t(level === 0 ? 'orgDepartments.setup.splitUnit' : 'orgDepartments.setup.splitFurther')}
          </button>
        )}
      </div>
      {open && managers.length > 0 && (
        <ul
          aria-label={t('orgDepartments.setup.managersUnder', { name })}
          className="ms-4 divide-y divide-hairline border-s border-border sm:ms-7"
        >
          {managers.map((manager) => (
            <HeadOption
              key={manager.person.id}
              suggestion={manager}
              level={level + 1}
              selected={selected}
              onToggle={onToggle}
              blockedReason={blockedReason}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ── Step 2: names and people ───────────────────────────────────────────────

type CreateResult = { ok: true; department: DepartmentRead } | { ok: false; message: string }

function NamesAndPeople({ selected, names, onKeep, onCreated, onRemove, onBack, onNext }: {
  selected: string[]
  names: Record<string, DraftNames>
  onKeep: (names: Record<string, DraftNames>) => void
  onCreated: (headIds: string[]) => void
  onRemove: (headId: string) => void
  onBack: () => void
  onNext: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const { departments, exceptions, index, departmentsById, limitsOn } = useOrgData()
  const [results, setResults] = useState<Map<string, CreateResult>>(new Map())
  const [createdCount, setCreatedCount] = useState<number | null>(null)
  const existingNames = useMemo(() => {
    const taken = new Set<string>()
    for (const department of departments.data ?? []) {
      taken.add(department.name_en.trim().toLocaleLowerCase())
      taken.add(department.name_ar.trim())
    }
    return taken
  }, [departments.data])

  const schema = useMemo(() => {
    const name = z.string().trim().min(1, t('orgDepartments.form.nameRequired')).max(128, t('orgDepartments.form.nameTooLong'))
    return z.object({ drafts: z.array(z.object({ headId: z.string(), name_en: name, name_ar: name })) })
      .superRefine(({ drafts }, ctx) => {
        const seen = new Map<string, number>()
        drafts.forEach((draft, position) => {
          for (const field of ['name_en', 'name_ar'] as const) {
            const key = field === 'name_en' ? draft[field].trim().toLocaleLowerCase() : draft[field].trim()
            if (!key) continue
            if (existingNames.has(key)) {
              ctx.addIssue({ code: 'custom', path: ['drafts', position, field], message: t('departments.errors.nameTaken') })
            } else if (seen.has(`${field}:${key}`)) {
              ctx.addIssue({ code: 'custom', path: ['drafts', position, field], message: t('orgDepartments.setup.duplicateName') })
            }
            seen.set(`${field}:${key}`, position)
          }
        })
      })
  }, [existingNames, t])
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { drafts: selected.map((headId) => ({ headId, name_en: names[headId]?.name_en ?? '', name_ar: names[headId]?.name_ar ?? '' })) },
  })
  const { fields, remove } = useFieldArray({ control: form.control, name: 'drafts' })
  const watched = useWatch({ control: form.control, name: 'drafts' })
  // Keep typed names when the admin steps back to change the selection.
  useEffect(() => () => {
    onKeep(Object.fromEntries(form.getValues('drafts').map((draft) => [draft.headId, { name_en: draft.name_en, name_ar: draft.name_ar }])))
  }, [form, onKeep])

  const headIds = useMemo(() => fields.map((field) => field.headId), [fields])
  const previews = useMemo(
    () => previewDrafts(index, departments.data ?? [], exceptions.data ?? [], headIds),
    [departments.data, exceptions.data, headIds, index],
  )
  const placed = new Set((exceptions.data ?? []).map((exception) => exception.employee_id))
  const draftName = (headId: string): string => {
    const draft = watched.find((item) => item.headId === headId)
    const typed = lang.startsWith('ar') ? draft?.name_ar : draft?.name_en
    const person = index.byId.get(headId)
    return typed?.trim() || t('orgDepartments.setup.unnamed', { name: person ? pickEmployeeName(person, lang) : headId })
  }

  const create = useMutation({
    mutationFn: async (values: Values) => {
      const outcome = new Map<string, CreateResult>()
      // One POST per department, in order: each result is shown on its own row.
      for (const draft of values.drafts) {
        try {
          const department = await api.departments.create({ name_en: draft.name_en.trim(), name_ar: draft.name_ar.trim(), head_employee_id: draft.headId })
          outcome.set(draft.headId, { ok: true, department })
        } catch (error) {
          outcome.set(draft.headId, { ok: false, message: departmentErrorMessage(error, t) })
        }
      }
      return outcome
    },
    onSuccess: (outcome) => {
      invalidateDepartmentData(qc)
      setResults(outcome)
      const created = [...outcome].filter(([, result]) => result.ok).map(([headId]) => headId)
      const failed = outcome.size - created.length
      setCreatedCount(created.length)
      // Created rows leave the form; failures stay for a retry.
      remove(form.getValues('drafts').flatMap((draft, position) => (created.includes(draft.headId) ? [position] : [])))
      onCreated(created)
      if (failed === 0) toast.success(t('orgDepartments.setup.created', { count: created.length }))
      else toast.error(t('orgDepartments.setup.someFailed', { count: failed }))
    },
  })

  if (departments.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />

  const createdNames = [...results.values()].flatMap((result) => ('department' in result ? [departmentName(result.department, lang)] : []))

  return (
    <section aria-labelledby="setup-names" className="space-y-4">
      <div className="max-w-[72ch] space-y-1.5">
        <h3 id="setup-names" className="text-[1.05em] font-semibold text-foreground">{t('orgDepartments.setup.namesTitle')}</h3>
        <p className="text-[0.88em] text-muted-foreground">{t('orgDepartments.setup.namesIntro')}</p>
      </div>
      <LiveEditsNotice show={limitsOn} />

      {createdCount !== null && createdCount > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-success-soft px-4 py-3 text-[0.88em] text-foreground">
          <Check className="h-5 w-5 shrink-0 text-success" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">{t('orgDepartments.setup.created', { count: createdCount })}</span>
            {createdNames.length > 0 && <> <bdi>{new Intl.ListFormat(lang, { type: 'conjunction' }).format(createdNames)}</bdi></>}
          </p>
        </div>
      )}

      {fields.length === 0 ? (
        createdCount === null && (
          <div className={cn(PANEL, 'px-5 py-6 text-center')}>
            <p className="text-[0.9em] text-muted-foreground">{t('orgDepartments.setup.nothingSelected')}</p>
            <Button variant="outline" className="mt-3 min-h-11" onClick={onBack}>{t('orgDepartments.setup.steps.1')}</Button>
          </div>
        )
      ) : (
        <form onSubmit={form.handleSubmit((values) => create.mutate(values))} noValidate className="space-y-4">
          <ol className={cn(PANEL, 'divide-y divide-hairline')}>
            {fields.map((field, position) => {
              const person = index.byId.get(field.headId)
              const preview = previews[position]
              const failure = results.get(field.headId)
              if (!person || !preview) return null
              const errors = form.formState.errors.drafts?.[position]
              const name = pickEmployeeName(person, lang)
              return (
                <li key={field.id} className="space-y-3 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="break-words text-[0.98em] font-semibold text-foreground">
                        {t('orgDepartments.setup.headedBy', { name: bidi(name) })}
                      </h4>
                      <p className="text-[0.8em] text-muted-foreground">
                        {[personPosition(person, lang), person.duty_unit].filter(Boolean).map((value, index_) => (
                          <span key={index_}>{index_ > 0 && ' · '}<bdi>{value}</bdi></span>
                        ))}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={LINK_BUTTON}
                      disabled={create.isPending}
                      onClick={() => {
                        remove(position)
                        onRemove(field.headId)
                      }}
                    >
                      {t('orgDepartments.setup.removeDraft')}
                    </button>
                  </div>
                  {placed.has(field.headId) && (
                    <p role="alert" className="flex items-start gap-1.5 text-[0.84em] font-medium text-warning">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {t('orgDepartments.headPicker.placedByHand')}
                    </p>
                  )}
                  <DraftNameFields
                    person={person}
                    disabled={create.isPending}
                    fields={{ name_en: form.register(`drafts.${position}.name_en`), name_ar: form.register(`drafts.${position}.name_ar`) }}
                    errors={{ name_en: errors?.name_en?.message, name_ar: errors?.name_ar?.message }}
                    onSuggest={(key, value) => form.setValue(`drafts.${position}.${key}`, value, { shouldValidate: true })}
                  />
                  <section aria-label={t('orgDepartments.preview.title')} className="rounded-xl bg-surface-tinted/60 px-3.5 py-3">
                    <DraftPreviewSummary preview={preview} index={index} departmentsById={departmentsById} draftName={draftName} />
                  </section>
                  {failure && 'message' in failure && (
                    <p role="alert" className="flex items-start gap-1.5 text-[0.86em] font-medium text-accent">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {t('orgDepartments.setup.failed', { message: failure.message })}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
          <StepActions summary={t('orgDepartments.setup.namesSummary', { count: fields.length })}>
            <Button type="button" variant="outline" className="min-h-11" disabled={create.isPending} onClick={onBack}>{t('common.previous')}</Button>
            <Button type="submit" className="min-h-11" disabled={create.isPending || fields.some((field) => placed.has(field.headId))} aria-busy={create.isPending || undefined}>
              {t(create.isPending ? 'orgDepartments.setup.creating' : 'orgDepartments.setup.createSelected', { count: fields.length })}
            </Button>
          </StepActions>
        </form>
      )}
      {fields.length === 0 && createdCount !== null && (
        <StepActions>
          <Button variant="outline" className="min-h-11" onClick={onBack}>{t('orgDepartments.setup.chooseMore')}</Button>
          <Button className="min-h-11" onClick={onNext}>
            {t('orgDepartments.setup.continueConfigure')}
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </Button>
        </StepActions>
      )}
    </section>
  )
}

// ── Step 3: deputies and services ──────────────────────────────────────────

type ServiceResult = { ok: true } | { ok: false; message: string }

function Configure({ onBack, onNext }: { onBack: () => void; onNext: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const { departments, limitsOn } = useOrgData()
  const [showAll, setShowAll] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [services, setServices] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<ServiceMode>('add')
  const [fix, setFix] = useState<{ kind: 'deputy' | 'services'; department: DepartmentRead } | null>(null)
  const [results, setResults] = useState<Map<number, ServiceResult>>(new Map())
  const options = useQuery({ queryKey: ['departments', 'service-options'], queryFn: () => api.departments.serviceOptions() })
  const labels = new Map((options.data ?? []).map((service) => [service.id, serviceLabel(service, lang)]))
  const active = (departments.data ?? []).filter((department) => department.active)
  const needing = active.filter((department) => attentionOf(department).length > 0)
  const listed = showAll ? active : needing
  const targets = active.filter((department) => picked.has(department.id))

  const apply = useMutation({
    mutationFn: async () => {
      const outcome = new Map<number, ServiceResult>()
      for (const department of targets) {
        try {
          await api.departments.setServices(department.id, { service_ids: applyServiceSelection(department.service_ids, [...services], mode) })
          outcome.set(department.id, { ok: true })
        } catch (error) {
          outcome.set(department.id, { ok: false, message: departmentErrorMessage(error, t) })
        }
      }
      return outcome
    },
    onSuccess: (outcome) => {
      invalidateDepartmentData(qc)
      setResults(outcome)
      const failed = [...outcome.values()].filter((result) => !result.ok).length
      if (failed === 0) {
        toast.success(t('orgDepartments.batch.applied', { count: outcome.size }))
        setPicked(new Set())
      } else {
        toast.error(t('orgDepartments.batch.someFailed', { count: failed }))
      }
    },
  })

  if (departments.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />
  if (departments.isError) return <QueryFailure error={departments.error} retry={() => void departments.refetch()} />

  const describe = (ids: readonly string[]): string => ids.length
    ? new Intl.ListFormat(lang, { type: 'conjunction' }).format(ids.map((id) => labels.get(id) ?? id))
    : t('orgDepartments.batch.none')

  return (
    <section aria-labelledby="setup-configure" className="space-y-4">
      <div className="max-w-[72ch] space-y-1.5">
        <h3 id="setup-configure" className="text-[1.05em] font-semibold text-foreground">{t('orgDepartments.setup.configureTitle')}</h3>
        <p className="text-[0.88em] text-muted-foreground">{t('orgDepartments.setup.configureIntro')}</p>
      </div>
      <LiveEditsNotice show={limitsOn} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.88em] font-medium text-foreground">
          {needing.length === 0 ? t('orgDepartments.setup.allReady') : t('orgDepartments.setup.needAttention', { count: needing.length })}
        </p>
        {active.length > needing.length && (
          <button type="button" className={LINK_BUTTON} aria-pressed={showAll} onClick={() => setShowAll((value) => !value)}>
            {t(showAll ? 'orgDepartments.setup.showNeeding' : 'orgDepartments.setup.showAll', { count: active.length })}
          </button>
        )}
      </div>

      {listed.length > 0 && (
        <ul className={cn(PANEL, 'divide-y divide-hairline')}>
          {listed.map((department) => {
            const name = departmentName(department, lang)
            const issues = attentionOf(department)
            const result = results.get(department.id)
            return (
              <li key={department.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-3">
                <input
                  id={`cfg-${department.id}`}
                  type="checkbox"
                  checked={picked.has(department.id)}
                  onChange={(event) => setPicked((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(department.id)
                    else next.delete(department.id)
                    return next
                  })}
                  aria-label={t('orgDepartments.batch.select', { name })}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`cfg-${department.id}`} className="block cursor-pointer break-words text-[0.92em] font-semibold text-foreground"><bdi>{name}</bdi></label>
                  <p className="text-[0.8em] text-muted-foreground">{t('orgDepartments.batch.current', { list: describe(department.service_ids) })}</p>
                  {result && (
                    <p role={'message' in result ? 'alert' : 'status'} className={cn('text-[0.8em] font-medium', 'message' in result ? 'text-accent' : 'text-success')}>
                      {'message' in result ? result.message : t('orgDepartments.batch.rowSaved')}
                    </p>
                  )}
                </div>
                <div className="flex basis-full flex-wrap gap-x-3 ps-7 sm:basis-auto sm:ps-0">
                  {issues.length === 0 && (
                    <span className="inline-flex min-h-11 items-center gap-1.5 text-[0.84em] text-muted-foreground">
                      <Check className="h-4 w-4 text-success" aria-hidden />
                      {t('orgDepartments.attention.ready')}
                    </span>
                  )}
                  {issues.includes('noReceiver') && (
                    <button type="button" className={cn(LINK_BUTTON, 'text-warning')} onClick={() => setFix({ kind: 'deputy', department })}>
                      <AlertTriangle className="h-4 w-4" aria-hidden />
                      {t('orgDepartments.attention.addDeputy')}
                    </button>
                  )}
                  {issues.includes('noServices') && (
                    <button type="button" className={cn(LINK_BUTTON, 'text-warning')} onClick={() => setFix({ kind: 'services', department })}>
                      <AlertTriangle className="h-4 w-4" aria-hidden />
                      {t('orgDepartments.attention.noServices')}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <section aria-labelledby="setup-batch" className={cn(PANEL, 'space-y-3 px-4 py-4')}>
        <h4 id="setup-batch" className="text-[0.98em] font-semibold text-foreground">{t('orgDepartments.batch.title')}</h4>
        <p className="max-w-[72ch] text-[0.84em] text-muted-foreground">{t('orgDepartments.batch.intro')}</p>
        {options.isPending ? <Skeleton className="h-24 w-full rounded-xl" /> : options.isError ? (
          <QueryFailure error={options.error} retry={() => void options.refetch()} />
        ) : (
          <fieldset disabled={apply.isPending} className="space-y-3">
            <legend className="sr-only">{t('orgDepartments.batch.title')}</legend>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {options.data.map((service) => (
                <label key={service.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[0.86em] text-foreground hover:bg-surface-tinted">
                  <input
                    type="checkbox"
                    checked={services.has(service.id)}
                    onChange={(event) => setServices((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(service.id)
                      else next.delete(service.id)
                      return next
                    })}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <span dir="auto">{serviceLabel(service, lang)}</span>
                </label>
              ))}
            </div>
            <div role="radiogroup" aria-label={t('orgDepartments.batch.mode')} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
              {(['add', 'replace'] as const).map((value) => (
                <label key={value} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-[0.86em] text-foreground">
                  <input type="radio" name="batch-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
                  <span>
                    <span className="block font-medium">{t(`orgDepartments.batch.${value}`)}</span>
                    <span className="block text-[0.9em] text-muted-foreground">{t(`orgDepartments.batch.${value}Hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
            {targets.length === 0 ? (
              <p className="text-[0.84em] text-muted-foreground">{t('orgDepartments.batch.pickDepartments')}</p>
            ) : (
              <div className="rounded-xl bg-surface-tinted/60 px-3.5 py-3">
                <p className={cn(LABEL, 'mb-1.5')}>{t('orgDepartments.batch.previewTitle')}</p>
                <ul className="space-y-1 text-[0.84em] text-foreground">
                  {targets.map((department) => (
                    <li key={department.id}>
                      <bdi className="font-medium">{departmentName(department, lang)}</bdi>
                      {': '}
                      {describe(applyServiceSelection(department.service_ids, [...services], mode))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              type="button"
              className="min-h-11"
              disabled={targets.length === 0 || (mode === 'add' && services.size === 0) || apply.isPending}
              aria-busy={apply.isPending || undefined}
              onClick={() => apply.mutate()}
            >
              {t(apply.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.batch.apply', { count: targets.length })}
            </Button>
          </fieldset>
        )}
      </section>

      <StepActions>
        <Button variant="outline" className="min-h-11" onClick={onBack}>{t('common.previous')}</Button>
        <Button className="min-h-11" onClick={onNext}>
          {t('orgDepartments.setup.continueReview')}
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
        </Button>
      </StepActions>

      {fix?.kind === 'deputy' && <DepartmentPeopleDialog department={fix.department} role="deputy" onClose={() => setFix(null)} />}
      {fix?.kind === 'services' && <DepartmentServicesDialog department={fix.department} onClose={() => setFix(null)} />}
    </section>
  )
}

// ── Step 4: review and turn on ─────────────────────────────────────────────

function AccessLimitsReview({ onBack, onDone }: { onBack: () => void; onDone: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const { departmentsById } = useOrgData()
  const [fix, setFix] = useState<{ kind: 'deputy' | 'services'; department: DepartmentRead } | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)
  const [justTurnedOn, setJustTurnedOn] = useState(false)
  // Always the real, current preflight: never a cached answer.
  const scoping = useQuery({ queryKey: ['department-scoping'], queryFn: api.departments.getScoping, refetchOnMount: 'always' })
  const save = useMutation({
    mutationFn: api.departments.setScoping,
    onSuccess: (updated) => {
      qc.setQueryData(['department-scoping'], updated)
      // Scope changes affect all session-bound lists and counts, not just this panel.
      void qc.invalidateQueries()
      setJustTurnedOn(updated.enabled)
      toast.success(t(updated.enabled ? 'orgDepartments.limits.turnedOn' : 'orgDepartments.limits.turnedOff'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })

  if (scoping.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />
  if (scoping.isError) return <QueryFailure error={scoping.error} retry={() => void scoping.refetch()} />
  const report = scoping.data

  const departmentFix = (kind: 'deputy' | 'services', id: number): React.ReactNode => {
    const department = departmentsById.get(id)
    if (!department) return null
    return (
      <button type="button" className={cn(LINK_BUTTON, 'text-[0.95em]')} onClick={() => setFix({ kind, department })}>
        {t(kind === 'deputy' ? 'orgDepartments.attention.addDeputy' : 'orgDepartments.attention.noServices')}
      </button>
    )
  }

  return (
    <section aria-labelledby="setup-review" className="space-y-4">
      <div className="max-w-[72ch] space-y-1.5">
        <h3 id="setup-review" className="text-[1.05em] font-semibold text-foreground">{t(report.enabled ? 'orgDepartments.limits.reviewTitleOn' : 'orgDepartments.limits.reviewTitle')}</h3>
        <p className="text-[0.88em] text-muted-foreground">{t(report.enabled ? 'orgDepartments.limits.reviewIntroOn' : 'orgDepartments.limits.reviewIntro')}</p>
      </div>

      {report.enabled && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-success-soft px-4 py-3 text-[0.9em] text-foreground">
          <Check className="h-5 w-5 shrink-0 text-success" aria-hidden />
          <p className="min-w-0 flex-1 font-semibold">{t('orgDepartments.limits.isOn')}</p>
          {justTurnedOn && <Button className="min-h-11" onClick={onDone}>{t('orgDepartments.limits.return')}</Button>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="limits-changes" className={cn(PANEL, 'space-y-2 px-4 py-4')}>
          <h4 id="limits-changes" className="text-[0.98em] font-semibold text-foreground">{t('orgDepartments.limits.changesTitle')}</h4>
          <ul className="list-disc space-y-1 ps-5 text-[0.86em] text-foreground marker:text-muted-foreground">
            {(['scope', 'branch', 'services'] as const).map((key) => <li key={key}>{t(`orgDepartments.limits.changes.${key}`)}</li>)}
          </ul>
        </section>
        <section aria-labelledby="limits-same" className={cn(PANEL, 'space-y-2 px-4 py-4')}>
          <h4 id="limits-same" className="text-[0.98em] font-semibold text-foreground">{t('orgDepartments.limits.sameTitle')}</h4>
          <ul className="list-disc space-y-1 ps-5 text-[0.86em] text-foreground marker:text-muted-foreground">
            {(['admins', 'own', 'records'] as const).map((key) => <li key={key}>{t(`orgDepartments.limits.same.${key}`)}</li>)}
          </ul>
        </section>
      </div>

      <section aria-labelledby="limits-check" className={cn(PANEL, 'divide-y divide-hairline')}>
        <h4 id="limits-check" className="px-4 py-3 text-[0.98em] font-semibold text-foreground">{t(report.enabled ? 'orgDepartments.limits.checkTitleOn' : 'orgDepartments.limits.checkTitle')}</h4>
        <div className="space-y-1.5 px-4 py-3">
          <p className="text-[0.88em] font-medium text-foreground">{t('orgDepartments.limits.usersWithout', { count: report.users_without_department.length })}</p>
          <p className="text-[0.8em] text-muted-foreground">{t('orgDepartments.limits.usersWithoutHint')}</p>
          {report.users_without_department.length > 0 && (
            <ul className="divide-y divide-hairline text-[0.86em]">
              {report.users_without_department.map((user) => (
                <li key={user.user_id} className="flex flex-wrap items-center justify-between gap-x-3 py-1">
                  <span className="min-w-0"><bdi>{user.display_name}</bdi> <bdi dir="ltr" className="text-muted-foreground">{user.email}</bdi></span>
                  {has('users.manage') && <Link className={cn(LINK_BUTTON, 'text-[0.95em]')} to={`/permissions?user=${user.user_id}`}>{t('orgDepartments.limits.reviewAccount')}</Link>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {(['departments_without_receiver', 'departments_without_services'] as const).map((key) => (
          <div key={key} className="space-y-1.5 px-4 py-3">
            <p className="text-[0.88em] font-medium text-foreground">{t(`orgDepartments.limits.${key}`, { count: report[key].length })}</p>
            {report[key].length > 0 && (
              <ul className="divide-y divide-hairline text-[0.86em]">
                {report[key].map((department) => (
                  <li key={department.id} className="flex flex-wrap items-center justify-between gap-x-3 py-1">
                    <bdi>{departmentName(department, lang)}</bdi>
                    {departmentFix(key === 'departments_without_receiver' ? 'deputy' : 'services', department.id)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className="px-4 py-3 text-[0.8em] text-muted-foreground">{t('orgDepartments.limits.warningsOnly')}</p>
      </section>

      <StepActions>
        <Button variant="outline" className="min-h-11" onClick={onBack}>{t('common.previous')}</Button>
        {report.enabled ? (
          <Button variant="outline" className="min-h-11" disabled={save.isPending} onClick={() => setConfirmOff(true)}>
            {t('orgDepartments.limits.turnOff')}
          </Button>
        ) : (
          <Button
            className="min-h-11"
            disabled={save.isPending || scoping.isFetching}
            aria-busy={save.isPending || undefined}
            onClick={() => {
              // Re-check right before acting: the preflight may have changed while the page was open.
              void scoping.refetch().then((result) => { if (result.isSuccess && !result.data.enabled) save.mutate(true) })
            }}
          >
            {t(save.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.limits.turnOn')}
          </Button>
        )}
      </StepActions>

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={t('orgDepartments.limits.confirmOff')}
        description={t('orgDepartments.limits.offWarning')}
        confirmLabel={t('orgDepartments.limits.turnOff')}
        destructive
        onConfirm={() => { if (!save.isPending) save.mutate(false) }}
      />
      {fix?.kind === 'deputy' && <DepartmentPeopleDialog department={fix.department} role="deputy" onClose={() => setFix(null)} />}
      {fix?.kind === 'services' && <DepartmentServicesDialog department={fix.department} onClose={() => setFix(null)} />}
    </section>
  )
}
