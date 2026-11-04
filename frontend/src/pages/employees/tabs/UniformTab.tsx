/**
 * Uniform tab: read-only view of what this employee holds and how it got there.
 *
 * Net holdings lead (what the person has right now); the hand-out and return
 * history follows, newest first, with voided records kept and marked so the
 * trail stays complete. Mutations live on the Assets Uniform page only.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { UniformArt } from '@/components/UniformArt'
import type { UniformItemRead } from '@/lib/api'
import { useIsMobile } from '@/lib/useIsMobile'
import {
  uniformErrorMessage,
  useUniformEmployee,
  useUniformItems,
} from '@/pages/assets/uniform/uniformQueries'

interface Props {
  employeeId: string
}

interface Line {
  item_id: number
  size_id?: number | null
  qty: number
  condition?: string
}

interface HistoryEntry {
  key: string
  kind: 'issue' | 'return'
  date: string
  createdAt: string
  lines: Line[]
  voided: boolean
  voidReason: string | null
}

export function UniformTab({ employeeId }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isMobile = useIsMobile()
  const record = useUniformEmployee(employeeId)
  // Archived items still appear in old records, so the lookup includes them.
  const items = useUniformItems(true)
  const isAr = i18n.language.startsWith('ar')

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
    [i18n.language],
  )

  const itemById = useMemo(() => {
    const map = new Map<number, UniformItemRead>()
    for (const item of items.data ?? []) map.set(item.id, item)
    return map
  }, [items.data])

  const history = useMemo<HistoryEntry[]>(() => {
    const data = record.data
    if (!data) return []
    const entries: HistoryEntry[] = [
      ...data.issues.map((r) => ({
        key: `issue-${r.id}`,
        kind: 'issue' as const,
        date: r.issued_on,
        createdAt: r.created_at,
        lines: r.lines,
        voided: r.voided_at != null,
        voidReason: r.void_reason ?? null,
      })),
      ...data.returns.map((r) => ({
        key: `return-${r.id}`,
        kind: 'return' as const,
        date: r.returned_on,
        createdAt: r.created_at,
        lines: r.lines,
        voided: r.voided_at != null,
        voidReason: r.void_reason ?? null,
      })),
    ]
    return entries.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }, [record.data])

  if (record.isLoading || items.isLoading) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground" role="status">
        {t('assets.uniform.loading')}
      </div>
    )
  }
  if (record.isError || items.isError) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground" role="alert">
        <p>{uniformErrorMessage(record.error ?? items.error)}</p>
        <button
          type="button"
          onClick={() => {
            void record.refetch()
            void items.refetch()
          }}
          className="mt-3 min-h-11 rounded-lg border border-border px-4 font-semibold text-foreground hover:bg-muted"
        >
          {t('assets.uniform.retry')}
        </button>
      </div>
    )
  }

  const itemName = (itemId: number): string => {
    const item = itemById.get(itemId)
    if (!item) return `#${itemId}`
    return (isAr ? item.name_ar : item.name_en) || item.name_en
  }
  const sizeLabel = (itemId: number, sizeId?: number | null): string => {
    if (sizeId == null) return t('assets.uniform.oneSize')
    return itemById.get(itemId)?.sizes.find((s) => s.id === sizeId)?.label ?? `#${sizeId}`
  }
  const formatDate = (iso: string): string => dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00`))

  const holdings = (record.data?.holdings ?? []).filter((h) => h.qty > 0)

  const lineText = (line: Line) => (
    <>
      <span dir="auto">{itemName(line.item_id)}</span>{' '}
      <bdi dir="ltr" className="font-mono">{sizeLabel(line.item_id, line.size_id)}</bdi>{' '}
      <bdi dir="ltr" className="font-mono">×{line.qty}</bdi>
      {line.condition && (
        <span className="ms-1 text-muted-foreground">
          ({t(line.condition === 'damaged' ? 'assets.uniform.damaged' : 'assets.uniform.reusable')})
        </span>
      )}
    </>
  )

  const status = (entry: HistoryEntry) =>
    entry.voided ? (
      <span className="inline-flex flex-col gap-0.5">
        <span className="w-fit rounded-full bg-destructive/10 px-2 py-0.5 text-[0.85em] font-semibold text-destructive">
          {t('assets.uniform.voidStatus')}
        </span>
        {entry.voidReason && (
          <span className="text-[0.85em] text-muted-foreground" dir="auto">
            {entry.voidReason}
          </span>
        )}
      </span>
    ) : (
      <span className="text-muted-foreground">{t('assets.uniform.activeStatus')}</span>
    )

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="uniform-holdings-heading"
        className="rounded-2xl border border-hairline bg-surface p-4"
      >
        <h2 id="uniform-holdings-heading" className="mb-3 text-[0.95em] font-semibold text-foreground">
          {t('assets.uniform.currentlyHolds')}
        </h2>
        {holdings.length === 0 ? (
          <p className="text-muted-foreground">{t('assets.uniform.holdsNone')}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {holdings.map((h) => (
              <li
                key={`${h.item_id}-${h.size_id ?? 'one'}`}
                className="flex min-h-11 items-center gap-3 rounded-xl border border-hairline px-3 py-2"
              >
                <UniformArt kind={itemById.get(h.item_id)?.drawing} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground" dir="auto">
                    {itemName(h.item_id)}
                  </span>
                  <bdi dir="ltr" className="font-mono text-[0.85em] text-muted-foreground">
                    {sizeLabel(h.item_id, h.size_id ?? null)}
                  </bdi>
                </span>
                <span className="font-mono text-[1.1em] font-semibold text-foreground">{h.qty}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="uniform-history-heading" className="rounded-2xl border border-hairline bg-surface">
        <h2 id="uniform-history-heading" className="px-4 pt-4 text-[0.95em] font-semibold text-foreground">
          {t('assets.uniform.history')}
        </h2>
        {history.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t('assets.uniform.receivedNone')}</p>
        ) : isMobile ? (
          <ul className="flex flex-col gap-2 p-4">
            {history.map((entry) => (
              <li
                key={entry.key}
                data-voided={entry.voided || undefined}
                className={`rounded-xl border border-hairline p-3 ${entry.voided ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {t(entry.kind === 'issue' ? 'assets.uniform.issuedOn' : 'assets.uniform.returnedOn')}:{' '}
                    <span className="font-mono">{formatDate(entry.date)}</span>
                  </span>
                  {status(entry)}
                </div>
                <ul className={`mt-2 flex flex-col gap-1 ${entry.voided ? 'line-through' : ''}`}>
                  {entry.lines.map((line, i) => (
                    <li key={i}>{lineText(line)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <table className="mt-2 w-full border-collapse text-[0.86em]">
            <thead>
              <tr className="border-b border-hairline text-muted-foreground">
                <th className="px-4 py-2 text-start font-medium">{t('assets.uniform.action')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('assets.uniform.piece')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('assets.uniform.summary')}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr
                  key={entry.key}
                  data-voided={entry.voided || undefined}
                  className={`border-b border-hairline align-top last:border-b-0 ${entry.voided ? 'opacity-70' : ''}`}
                >
                  <td className="px-4 py-2.5 text-foreground">
                    <span className="block">
                      {t(entry.kind === 'issue' ? 'assets.uniform.issuedOn' : 'assets.uniform.returnedOn')}
                    </span>
                    <span className="font-mono">{formatDate(entry.date)}</span>
                  </td>
                  <td className={`px-4 py-2.5 text-foreground ${entry.voided ? 'line-through' : ''}`}>
                    <ul className="flex flex-col gap-1">
                      {entry.lines.map((line, i) => (
                        <li key={i}>{lineText(line)}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-2.5">{status(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
