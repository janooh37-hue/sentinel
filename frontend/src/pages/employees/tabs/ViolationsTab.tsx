/**
 * Violations tab.
 *
 * Users with `violations.manage` see `ViolationsTable` (live-fetched, full
 * CRUD). Everyone else sees the read-only snapshot from the aggregate response.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ViolationsTable } from '@/components/employees/ViolationsTable'
import { api, apiErrorMessage } from '@/lib/api'
import type {
  RecentViolationRead,
  ViolationCreate,
  ViolationRead,
  ViolationUpdate,
} from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'

interface Props {
  employeeId: string
  violations: RecentViolationRead[]
  totalCount?: number
  openId?: number | null
  onOpenConsumed?: () => void
}

function useViolationTarget({
  openId,
  rowIds,
  ready,
  refresh,
  onConsumed,
}: {
  openId?: number | null
  rowIds: readonly number[]
  ready: boolean
  refresh?: () => Promise<readonly { id: number }[] | undefined>
  onConsumed?: () => void
}): number | null {
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const lastHandled = useRef<number | null>(null)
  const pendingId = useRef<number | null>(null)

  useEffect(() => {
    if (openId == null) {
      lastHandled.current = null
      pendingId.current = null
      return
    }
    if (!ready || lastHandled.current === openId || pendingId.current === openId) return

    let active = true
    let frame: number | null = null
    const schedule = (found: boolean) => {
      if (!active) return
      pendingId.current = openId
      frame = requestAnimationFrame(() => {
        if (!active) return
        lastHandled.current = openId
        pendingId.current = null
        if (found) {
          setHighlightedId(openId)
          document
            .querySelector<HTMLElement>(`[data-violation-row-id="${openId}"]`)
            ?.scrollIntoView({ block: 'center' })
        } else {
          setHighlightedId(null)
        }
        onConsumed?.()
      })
    }

    const found = rowIds.includes(openId)
    if (!found && refresh) {
      pendingId.current = openId
      void refresh().then((refreshedRows) => {
        if (!active || refreshedRows === undefined) return
        schedule(refreshedRows.some((row) => row.id === openId))
      })
    } else {
      schedule(found)
    }

    return () => {
      active = false
      if (frame !== null) cancelAnimationFrame(frame)
      if (pendingId.current === openId) pendingId.current = null
    }
  }, [openId, onConsumed, ready, refresh, rowIds])

  useEffect(() => {
    if (highlightedId == null) return
    const timer = window.setTimeout(() => setHighlightedId(null), 1800)
    return () => window.clearTimeout(timer)
  }, [highlightedId])

  return highlightedId
}
function ViolationsReadOnly({
  violations,
  totalCount,
  highlightedId,
}: {
  violations: RecentViolationRead[]
  totalCount?: number
  highlightedId: number | null
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [i18n.language],
  )
  const isPartial = totalCount !== undefined && violations.length < totalCount

  if (violations.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">
        {t('employee.violations.empty')}
      </div>
    )
  }
  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {violations.map((v) => (
          <div
            key={v.id}
            data-testid={`violation-row-${v.id}`}
            data-violation-row-id={v.id}
            data-highlighted={highlightedId === v.id ? 'true' : 'false'}
            className={cn(
              'grid grid-cols-[120px_140px_1fr_100px] items-center gap-4 border-b border-hairline px-4 py-2.5 last:border-b-0',
              highlightedId === v.id && 'bg-primary-soft ring-1 ring-inset ring-primary/30',
            )}
          >
            <div className="font-mono text-[0.86em] text-muted-foreground">
              {dateFmt.format(new Date(v.date))}
            </div>
            <div className="text-[0.92em] font-medium">{v.violation_type}</div>
            <div className="truncate text-[0.86em] text-muted-foreground">
              {v.description || '—'}
            </div>
            <span className="rounded-full bg-accent-soft px-3 py-0.5 text-center text-[0.72em] font-semibold text-accent">
              {v.status}
            </span>
          </div>
        ))}
      </div>
      {isPartial && (
        <div className="mt-3 text-center text-[0.8em] text-muted-foreground">
          {t('employee.tab.showingRecent', {
            shown: violations.length,
            total: totalCount,
            defaultValue: `Showing ${violations.length} of ${totalCount}`,
          })}
        </div>
      )}
    </>
  )
}

function ViolationsManage({
  employeeId,
  rows,
  highlightedId,
}: {
  employeeId: string
  rows: ViolationRead[]
  highlightedId: number | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['violations', employeeId] })
  const createMut = useMutation({
    mutationFn: (v: ViolationCreate) => api.createViolation(employeeId, v),
    onSuccess: () => {
      void invalidate()
      toast.success(t('violations.toast.created', { defaultValue: 'Violation added' }))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, v }: { id: number; v: ViolationUpdate }) =>
      api.updateViolation(id, v),
    onSuccess: () => {
      void invalidate()
      toast.success(t('violations.toast.updated', { defaultValue: 'Violation updated' }))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteViolation(id),
    onSuccess: () => {
      void invalidate()
      toast.success(t('violations.toast.deleted', { defaultValue: 'Violation deleted' }))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return (
    <ViolationsTable
      rows={rows}
      highlightedId={highlightedId}
      employeeId={employeeId}
      onCreate={async (v) => {
        await createMut.mutateAsync(v)
      }}
      onUpdate={async (id, v) => {
        await updateMut.mutateAsync({ id, v })
      }}
      onDelete={(id) => deleteMut.mutateAsync(id)}
    />
  )
}
export function ViolationsTab({
  employeeId,
  violations,
  totalCount,
  openId,
  onOpenConsumed,
}: Props): React.JSX.Element {
  const { has } = useCapabilities()
  const canManage = has('violations.manage')
  const shouldLoadFull = canManage || openId != null
  const fullQuery = useQuery({
    queryKey: ['violations', employeeId],
    queryFn: () => api.listViolations(employeeId),
    enabled: shouldLoadFull,
  })
  const refreshFull = useCallback(async () => {
    try {
      const result = await fullQuery.refetch()
      return result.isError ? undefined : result.data
    } catch {
      return undefined
    }
  }, [fullQuery.refetch])
  const rows = fullQuery.data ?? violations
  const manageRows = fullQuery.data ?? []
  const targetReady =
    !shouldLoadFull ||
    (!fullQuery.isError &&
      (fullQuery.data !== undefined || (!fullQuery.isPending && !fullQuery.isError)))
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows])
  const highlightedId = useViolationTarget({
    openId,
    rowIds,
    ready: targetReady,
    refresh: shouldLoadFull ? refreshFull : undefined,
    onConsumed: onOpenConsumed,
  })

  if (shouldLoadFull && fullQuery.isError) {
    return (
      <div className="space-y-3 rounded-2xl border border-destructive/30 bg-surface p-6 text-destructive">
        <p role="alert">{apiErrorMessage(fullQuery.error)}</p>
        <button type="button" className="underline" onClick={() => void fullQuery.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  if (canManage) {
    return (
      <ViolationsManage
        employeeId={employeeId}
        rows={manageRows}
        highlightedId={highlightedId}
      />
    )
  }
  return (
    <ViolationsReadOnly
      violations={rows}
      totalCount={totalCount}
      highlightedId={highlightedId}
    />
  )
}
