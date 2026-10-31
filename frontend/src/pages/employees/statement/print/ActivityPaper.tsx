/**
 * The printed activity statement (mockup frame 3). Every requested section
 * prints on its own under its own heading: one per leave kind, then
 * absences, violations, documents, correspondence and placement. A section
 * with records prints its table; one without prints one quiet "No records in
 * this period" line. The summary (Section, Entries, Days) lists every
 * requested section, zeros included. Every table reads what, when, how much,
 * state, then who recorded it (by G-number).
 */

import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'

import type { EmployeeRead } from '@/lib/api'
import { englishPart, splitBilingual } from '@/lib/bilingualValue'
import { displayViolationValue } from '@/lib/violationTypes'

import type { ActivityStatementItem } from '../statementTypes'
import {
  formatStatementDate,
  sectionCountsDays,
  sectionLabelKey,
  sectionOf,
  type ActivitySection,
} from '../statementModel'
import { paperActor, paperSubject, recorderOf, stripOwnName } from './paperText'
import type { ActivitySettings } from './printSettings'
import { tableBlocks, usePaperT, type Column, type ColumnKind, type TableRow } from './paperBlocks'
import { Mono, ScopeLine, SignatureBlocks, StatementSheet, Txt, type PaperFrame } from './StatementLetterhead'

interface Props {
  frame: Omit<PaperFrame, 'title' | 'lineTotal' | 'lang' | 'orient'>
  settings: ActivitySettings
  /** Every item in the period, all sections. */
  items: ActivityStatementItem[]
  /** Order the sections print in. */
  sections: readonly ActivitySection[]
}

