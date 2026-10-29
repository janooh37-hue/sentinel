/**
 * The printed activity statement (mockup frame 3). Each fact is said once:
 * the summary lists only categories with entries, included-but-empty
 * categories share one quiet line, and only categories with entries get a
 * table. Every table reads Date, what, detail, reference, who.
 */

import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'

import type { EmployeeRead } from '@/lib/api'
import { englishPart, splitBilingual } from '@/lib/bilingualValue'
import { displayViolationValue } from '@/lib/violationTypes'

import type { ActivityStatementItem } from '../statementTypes'
import { categoryOf, formatStatementDate, type StatementCategory } from '../statementModel'
import { paperActor, stripOwnName } from './paperText'
import type { ActivitySettings } from './printSettings'
import { tableBlocks, usePaperT, type Column, type ColumnKind, type TableRow } from './paperBlocks'
import { Mono, NoteLine, ScopeLine, SignatureBlocks, StatementSheet, type PaperFrame } from './StatementLetterhead'

interface Props {
  frame: Omit<PaperFrame, 'title' | 'lineTotal' | 'lang' | 'orient'>
  settings: ActivitySettings
  /** Every item in the period, all categories. */
  items: ActivityStatementItem[]
  /** Order the categories print in. */
  categories: readonly StatementCategory[]
}

function Sub({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="st-sub">{children}</span>
}

function leaveDays(items: ActivityStatementItem[]): number {
  return items.reduce((sum, item) => sum + (item.days ?? 0), 0)
}

function sectionRows(
  category: StatementCategory,
  items: ActivityStatementItem[],
  lang: 'ar' | 'en',
  t: TFunction,
  employee: EmployeeRead,
): { columns: Column[]; rows: TableRow[] } {
  const date = (iso: string | null): string => (iso ? formatStatementDate(iso.slice(0, 10), lang) : '-')
  const by = (item: ActivityStatementItem): ReactNode => <bdi>{paperActor(item.actor_name, t) || '-'}</bdi>
  const col = (key: string, kind: ColumnKind = 'text'): Column => ({
    label: t(`statementPrint.paper.col.${key}`),
    kind,
  })
  const key = (item: ActivityStatementItem): string => `${item.kind}-${item.source_id}`
  switch (category) {
    case 'leave': {
      // Newest first, by when the leave starts.
      const sorted = [...items].sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''))
      const rows: TableRow[] = sorted.map((item) => ({
        key: key(item),
        cells: [
          date(item.start_date),
          date(item.end_date),
          // Legacy rows store "Annual Leave - <ar>"; the key is the English side.
          item.leave_type
            ? t(`leaves.type.${englishPart(item.leave_type)}`, { defaultValue: splitBilingual(item.leave_type, lang) })
            : '-',
          String(item.days ?? '-'),
          item.leave_status
            ? t(`leaves.status.${englishPart(item.leave_status)}`, {
                defaultValue: splitBilingual(item.leave_status, lang),
              })
            : '-',
        ],
      }))
      rows.push({
        key: 'total',
        total: true,
        cells: [t('statementPrint.paper.total'), '', '', String(leaveDays(items)), ''],
      })
      return {
        columns: [col('from', 'date'), col('to', 'date'), col('type'), col('days', 'num'), col('status', 'short')],
        rows,
      }
    }
    case 'violation':
      return {
        columns: [col('date', 'date'), col('violation'), col('penalty'), col('recordedBy', 'short')],
        rows: items.map((item) => ({
          key: key(item),
          cells: [
            date(item.occurred_at),
            <>
              <bdi>{item.violation_type ? displayViolationValue(item.violation_type, lang === 'ar') : '-'}</bdi>
              {item.description && <Sub>{item.description}</Sub>}
            </>,
            <>
              <bdi>{item.action_taken ?? '-'}</bdi>
              {item.deduction_days ? (
                <Sub>{t('statementPrint.paper.deduction', { count: item.deduction_days })}</Sub>
              ) : null}
            </>,
            by(item),
          ],
        })),
      }
    case 'absence':
      return {
        columns: [col('date', 'date'), col('note'), col('recordedBy', 'short')],
        rows: items.map((item) => ({
          key: key(item),
          cells: [date(item.occurred_at), <bdi key="n">{item.note ?? '-'}</bdi>, by(item)],
        })),
      }
    case 'document':
      return {
        columns: [col('date', 'date'), col('document'), col('reference', 'ref'), col('recordedBy', 'short')],
        rows: items.map((item) => ({
          key: key(item),
          cells: [
            date(item.occurred_at),
            <bdi key="d">
              {(lang === 'ar' ? item.template_name_ar : item.template_name_en) ??
                item.template_name_en ??
                item.template_id ??
                '-'}
            </bdi>,
            item.reference ? <Mono>{item.reference}</Mono> : '-',
            by(item),
          ],
        })),
      }
    case 'ledger':
      return {
        columns: [
          col('date', 'date'),
          col('subject'),
          col('direction', 'short'),
          col('counterparty', 'short'),
          col('reference', 'ref'),
          col('recordedBy', 'short'),
        ],
        rows: items.map((item) => {
          const counterparty = paperActor(item.counterparty, t)
          const actor = paperActor(item.actor_name, t)
          // Said once: when the counterparty is also who recorded it, the
          // recorded-by cell stays empty (the column keeps its place).
          const sameParty = !!counterparty && counterparty.toLowerCase() === actor.toLowerCase()
          return {
            key: key(item),
            cells: [
              date(item.occurred_at),
              <bdi key="s">{item.subject ? stripOwnName(item.subject, employee) : '-'}</bdi>,
              item.direction ? t(`ledger.direction.${item.direction}`, { defaultValue: item.direction }) : '-',
              <bdi key="c">{counterparty || '-'}</bdi>,
              item.reference ? <Mono>{item.reference}</Mono> : '-',
              sameParty ? '' : <bdi key="b">{actor || '-'}</bdi>,
            ],
          }
        }),
      }
    case 'placement':
      return {
        columns: [col('date', 'date'), col('event', 'short'), col('detail'), col('recordedBy', 'short')],
        rows: items.map((item) => ({
          key: key(item),
          cells: [date(item.occurred_at), ...placementCells(item, lang, t), by(item)],
        })),
      }
  }
}

