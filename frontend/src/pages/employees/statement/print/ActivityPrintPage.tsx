/**
 * `/employees/:id/activity/print`: print setup for the activity statement
 * (mockup frames 2 and 3). Settings live in the URL query (`printSettings.ts`),
 * so a setup reloads intact and Back leaves the page.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import { siteToday } from '@/components/employees/useAttendanceAttention'
import { Button } from '@/components/ui/button'
import { usePrintFilename } from '@/hooks/usePrintFilename'
import { api } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { useCapabilities } from '@/lib/useCapabilities'

import {
  ACTIVITY_PRESETS,
  STATEMENT_CATEGORIES,
  activityPeriod,
  categoryOf,
  formatStatementRange,
  type StatementCategory,
} from '../statementModel'
import { ActivityPaper } from './ActivityPaper'
import { PrintSetupShell, SetupNotice } from './PrintSetupShell'
import { activitySearch, parseActivitySettings, type ActivitySettings } from './printSettings'
import { DateField, LanguageAndPaper, OptionRow, SetupFieldset } from './SetupControls'
import { usePaperIssue, useStatementPrint } from './statementPrintFlow'

export function ActivityPrintPage(): React.JSX.Element {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const today = siteToday()
  const ui = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const settings = useMemo(() => parseActivitySettings(params, today, i18n.language), [params, today, i18n.language])
  const search = activitySearch(settings)
  const update = (patch: Partial<ActivitySettings>): void =>
    setParams(activitySearch({ ...settings, ...patch }), { replace: true })

  const employee = useQuery({
    queryKey: ['employee-detail', id, has('employees.view') && has('leaves.view')],
    queryFn: () => api.getEmployeeDetail(id),
    enabled: id !== '',
  })
  const statement = useQuery({
    queryKey: ['activity-statement', id, settings.from, settings.to],
    queryFn: () =>
      api.getActivityStatement(id, { ...(settings.from ? { from_date: settings.from } : {}), to_date: settings.to }),
    enabled: id !== '',
    staleTime: 60_000,
  })

  const items = useMemo(() => statement.data?.items ?? [], [statement.data])
  const counts = useMemo(() => {
    const map = new Map<StatementCategory, number>()
    for (const item of items) map.set(categoryOf(item.kind), (map.get(categoryOf(item.kind)) ?? 0) + 1)
    return map
  }, [items])
  const included = STATEMENT_CATEGORIES.filter((c) => settings.cats.includes(c))
  const entries = included.reduce((sum, c) => sum + (counts.get(c) ?? 0), 0)

  const flow = useStatementPrint(id, search)
  const issue = usePaperIssue(flow.issued, settings.lang)
  const paperT = i18n.getFixedT(settings.lang)
  usePrintFilename(`${paperT('statementPrint.paper.activityTitle')} ${id} ${settings.to}`)

  const range = (from: string | null, to: string, lang: string): string =>
    formatStatementRange(from, to, lang, i18n.getFixedT(lang)('statementPrint.recordStart'))
  const emp = employee.data?.employee
  const ready = !!emp && statement.isSuccess

  const settingsColumn = (
    <>
      <SetupFieldset legend={t('statementPrint.period')}>
        {ACTIVITY_PRESETS.map((preset) => {
          const period = activityPeriod(preset, today)
          return (
            <OptionRow
              key={preset}
              type="radio"
              name="activity-period"
              checked={settings.preset === preset}
              onChange={() => update({ preset, ...(period ?? {}) })}
              label={t(`statement.period.${preset}`)}
              detail={period ? range(period.from, period.to, ui) : undefined}
            />
          )
        })}
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          <DateField
            label={t('statementPrint.from')}
            value={settings.from ?? ''}
            max={today}
            onChange={(from) => update({ preset: 'custom', from })}
          />
          <DateField
            label={t('statementPrint.to')}
            value={settings.to}
            max={today}
            onChange={(to) => update({ preset: 'custom', to, from: settings.from ?? to })}
          />
        </div>
      </SetupFieldset>

      <SetupFieldset legend={t('statementPrint.sections')}>
        {STATEMENT_CATEGORIES.map((c) => (
          <OptionRow
            key={c}
            type="checkbox"
            checked={settings.cats.includes(c)}
            onChange={(on) => update({ cats: on ? [...settings.cats, c] : settings.cats.filter((x) => x !== c) })}
            label={t(`statement.section.${c}`)}
            detail={statement.isSuccess ? <span className="font-mono">{counts.get(c) ?? 0}</span> : undefined}
          />
        ))}
        <div className="mt-1.5 flex gap-1.5">
          <Button variant="secondary" size="xs" onClick={() => update({ cats: [...STATEMENT_CATEGORIES] })}>
            {t('statementPrint.all')}
          </Button>
          <Button variant="secondary" size="xs" onClick={() => update({ cats: [] })}>
            {t('statementPrint.none')}
          </Button>
        </div>
      </SetupFieldset>

      <SetupFieldset legend={t('statementPrint.onPage')}>
        <OptionRow
          type="checkbox"
          checked={settings.summary}
          onChange={(summary) => update({ summary })}
          label={t('statementPrint.summaryTable')}
        />
        <OptionRow
          type="checkbox"
          checked={settings.sign}
          onChange={(sign) => update({ sign })}
          label={t('statementPrint.signPreparedBy')}
        />
      </SetupFieldset>

      <LanguageAndPaper
        lang={settings.lang}
        orient={settings.orient}
        languageHint={t('statementPrint.languageHint')}
        onChange={update}
      />
    </>
  )

  const notices = (
    <>
      {statement.isError && (
        <SetupNotice
          tone="error"
          action={
            <Button variant="secondary" size="xs" onClick={() => void statement.refetch()}>
              {t('statementPrint.retry')}
            </Button>
          }
        >
          {t('statementPrint.loadFailed')}
        </SetupNotice>
      )}
      {employee.isError && <SetupNotice tone="error">{t('statementPrint.employeeFailed')}</SetupNotice>}
      {statement.data?.truncated && <SetupNotice>{t('statementPrint.truncated')}</SetupNotice>}
    </>
  )

  return (
    <PrintSetupShell
      backTo={`/employees/${encodeURIComponent(id)}?tab=activity`}
      backLabel={t('statementPrint.backToActivity')}
      title={t('activityStatement.printAction')}
      employeeLine={
        emp ? (
          <>
            <bdi>{pickEmployeeName(emp, i18n.language)}</bdi> · <bdi className="font-mono">{emp.id}</bdi>
          </>
        ) : (
          <bdi className="font-mono">{id}</bdi>
        )
      }
      canPrint={ready}
      printPending={flow.pending}
      printError={flow.error}
      onPrint={() =>
        flow.print({
          kind: 'activity',
          from_date: settings.from,
          to_date: settings.to,
          language: settings.lang,
          options: {
            categories: included,
            summary: settings.summary,
            signature: settings.sign,
            orientation: settings.orient,
          },
        })
      }
      settings={settingsColumn}
      notices={notices}
      orient={settings.orient}
      paperKey={`${search}|${statement.dataUpdatedAt}|${flow.issued?.reference ?? ''}|${emp ? 1 : 0}`}
      result={(pages) => (
        <>
          <b className="text-[15px] text-primary">{t('statementPrint.resultEntries', { count: entries })}</b>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('statementPrint.resultActivity', {
              sections: t('statementPrint.resultSections', { count: included.length }),
              pages: t('statementPrint.resultPages', { count: pages }),
              orientation: t(`statementPrint.${settings.orient}`),
            })}
          </p>
        </>
      )}
      paper={
        emp && statement.isSuccess ? (
          <ActivityPaper
            frame={{
              employee: emp,
              issue,
              period: range(settings.from, settings.to, settings.lang),
              sourceUrl: `${window.location.origin}/employees/${emp.id}?tab=activity`,
            }}
            settings={settings}
            items={items}
            categories={STATEMENT_CATEGORIES}
          />
        ) : (
          <div className="grid h-[297mm] w-[210mm] place-items-center bg-white text-sm text-neutral-600">
            {employee.isError || statement.isError ? t('statementPrint.notReady') : t('statementPrint.loading')}
          </div>
        )
      }
    />
  )
}