function Sub({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="st-sub">{children}</span>
}

function leaveDays(items: ActivityStatementItem[]): number {
  return items.reduce((sum, item) => sum + (item.days ?? 0), 0)
}

/** Days a section counts: leave days, or one per absence. */
function sectionDays(section: ActivitySection, items: ActivityStatementItem[]): number {
  return section === 'absence' ? items.length : leaveDays(items)
}

function sectionRows(
  section: ActivitySection,
  items: ActivityStatementItem[],
  lang: 'ar' | 'en',
  t: TFunction,
  employee: EmployeeRead,
): { columns: Column[]; rows: TableRow[] } {
  const date = (iso: string | null): string => (iso ? formatStatementDate(iso.slice(0, 10), lang) : '-')
  const by = (item: ActivityStatementItem): ReactNode => {
    const recorder = recorderOf(item)
    if (recorder.kind === 'system') return t('statementPrint.paper.system')
    return recorder.kind === 'number' ? <Mono>{recorder.id}</Mono> : '-'
  }
  const col = (key: string, kind: ColumnKind = 'text'): Column => ({
    label: t(`statementPrint.paper.col.${key}`),
    kind,
  })
  const key = (item: ActivityStatementItem): string => `${item.kind}-${item.source_id}`
  switch (section) {
    case 'violation':
      return {
        columns: [col('violation'), col('date', 'date'), col('penalty'), col('recordedBy', 'short')],
        rows: items.map((item) => ({
          key: key(item),
          cells: [
            <>
              <bdi>{item.violation_type ? displayViolationValue(item.violation_type, lang === 'ar') : '-'}</bdi>
              {item.description && (
                <Sub>
                  <Txt>{item.description}</Txt>
                </Sub>
              )}
            </>,
            date(item.occurred_at),
            <>
              <Txt>{item.action_taken}</Txt>
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
          cells: [date(item.occurred_at), <Txt key="n">{item.note}</Txt>, by(item)],
        })),
      }
    case 'document':
      return {
        columns: [col('document'), col('date', 'date'), col('reference', 'ref'), col('recordedBy', 'short')],
        rows: items.map((item) => ({
          key: key(item),
          cells: [
            <Txt key="d">
              {(lang === 'ar' ? item.template_name_ar : item.template_name_en) ??
                item.template_name_en ??
                item.template_id}
            </Txt>,
            date(item.occurred_at),
            item.reference ? <Mono>{item.reference}</Mono> : '-',
            by(item),
          ],
        })),
      }
    case 'ledger':
      return {
        columns: [
          col('subject'),
          col('date', 'date'),
          col('direction', 'short'),
          col('counterparty', 'short'),
          col('reference', 'ref'),
          col('recordedBy', 'short'),
        ],
        rows: items.map((item) => {
          const counterparty = paperActor(item.counterparty, t)
          const recorder = recorderOf(item)
          const recorderText =
            recorder.kind === 'system' ? t('statementPrint.paper.system') : recorder.kind === 'number' ? recorder.id : ''
          // Said once: when the counterparty is also who recorded it, the
          // recorded-by cell stays empty (the column keeps its place).
          const sameParty = !!counterparty && counterparty.toLowerCase() === recorderText.toLowerCase()
          const subject = paperSubject(item, lang)
          return {
            key: key(item),
            cells: [
              <Txt key="s">{subject ? stripOwnName(subject, employee) : null}</Txt>,
              date(item.occurred_at),
              item.direction ? t(`ledger.direction.${item.direction}`, { defaultValue: item.direction }) : '-',
              <Txt key="c">{counterparty}</Txt>,
              item.reference ? <Mono>{item.reference}</Mono> : '-',
              sameParty ? '' : by(item),
            ],
          }
        }),
      }
    case 'placement':
      return {
        columns: [col('event', 'short'), col('date', 'date'), col('detail'), col('recordedBy', 'short')],
        rows: items.map((item) => {
          const [event, detail] = placementCells(item, lang, t)
          return { key: key(item), cells: [event, date(item.occurred_at), detail, by(item)] }
        }),
      }
    default:
      return leaveRows(items, lang, t)
  }
}

/** A leave kind's table: what, when, how much, state, then a days total. */
function leaveRows(
  items: ActivityStatementItem[],
  lang: 'ar' | 'en',
  t: TFunction,
): { columns: Column[]; rows: TableRow[] } {
  const date = (iso: string | null): string => (iso ? formatStatementDate(iso.slice(0, 10), lang) : '-')
  const col = (key: string, kind: ColumnKind = 'text'): Column => ({
    label: t(`statementPrint.paper.col.${key}`),
    kind,
  })
  // Newest first, by when the leave starts.
  const sorted = [...items].sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''))
  const rows: TableRow[] = sorted.map((item) => ({
    key: `${item.kind}-${item.source_id}`,
    cells: [
      // Legacy rows store "Annual Leave - <ar>"; the key is the English side.
      item.leave_type
        ? t(`leaves.type.${englishPart(item.leave_type)}`, { defaultValue: splitBilingual(item.leave_type, lang) })
        : '-',
      date(item.start_date),
      date(item.end_date),
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
    columns: [col('type'), col('from', 'date'), col('to', 'date'), col('days', 'num'), col('status', 'short')],
    rows,
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
        <Txt>{detail}</Txt>
        {item.reason && (
          <Sub>
            <Txt>{item.reason}</Txt>
          </Sub>
        )}
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

export function ActivityPaper({ frame, settings, items, sections }: Props): React.JSX.Element {
  const t = usePaperT(settings.lang)
  const included = sections.filter((s) => settings.cats.includes(s))
  const excluded = sections.filter((s) => !settings.cats.includes(s))
  const bySection = new Map<ActivitySection, ActivityStatementItem[]>()
  for (const item of items) {
    const s = sectionOf(item)
    bySection.set(s, [...(bySection.get(s) ?? []), item])
  }
  const itemsOf = (s: ActivitySection): ActivityStatementItem[] => bySection.get(s) ?? []
  const entryCount = included.reduce((sum, s) => sum + itemsOf(s).length, 0)
  const daySections = included.filter(sectionCountsDays)
  const sectionName = (s: ActivitySection): string => t(sectionLabelKey(s))

  const blocks: ReactNode[] = []
  if (settings.summary && included.length > 0) {
    blocks.push(
      ...tableBlocks({
        id: 'summary',
        heading: t('statementPrint.paper.periodSummary'),
        columns: [
          { label: t('statementPrint.paper.col.section') },
          { label: t('statementPrint.paper.col.entries'), kind: 'num' },
          // Leave kinds and absences count days; every other section prints
          // '-', and the column drops away when none of them is requested.
          { label: t('statementPrint.paper.col.days'), kind: 'num' },
        ],
        rows: [
          ...included.map((s) => ({
            key: s,
            cells: [
              sectionName(s),
              String(itemsOf(s).length),
              sectionCountsDays(s) ? String(sectionDays(s, itemsOf(s))) : '-',
            ],
          })),
          {
            key: 'total',
            total: true,
            cells: [
              t('statementPrint.paper.total'),
              String(entryCount),
              daySections.length > 0
                ? String(daySections.reduce((sum, s) => sum + sectionDays(s, itemsOf(s)), 0))
                : '',
            ],
          },
        ],
        emptyText: '',
      }),
    )
  }
  if (excluded.length > 0) blocks.push(<ScopeLine key="scope" t={t} items={excluded.map(sectionName)} />)
  // Every requested section under its own heading: its table, or one quiet line.
  for (const s of included) {
    const sectionItems = itemsOf(s)
    const { columns, rows } =
      sectionItems.length > 0
        ? sectionRows(s, sectionItems, settings.lang, t, frame.employee)
        : { columns: [], rows: [] }
    blocks.push(
      ...tableBlocks({
        id: s,
        heading: sectionName(s),
        count: sectionItems.length > 0 ? String(sectionItems.length) : undefined,
        columns,
        rows,
        emptyText: t('statementPrint.paper.noRecords'),
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