function placementCells(item: ActivityStatementItem, lang: 'ar' | 'en', t: TFunction): ReactNode[] {
  const place = (dept: string | null, unit: string | null, post: string | null): string =>
    [dept, unit, post].filter(Boolean).join(', ') || '-'
  if (item.kind === 'duty_location') {
    const to = place(item.to_department, item.to_unit, item.to_post)
    const event = item.event_type
      ? t(`employees.activity.dutyLocation.${item.event_type}`, { defaultValue: item.event_type })
      : '-'
    const detail =
      item.event_type === 'transfer'
        ? t('statementPrint.paper.fromTo', { from: place(item.from_department, item.from_unit, item.from_post), to })
        : to
    return [
      event,
      <>
        <bdi>{detail}</bdi>
        {item.reason && <Sub>{item.reason}</Sub>}
      </>,
    ]
  }
  const status = (value: string | null): string =>
    value ? t(`employees.status.${value}`, { defaultValue: value }) : '-'
  const kind = item.status_event_kind ?? 'changed'
  const date = (iso: string | null): string => (iso ? formatStatementDate(iso, lang) : '')
  // Same dispatch as StatusActivity: a scheduled change has not happened yet,
  // and a cancelled one never happened, so neither is printed as a change.
  if (kind === 'scheduled_cancelled') {
    return [
      t('statementPrint.paper.statusCancelled'),
      <>
        {t('statementPrint.paper.statusCancelledDetail', { to: status(item.to_status) })}
        {item.reason && <Sub>{item.reason}</Sub>}
      </>,
    ]
  }
  const facts = [
    item.effective_date &&
      t(kind === 'scheduled' ? 'statementPrint.paper.scheduledFor' : 'statementPrint.paper.effective', {
        date: date(item.effective_date),
      }),
    item.site,
    item.return_date && t('statementPrint.paper.returnDate', { date: date(item.return_date) }),
  ].filter(Boolean)
  return [
    t(kind === 'scheduled' ? 'statementPrint.paper.statusScheduled' : 'statementPrint.paper.statusChange'),
    <>
      {item.from_status
        ? t('statementPrint.paper.fromTo', { from: status(item.from_status), to: status(item.to_status) })
        : status(item.to_status)}
      {facts.length > 0 && <Sub>{facts.join(' · ')}</Sub>}
      {item.reason && <Sub>{item.reason}</Sub>}
    </>,
  ]
}

