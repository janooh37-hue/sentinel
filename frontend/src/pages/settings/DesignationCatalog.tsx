/**
 * DesignationCatalog — the printed order of both monthly workbooks, and the
 * billed posts per designation on the client statistics.
 *
 * Both deliverables group their rows by designation, in this order, so this
 * list is the one place the printed sequence is decided; each main-sheet row
 * also carries its UAE and Arab quotas, which apply to every month. Registered
 * as a Settings panel behind `has('timesheet.edit')` (`SettingsPage.tsx`), which
 * is why the component itself carries no capability branch: an operator who
 * cannot edit the catalog has nothing to be shown.
 *
 * Reordering is up/down controls, not drag-and-drop: no DnD library is in the
 * bundle and the repo already made this exact call for its only other reorder
 * surface (`components/dashboard/WidgetEditDialog.tsx:6-8`). One click is one
 * swap, so a draft plus an explicit save is what keeps a four-place move to one
 * `PUT` — and `reorder_designations` rewrites every rank twice per call
 * (negative temporaries first, because `rank_order` is uniquely constrained),
 * which is not a thing to do eight times for one gesture.
 *
 * The payload is EVERY id exactly once. A full permutation is all this surface
 * can build — it permutes the list it was served — so the one way the server
 * still refuses is a catalog that changed underneath: a row seeded or removed
 * while the draft was open. That answer is `DESIGNATION_ORDER_INCOMPLETE`, and
 * the honest response to it is to reload and say so, not to retry.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'
import { ChevronDown, ChevronUp } from 'lucide-react'

import {
  ApiError,
  api,
  apiErrorMessage,
  type TimesheetDesignationRead,
} from '@/lib/api'

import { TIMESHEET_DESIGNATIONS_KEY } from '@/pages/timesheet/useTimesheet'

import { OutlineButton, PrimaryButton, SectionCard } from './SettingsPage'

const MOVE_BUTTON =
  'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40'


/** `draft` order applied to the served rows; `null` means "follow the server". */
function ordered(
  rows: TimesheetDesignationRead[],
  draft: number[] | null,
): TimesheetDesignationRead[] {
  if (!draft) return rows
  const byId = new Map(rows.map((row) => [row.id, row]))
  const out = draft.map((id) => byId.get(id)).filter((row): row is TimesheetDesignationRead => !!row)
  // A row the draft never saw (the catalog grew while it was open) still has to
  // appear, or the operator cannot see what he is about to send.
  return out.length === rows.length ? out : rows
}

