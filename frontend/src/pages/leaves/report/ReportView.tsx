/**
 * ReportView — the Records page's printable leave report: an options panel at
 * the inline start and the paper beside it, exactly as it prints, under one
 * row of actions (Print / Save PDF / Send). «Save PDF» saves that same sheet,
 * printed to a file by the server's browser (no print dialog).
 *
 * It opens with the register's filters (`seed`) and keeps its own choices
 * after that, so shaping a report never disturbs the register. Rows come from
 * the register's already-fetched list; nothing is refetched. `paperOnly`
 * renders just the paper, hidden on screen: the register's Ctrl+P path.
 *
 * Rejected and cancelled leaves are not days taken, so they count only when
 * the operator picks those statuses explicitly.
 */
import { useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { FileDown, Loader2, PenLine, Printer } from 'lucide-react'
import { toast } from '@/lib/toast'

import { api, apiErrorMessage, type LeaveListItem } from '@/lib/api'
import { isQuickActionAllowed } from '@/lib/dashboardLayout'
import { UNASSIGNED, unitOptions } from '@/lib/dutyUnits'
import { useCapabilities } from '@/lib/useCapabilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { LeaveEmployeePicker } from '../LeaveEmployeePicker'
import { canonStatus } from '../lifecycle'
import { leaveEmployeeName } from '../leaveEmployeeName'
import {
  CHIP_BASE, CHIP_OFF, CHIP_ON, FIELD_LABEL, NATIVE_SELECT, SEGMENT_BUTTON, SEGMENT_GROUP,
  SEGMENT_OFF, SEGMENT_ON, WORKFLOW_STATUSES, toggleItem,
} from './controls'
import { dateLocale, fmtDayMonthYear, fmtMonthYear } from './fmt'
import { CANONICAL_KINDS, kindMeta, type KindId } from './kinds'
import {
  applyScope, buildReportSections, isDeparted, matchesCompany, matchesStaff, periodWindow,
  type MonthRef, type ReportPeriod, type ReportSort, type StaffFilter,
} from './reportData'
import { filedSubject, reportBodyHtml, type FiledScope } from './reportDocument'
import { SendReportDialog } from './SendReportDialog'
import { EmployeeReportDetails } from './EmployeeReportDetails'
import { ReportPaper } from './ReportPaper'

/** The register's filters at the moment the report opens. */
export interface ReportSeed {
  kinds: KindId[]
  statuses: string[]
  employeeId: string | null
  month: MonthRef | null
}

const PERIOD_MODES: ReportPeriod['mode'][] = ['month', 'range', 'year']
const STAFF_OPTIONS: StaffFilter[] = ['all', 'ours', 'loaned']
/** Sort choices, labelled with the paper's own column headings. */
const SORT_LABEL_KEYS: Record<ReportSort['key'], string> = {
  days: 'leaves.report.colTotalDays',
  name: 'leaves.report.colName',
  id: 'leaves.report.colId',
  unit: 'leaves.report.colUnit',
}
const NOT_TAKEN = ['Rejected', 'Cancelled']

interface ReportViewProps {
  all: LeaveListItem[]
  today: string
  seed: ReportSeed
  paperOnly?: boolean
}

export function ReportView({ all, today, seed, paperOnly = false }: ReportViewProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const ids = useId()

  const [periodMode, setPeriodMode] = useState<ReportPeriod['mode']>(seed.month ? 'month' : 'year')
  const [month, setMonth] = useState(
    seed.month
      ? `${seed.month.year}-${String(seed.month.monthIndex + 1).padStart(2, '0')}`
      : today.slice(0, 7),
  )
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [year, setYear] = useState(seed.month?.year ?? Number(today.slice(0, 4)))
  const [kinds, setKinds] = useState(seed.kinds)
  const [statuses, setStatuses] = useState(seed.statuses)
  const [employeeId, setEmployeeId] = useState(seed.employeeId)
  const [staff, setStaff] = useState<StaffFilter>('all')
  const [company, setCompany] = useState<string | null>(null)
  const [excludeDeparted, setExcludeDeparted] = useState(true)
  const [sort, setSort] = useState<ReportSort>({ key: 'days', dir: 'desc' })
  const [withSignatures, setWithSignatures] = useState(false)

  const { period, picked, sections } = useMemo(() => {
    const period: ReportPeriod =
      periodMode === 'year'
        ? { mode: 'year', year }
        : periodMode === 'month'
          ? { mode: 'month', month }
          : { mode: 'range', from, to }
    const picked = applyScope(all, { month: null, employeeId, kinds, statuses, q: '' }).filter(
      (r) =>
        matchesStaff(r, staff) &&
        matchesCompany(r, company) &&
        !(excludeDeparted && isDeparted(r)) &&
        (statuses.length > 0 || !NOT_TAKEN.includes(canonStatus(r.status))),
    )
    const sections = buildReportSections(picked, period, sort, (r) => leaveEmployeeName(r, i18n.language), i18n.language)
    return { period, picked, sections }
  }, [all, periodMode, year, month, from, to, employeeId, kinds, statuses, staff, company, excludeDeparted, sort, i18n.language])

  const companies = useMemo(() => unitOptions(all.map((r) => ({ duty_unit: r.employee_duty_unit }))), [all])

  const years = useMemo(
    () =>
      [...new Set([Number(today.slice(0, 4)), ...all.map((r) => Number(r.start_date.slice(0, 4)))])].sort(
        (a, b) => b - a,
      ),
    [all, today],
  )

  const employeeRow = employeeId ? all.find((r) => r.employee_id === employeeId) : undefined
  // The report's scope in the UI language, for the paper.
  const describe = (tt: TFunction, lang: string) => {
    const loc = dateLocale(lang)
    const range = tt('leaves.report.rangeLabel', {
      from: from ? fmtDayMonthYear(from, loc) : '…',
      to: to ? fmtDayMonthYear(to, loc) : '…',
    })
    // Each sheet names its own month; the facts carry the wider period only
    // when it spans more than one month.
    const periodLabel = periodMode === 'year' ? String(year) : periodMode === 'range' && (from || to) ? range : null
    const employeeName = employeeRow ? leaveEmployeeName(employeeRow, lang) : employeeId
    const companyName = company === UNASSIGNED ? tt('dutyLocations.unassigned') : company
    return {
      periodLabel,
      // The saved PDF's name: period, then company or employee when scoped.
      fileScope: [periodMode === 'month' ? month && fmtMonthYear(month, loc) : periodLabel, companyName, employeeName]
        .filter(Boolean)
        .join(' — '),
      facts: [
        periodLabel,
        staff !== 'all' && tt(`leaves.report.staff.${staff}`),
        companyName,
        excludeDeparted && tt('leaves.report.departedExcluded'),
        statuses.map((s) => tt(`leaves.status.${s}`)).join(', '),
        employeeName,
      ].filter((f): f is string => !!f),
      title: tt('leaves.report.paperTitle', {
        topic:
          kinds.length > 0
            ? kinds.map((k) => tt(kindMeta(k).i18nKey)).join(', ')
            : tt('leaves.report.allKinds'),
      }),
    }
  }
  const { periodLabel, facts, title, fileScope } = describe(t, i18n.language)
  // The filed General Book is always Arabic, like the book itself.
  const arT = i18n.getFixedT('ar')
  const filedScope: FiledScope = {
    period,
    company: company === UNASSIGNED ? arT('dutyLocations.unassigned') : company || undefined,
    employee: employeeId
      ? { id: employeeId, name: employeeRow ? leaveEmployeeName(employeeRow, 'ar') : employeeId }
      : undefined,
    limits: [
      ...kinds.map((k) => arT(kindMeta(k).i18nKey)),
      ...(staff !== 'all' ? [arT(`leaves.report.staff.${staff}`)] : []),
      ...statuses.map((s) => arT(`leaves.status.${s}`)),
    ],
  }

  const { has } = useCapabilities()
  const canSend =
    isQuickActionAllowed('General Book', has) &&
    has('books.category.6/1') &&
    has('books.submit') &&
    has('books.edit')
  const [sending, setSending] = useState(false)
  const { data: emp } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api.getEmployee(employeeId ?? ''),
    enabled: !!employeeId,
  })
  const buildBody = (): string =>
    reportBodyHtml({
      t: arT,
      lang: 'ar',
      locale: dateLocale('ar'),
      scope: filedScope,
      sections,
      rows: picked,
      window: periodWindow(period),
      employee: employeeId ? { emp, all, today } : undefined,
    })
  // «Save PDF» posts the very sheet «Print» prints; the server's own browser
  // prints it, so the file matches the print without a print dialog.
  const sheetRef = useRef<HTMLDivElement>(null)
  const savePdf = useMutation({
    onMutate: () => toast.loading(t('leaves.report.savingPdf')),
    mutationFn: () =>
      api.leaveReportPdf({
        html: sheetRef.current?.querySelector('.print-leave-report')?.outerHTML ?? '',
        lang: i18n.language.startsWith('ar') ? 'ar' : 'en',
      }),
    onSuccess: (blob, _vars, toastId) => {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      // Characters Windows rejects and bidi controls (a pasted RLE/LRM reorders
      // the whole name in the download bar) become spaces.
      anchor.download = `${t('leaves.report.pdfFilename', { scope: fileScope, date: today })
        // eslint-disable-next-line no-control-regex
        .replace(/[\\/:*?"<>|\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/(?:\s*—\s*){2,}/g, ' — ') // an empty scope leaves one separator, not two
        .trim()}.pdf`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0) // Firefox cancels a download revoked before it starts
      toast.success(t('leaves.report.pdfSaved'), { id: toastId })
    },
    onError: (err, _vars, toastId) => toast.error(apiErrorMessage(err), { id: toastId }),
  })

  const paper = (
    <ReportPaper
      sections={sections}
      title={title}
      facts={facts}
      emptyHeading={periodLabel ?? title}
      today={today}
      signatures={withSignatures}
      lead={
        employeeId
          ? {
              // The name is already in the facts line and the card; a long
              // name as the sheet heading would crush the letterhead.
              heading: t('leaves.report.empDetails'),
              body: (
                <EmployeeReportDetails
                  employeeId={employeeId}
                  all={all}
                  rows={picked}
                  window={periodWindow(period)}
                  today={today}
                />
              ),
            }
          : undefined
      }
      onScreen={!paperOnly}
    />
  )
  if (paperOnly) return paper

  return (
    <div className="grid grid-cols-[19rem_minmax(0,1fr)] items-start gap-6 max-lg:grid-cols-1 print:block">
      {/* Sticky in the tab's scroll box; 21rem ≈ shell + page header + view toolbar + bottom padding, so the
          panel's own scrollbar keeps every option reachable at any scroll position of the paper. */}
      <section
        aria-label={t('leaves.report.optionsLabel')}
        className="flex flex-col gap-5 rounded-2xl border border-hairline bg-surface p-4 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-21rem)] lg:overflow-y-auto"
        data-print-hide
      >
        <fieldset className="min-w-0">
          <legend className={FIELD_LABEL}>{t('leaves.report.optPeriod')}</legend>
          <div className={cn(SEGMENT_GROUP, 'mb-2')}>
            {PERIOD_MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={periodMode === m}
                onClick={() => setPeriodMode(m)}
                className={cn(SEGMENT_BUTTON, 'flex-1 justify-center whitespace-nowrap px-2', periodMode === m ? SEGMENT_ON : SEGMENT_OFF)}
              >
                {t(`leaves.report.period_${m}`)}
              </button>
            ))}
          </div>
          {periodMode === 'month' && (
            <Input
              type="month"
              aria-label={t('leaves.report.period_month')}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 font-mono tabular-nums"
            />
          )}
          {periodMode === 'range' && (
            // The bounds cap each other, so a range can't be inverted into a
            // silently empty report.
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-2 text-[0.8em] text-muted-foreground">
              <span>{t('leaves.report.rangeFrom')}</span>
              <Input
                type="date"
                aria-label={t('leaves.report.rangeFrom')}
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 font-mono tabular-nums"
              />
              <span>{t('leaves.report.rangeTo')}</span>
              <Input
                type="date"
                aria-label={t('leaves.report.rangeToLabel')}
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 font-mono tabular-nums"
              />
            </div>
          )}
          {periodMode === 'year' && (
            <select
              aria-label={t('leaves.report.period_year')}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className={cn(NATIVE_SELECT, 'w-full')}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        <fieldset className="min-w-0">
          <legend className={FIELD_LABEL}>{t('leaves.report.colKind')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {CANONICAL_KINDS.map((k) => {
              const active = kinds.includes(k.id)
              return (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setKinds(toggleItem(kinds, k.id))}
                  className={cn(CHIP_BASE, 'gap-1', active ? CHIP_ON : CHIP_OFF)}
                >
                  <span aria-hidden="true">{k.emoji}</span>
                  {t(k.i18nKey)}
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className={FIELD_LABEL}>{t('leaves.report.optStaff')}</legend>
          <div className={SEGMENT_GROUP}>
            {STAFF_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={staff === s}
                onClick={() => setStaff(s)}
                className={cn(SEGMENT_BUTTON, 'flex-1 justify-center whitespace-nowrap px-2', staff === s ? SEGMENT_ON : SEGMENT_OFF)}
              >
                {t(`leaves.report.staff.${s}`)}
              </button>
            ))}
          </div>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-[0.85em] text-foreground">
            <input
              type="checkbox"
              checked={excludeDeparted}
              onChange={(e) => setExcludeDeparted(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            {t('leaves.report.excludeDeparted')}
          </label>
        </fieldset>

        <div className="min-w-0">
          <label htmlFor={`${ids}-company`} className={FIELD_LABEL}>
            {t('leaves.report.optCompany')}
          </label>
          <select
            id={`${ids}-company`}
            value={company ?? ''}
            onChange={(e) => setCompany(e.target.value || null)}
            className={cn(NATIVE_SELECT, 'w-full')}
          >
            <option value="">{t('leaves.report.allCompanies')}</option>
            {[...companies, UNASSIGNED].map((c) => (
              <option key={c} value={c}>
                {c === UNASSIGNED ? t('dutyLocations.unassigned') : c}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="min-w-0">
          <legend className={FIELD_LABEL}>{t('leaves.columns.status')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {WORKFLOW_STATUSES.map((s) => {
              const active = statuses.includes(s)
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatuses(toggleItem(statuses, s))}
                  className={cn(CHIP_BASE, active ? CHIP_ON : CHIP_OFF)}
                >
                  {t(`leaves.status.${s}`)}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="min-w-0">
          <span className={FIELD_LABEL}>{t('leaves.columns.employee')}</span>
          <LeaveEmployeePicker selectedId={employeeId} onSelect={setEmployeeId} />
        </div>

        <div>
          <label htmlFor={`${ids}-sort`} className={FIELD_LABEL}>
            {t('leaves.report.optSort')}
          </label>
          <div className="flex gap-2">
            <select
              id={`${ids}-sort`}
              value={sort.key}
              onChange={(e) => setSort({ ...sort, key: e.target.value as ReportSort['key'] })}
              className={cn(NATIVE_SELECT, 'min-w-0 flex-1')}
            >
              {(Object.keys(SORT_LABEL_KEYS) as ReportSort['key'][]).map((k) => (
                <option key={k} value={k}>
                  {t(SORT_LABEL_KEYS[k])}
                </option>
              ))}
            </select>
            <select
              aria-label={t('leaves.report.optSortDir')}
              value={sort.dir}
              onChange={(e) => setSort({ ...sort, dir: e.target.value as ReportSort['dir'] })}
              className={NATIVE_SELECT}
            >
              <option value="desc">{t('leaves.report.sortDesc')}</option>
              <option value="asc">{t('leaves.report.sortAsc')}</option>
            </select>
          </div>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-[0.85em] text-foreground">
          <input
            type="checkbox"
            checked={withSignatures}
            onChange={(e) => setWithSignatures(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {t('leaves.report.includeSignatures')}
        </label>
        <SendReportDialog
          open={sending}
          onOpenChange={setSending}
          subject={filedSubject(arT, dateLocale('ar'), filedScope)}
          scope={facts}
          buildBody={buildBody}
        />
      </section>

      <div ref={sheetRef} className="flex min-w-0 flex-col gap-4 print:block">
        {/* Same width as the sheet, so the row starts at the paper's edge. */}
        <div className="mx-auto flex w-full max-w-[210mm] flex-wrap items-center gap-2 print:hidden" data-print-hide>
          <Button type="button" disabled={sections.length === 0 && !employeeId} onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden />
            {t('leaves.report.print')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={(sections.length === 0 && !employeeId) || savePdf.isPending}
            aria-busy={savePdf.isPending || undefined}
            onClick={() => savePdf.mutate()}
          >
            {savePdf.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <FileDown className="h-4 w-4" aria-hidden />
            )}
            {t('leaves.report.savePdf')}
          </Button>
          {canSend && (
            <Button
              type="button"
              variant="secondary"
              disabled={sections.length === 0 && !employeeId}
              onClick={() => setSending(true)}
            >
              <PenLine className="h-4 w-4" aria-hidden />
              {t('leaves.report.sendTitle')}
            </Button>
          )}
        </div>
        {paper}
      </div>
    </div>
  )
}