export function ActivityPaper({ frame, settings, items, categories }: Props): React.JSX.Element {
  const t = usePaperT(settings.lang)
  const included = categories.filter((c) => settings.cats.includes(c))
  const excluded = categories.filter((c) => !settings.cats.includes(c))
  const byCategory = new Map<StatementCategory, ActivityStatementItem[]>()
  for (const item of items) {
    const c = categoryOf(item.kind)
    byCategory.set(c, [...(byCategory.get(c) ?? []), item])
  }
  const itemsOf = (c: StatementCategory): ActivityStatementItem[] => byCategory.get(c) ?? []
  const withEntries = included.filter((c) => itemsOf(c).length > 0)
  const empty = included.filter((c) => itemsOf(c).length === 0)
  const entryCount = withEntries.reduce((sum, c) => sum + itemsOf(c).length, 0)
  const sectionName = (c: StatementCategory): string => t(`statement.section.${c}`)

  const blocks: ReactNode[] = []
  if (settings.summary && withEntries.length > 0) {
    blocks.push(
      ...tableBlocks({
        id: 'summary',
        heading: t('statementPrint.paper.periodSummary'),
        columns: [
          { label: t('statementPrint.paper.col.category') },
          { label: t('statementPrint.paper.col.entries'), kind: 'num' },
        ],
        rows: [
          ...withEntries.map((c) => ({
            key: c,
            cells: [
              sectionName(c),
              c === 'leave'
                ? t('statementPrint.paper.entriesWithDays', { count: itemsOf(c).length, days: leaveDays(itemsOf(c)) })
                : String(itemsOf(c).length),
            ],
          })),
          { key: 'total', total: true, cells: [t('statementPrint.paper.total'), String(entryCount)] },
        ],
        emptyText: '',
      }),
    )
  }
  // Left out on purpose, then included but empty: two short lines, never empty tables.
  if (excluded.length > 0) blocks.push(<ScopeLine key="scope" t={t} items={excluded.map(sectionName)} />)
  if (empty.length > 0) {
    blocks.push(
      <NoteLine
        key="empty"
        label={t('statementPrint.paper.noRecords')}
        items={empty.map(sectionName)}
        testId="statement-empty-categories"
        t={t}
      />,
    )
  }
  for (const c of withEntries) {
    const { columns, rows } = sectionRows(c, itemsOf(c), settings.lang, t, frame.employee)
    blocks.push(
      ...tableBlocks({
        id: c,
        heading: sectionName(c),
        count: String(itemsOf(c).length),
        columns,
        rows,
        emptyText: '',
      }),
    )
  }
  if (settings.sign) {
    blocks.push(
      <SignatureBlocks
        key="sign"
        t={t}
        boxes={[{ role: t('statementPrint.paper.preparedBy'), name: frame.issue.byline }]}
      />,
    )
  }

  return (
    <StatementSheet
      frame={{
        ...frame,
        lang: settings.lang,
        orient: settings.orient,
        title: t('statementPrint.paper.activityTitle'),
        lineTotal: t('statementPrint.paper.lineTotalActivity', { count: entryCount }),
      }}
      blocks={blocks}
    />
  )
}
