/**
 * The printed activity statement (mockup frame 3): period summary, one titled
 * table per included category, and the "Prepared by" box. Only what is left
 * out is named on the paper; a complete statement carries no scope line.
 */

import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'

import { englishPart, splitBilingual } from '@/lib/bilingualValue'

import type { ActivityStatementItem } from '../statementTypes'
import { categoryOf, formatStatementDate, type StatementCategory } from '../statementModel'
import type { ActivitySettings } from './printSettings'
import { tableBlocks, usePaperT, type TableRow } from './paperBlocks'
import { Mono, ScopeLine, SignatureBlocks, StatementSheet, type PaperFrame } from './StatementLetterhead'

interface Props {
  frame: Omit<PaperFrame, 'title' | 'lineTotal' | 'lang' | 'orient'>
  settings: ActivitySettings
  /** Every item in the period, all categories. */
  items: ActivityStatementItem[]
  /** Order the categories print in. */
  categories: readonly StatementCategory[]
}

/** Leave and absence carry days; the other categories have none to total. */
function daysOf(category: StatementCategory, items: ActivityStatementItem[]): number | null {
  if (category === 'leave') return items.reduce((sum, item) => sum + (item.days ?? 0), 0)
  if (category === 'absence') return items.length
  return null
}

function Sub({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="st-sub">{children}</span>
}

function sectionRows(
  category: StatementCategory,
  items: ActivityStatementItem[],
  lang: 'ar' | 'en',
  t: TFunction,
): { columns: { label: string; num?: boolean }[]; rows: TableRow[] } {
  const date = (iso: string | null): string => (iso ? formatStatementDate(iso.slice(0, 10), lang) : '-')
  const by = (item: ActivityStatementItem): ReactNode => <bdi>{item.actor_name ?? '-'}</bdi>
  const col = (key: string, num = false): { label: string; num?: boolean } => ({
    label: t(`statementPrint.paper.col.${key}`),
    num,
  })
  switch (category) {
    case 'leave': {
      const rows: TableRow[] = items.map((item) => ({
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
        cells: [t('statementPrint.paper.total'), '', '', String(daysOf('leave', items)), ''],
      })
      return { columns: [col('type'), col('from'), col('to'), col('days', true), col('status')], rows }
    }
    case 'violation':
      return {
        columns: [col('date'), col('violation'), col('penalty'), col('recordedBy')],
        rows: items.map((item) => ({
          key: `${item.kind}-${item.source_id}`,
          cells: [
            date(item.occurred_at),
            <>
              <bdi>{item.violation_type ?? '-'}</bdi>
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
        columns: [col('date'), col('note'), col('recordedBy')],
        rows: items.map((item) => ({
          key: `${item.kind}-${item.source_id}`,
          cells: [date(item.occurred_at), <bdi key="n">{item.note ?? '-'}</bdi>, by(item)],
        })),
      }
    case 'document':
      return {
        columns: [col('date'), col('document'), col('reference'), col('recordedBy')],
        rows: items.map((item) => ({
          key: `${item.kind}-${item.source_id}`,
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
        columns: [col('date'), col('direction'), col('subject'), col('counterparty'), col('recordedBy')],
        rows: items.map((item) => ({
          key: `${item.kind}-${item.source_id}`,
          cells: [
            date(item.occurred_at),
            item.direction ? t(`ledger.direction.${item.direction}`, { defaultValue: item.direction }) : '-',
            <>
              <bdi>{item.subject ?? '-'}</bdi>
              {item.reference && (
                <Sub>
                  <Mono>{item.reference}</Mono>
                </Sub>
              )}
            </>,
            <bdi key="c">{item.counterparty ?? '-'}</bdi>,
            by(item),
          ],
        })),
      }
    case 'placement':
      return {
        columns: [col('date'), col('event'), col('detail'), col('recordedBy')],
        rows: items.map((item) => ({
          key: `${item.kind}-${item.source_id}`,
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
  const facts = [
    item.effective_date && t('statementPrint.paper.effective', { date: formatStatementDate(item.effective_date, lang) }),
    item.site,
    item.return_date && t('statementPrint.paper.returnDate', { date: formatStatementDate(item.return_date, lang) }),
  ].filter(Boolean)
  return [
    t('statementPrint.paper.statusChange'),
    <>
      {t('statementPrint.paper.fromTo', { from: status(item.from_status), to: status(item.to_status) })}
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
  const entryCount = included.reduce((sum, c) => sum + itemsOf(c).length, 0)
  const sectionName = (c: StatementCategory): string => t(`statement.section.${c}`)

  const blocks: ReactNode[] = []
  if (excluded.length > 0) {
    blocks.push(<ScopeLine key="scope" t={t} items={excluded.map(sectionName)} />)
  }
  if (settings.summary) {
    const totalDays = included.reduce((sum, c) => sum + (daysOf(c, itemsOf(c)) ?? 0), 0)
    blocks.push(
      ...tableBlocks({
        id: 'summary',
        heading: t('statementPrint.paper.periodSummary'),
        columns: [
          { label: t('statementPrint.paper.col.category') },
          { label: t('statementPrint.paper.col.entries'), num: true },
          { label: t('statementPrint.paper.col.totalDays'), num: true },
        ],
        rows: [
          ...included.map((c) => {
            const days = daysOf(c, itemsOf(c))
            return { key: c, cells: [sectionName(c), String(itemsOf(c).length), days === null ? '-' : String(days)] }
          }),
          { key: 'total', total: true, cells: [t('statementPrint.paper.total'), String(entryCount), String(totalDays)] },
        ],
        emptyText: t('statementPrint.paper.none'),
      }),
    )
  }
  for (const c of included) {
    const { columns, rows } = sectionRows(c, itemsOf(c), settings.lang, t)
    blocks.push(
      ...tableBlocks({
        id: c,
        heading: sectionName(c),
        count: String(itemsOf(c).length),
        columns,
        rows: itemsOf(c).length === 0 ? [] : rows,
        emptyText: t('statementPrint.paper.none'),
      }),
    )
  }
  if (settings.sign) {
    blocks.push(
      <SignatureBlocks
        key="sign"
        t={t}
        boxes={[
          {
            role: t('statementPrint.paper.preparedBy'),
            name:
              [frame.issue.printedBy, frame.issue.printedByRole]
                .filter(Boolean)
                .join(settings.lang === 'ar' ? '، ' : ', ') || null,
          },
        ]}
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