/** Each row commits independently; a blank number is never coerced to zero. */
function QuotaControls({ row }: { row: TimesheetDesignationRead }): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [uae, setUae] = useState(String(row.quota_uae))
  const [arab, setArab] = useState(String(row.quota_arab))
  const version = `${row.quota_uae}:${row.quota_arab}`
  const [seen, setSeen] = useState(version)
  if (seen !== version) {
    setSeen(version)
    setUae(String(row.quota_uae))
    setArab(String(row.quota_arab))
  }
  const save = useMutation({
    mutationFn: (input: Parameters<typeof api.setTimesheetDesignationQuota>[1]) =>
      api.setTimesheetDesignationQuota(row.id, input),
    onSuccess: (updated) => {
      qc.setQueryData<TimesheetDesignationRead[]>(TIMESHEET_DESIGNATIONS_KEY, (catalog) =>
        catalog?.map((entry) => entry.id === updated.id ? updated : entry),
      )
      void qc.invalidateQueries({ queryKey: ['timesheet'] })
      toast.success(t('timesheet.designations.quotaSaved'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const commit = (fill = row.quota_fill): void => {
    const quotaUae = Number(uae)
    const quotaArab = Number(arab)
    if ([uae, arab].some((raw) => raw.trim() === '') ||
        [quotaUae, quotaArab].some((value) => !Number.isInteger(value) || value < 0 || value > 1000)) {
      setUae(String(row.quota_uae))
      setArab(String(row.quota_arab))
      toast.error(t('timesheet.designations.quotaInvalid'))
      return
    }
    if (quotaUae === row.quota_uae && quotaArab === row.quota_arab && fill === row.quota_fill) return
    save.mutate({ quota_uae: quotaUae, quota_arab: quotaArab, quota_fill: fill })
  }
  const inputClass = 'w-24 rounded-md border border-border-strong bg-surface px-2 py-1.5 font-mono tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
  return (
    <div className="flex w-full flex-wrap items-end gap-3 border-t border-hairline pt-2 text-[0.78em]">
      <label className="flex flex-col gap-1 text-muted-foreground">
        {t('timesheet.designations.quotaUae')}
        <input type="number" min={0} max={1000} step={1} value={uae}
          disabled={save.isPending} onChange={(event) => setUae(event.target.value)}
          onBlur={() => commit()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-muted-foreground">
        {t('timesheet.designations.quotaArab')}
        <input type="number" min={0} max={1000} step={1} value={arab}
          disabled={save.isPending} onChange={(event) => setArab(event.target.value)}
          onBlur={() => commit()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          className={inputClass} />
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-muted-foreground">
        {t('timesheet.designations.quotaFill')}
        <select value={row.quota_fill} disabled={save.isPending}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'own' || value === 'own_then_guards' || value === 'guards_only') commit(value)
          }}
          className="w-full min-w-0 rounded-md border border-border-strong bg-surface px-2 py-1.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          <option value="own">{t('timesheet.designations.fillOwn')}</option>
          <option value="own_then_guards">{t('timesheet.designations.fillOwnThenGuards')}</option>
          <option value="guards_only">{t('timesheet.designations.fillGuardsOnly')}</option>
        </select>
      </label>
    </div>
  )
}

export function DesignationCatalog(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<number[] | null>(null)

  const { data } = useQuery({
    queryKey: TIMESHEET_DESIGNATIONS_KEY,
    queryFn: () => api.listDesignations(),
  })
  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.rank_order - b.rank_order),
    [data],
  )
  const rows = ordered(sorted, draft)

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.reorderDesignations(ids),
    onSuccess: (updated) => {
      qc.setQueryData(TIMESHEET_DESIGNATIONS_KEY, updated)
      // The response IS the catalog as re-ranked, so the draft has nothing left
      // to say and the list goes back to following the server. Open months
      // re-sort their rows, so the grid refetches too.
      void qc.invalidateQueries({ queryKey: ['timesheet'] })
      setDraft(null)
      toast.success(t('timesheet.designations.saved'))
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'DESIGNATION_ORDER_INCOMPLETE') {
        setDraft(null)
        void qc.invalidateQueries({ queryKey: TIMESHEET_DESIGNATIONS_KEY })
        toast.error(t('timesheet.designations.stale'))
        return
      }
      toast.error(apiErrorMessage(err))
    },
  })

  const move = (index: number, delta: -1 | 1): void => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const next = rows.map((row) => row.id)
    const held = next[index]!
    next[index] = next[target]!
    next[target] = held
    setDraft(next)
  }

  /** The label the operator is reading, so the move controls name it back. */
  const nameOf = (row: TimesheetDesignationRead): string =>
    i18n.language.startsWith('ar') ? row.name_ar : row.name_en

  return (
    <SectionCard
      title={t('timesheet.designations.title')}
      description={t('timesheet.designations.description')}
    >
      <p className="mb-3 text-[0.9em] font-semibold">
        {t('timesheet.designations.contractTotal', {
          count: (data ?? []).filter((row) => row.sheet === 'main' && row.active)
            .reduce((sum, row) => sum + row.quota_uae + row.quota_arab, 0),
        })}
      </p>
      <p className="mb-3 max-w-[68ch] text-[0.78em] text-muted-foreground">
        {t('timesheet.designations.quotaHint')}
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-surface-raised px-3 py-2.5"
          >
            <span className="w-6 shrink-0 font-mono text-[0.8em] tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9em] font-medium text-foreground">
                {row.name_en}
              </span>
              {/* The Arabic name is what the statistics workbook prints, so it
                  is shown in both UI languages rather than swapped in. */}
              <span className="block truncate text-[0.8em] text-muted-foreground" dir="rtl">
                {row.name_ar}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-surface-tinted px-2 py-0.5 text-[0.72em] font-medium text-muted-foreground">
              {t(row.sheet === 'drivers' ? 'timesheet.sheetDrivers' : 'timesheet.sheetMain')}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0 || reorder.isPending}
                aria-label={t('timesheet.designations.moveUp', { name: nameOf(row) })}
                className={MOVE_BUTTON}
              >
                <ChevronUp className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === rows.length - 1 || reorder.isPending}
                aria-label={t('timesheet.designations.moveDown', { name: nameOf(row) })}
                className={MOVE_BUTTON}
              >
                <ChevronDown className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              </button>
            </span>
            {row.sheet === 'main' && <QuotaControls row={row} />}
          </li>
        ))}
      </ul>

      {/* Absent, not disabled, until something has actually moved: there is no
          order to save and no pointless `PUT` to offer. */}
      {draft && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
          <p className="flex-1 text-[0.82em] text-muted-foreground">
            {t('timesheet.designations.unsaved')}
          </p>
          <OutlineButton onClick={() => setDraft(null)} disabled={reorder.isPending}>
            {t('timesheet.designations.revert')}
          </OutlineButton>
          <PrimaryButton
            onClick={() => reorder.mutate(rows.map((row) => row.id))}
            disabled={reorder.isPending}
          >
            {t('timesheet.designations.save')}
          </PrimaryButton>
        </div>
      )}
    </SectionCard>
  )
}
