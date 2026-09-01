/**
 * Violations tab.
 *
 * Users with any violations write capability (`violations.create` /
 * `violations.edit` / `violations.delete`) see `ViolationsTable` (live-fetched,
 * full CRUD). Everyone else sees the read-only snapshot from the aggregate
 * response.
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
import type { PreviewDoc } from '@/lib/docPreview'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'

interface Props {
  employeeId: string
  violations: RecentViolationRead[]
  totalCount?: number
  openId?: number | null
  onOpenConsumed?: () => void
  onPreviewDocs: (docs: PreviewDoc[], index?: number) => void
}

type ViolationTargetState = {
  highlightedId: number | null
  targetNotFoundId: number | null
}

function useViolationTarget({
  openId,
  targetPresent,
  ready,
  refresh,
  onConsumed,
}: {
  openId?: number | null
  targetPresent: boolean
  ready: boolean
  refresh?: () => Promise<readonly { id: number }[] | undefined>
  onConsumed?: () => void
}): ViolationTargetState {
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const [targetNotFoundId, setTargetNotFoundId] = useState<number | null>(null)
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
          setTargetNotFoundId(null)
          document
            .querySelector<HTMLElement>(`[data-violation-row-id="${openId}"]`)
            ?.scrollIntoView({ block: 'center' })
          onConsumed?.()
        } else {
          setHighlightedId(null)
          setTargetNotFoundId(openId)
        }
      })
    }

    const found = targetPresent
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
  }, [openId, onConsumed, ready, refresh, targetPresent])

  useEffect(() => {
    if (highlightedId == null) return
    const timer = window.setTimeout(() => setHighlightedId(null), 1800)
    return () => window.clearTimeout(timer)
  }, [highlightedId])

  return { highlightedId, targetNotFoundId }
}
function ViolationsReadOnly({
  violations,
  totalCount,
  highlightedId,
  targetNotFound,
  onPreviewDocs,
}: {
  violations: RecentViolationRead[]
  totalCount?: number
  highlightedId: number | null
  targetNotFound: boolean
  onPreviewDocs: (docs: PreviewDoc[], index?: number) => void
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

  if (targetNotFound) {
    return (
      <div role="alert" className="rounded-2xl border border-destructive/30 bg-surface p-4 text-destructive">
        {t('employee.violations.targetNotFound')}
      </div>
    )
  }
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
        {violations.map((v) => {
          const linkedDocuments = v.linked_documents ?? []
          const rowClassName = cn(
            'grid w-full grid-cols-[120px_140px_1fr_100px] items-center gap-4 border-b border-hairline px-4 py-2.5 last:border-b-0',
            highlightedId === v.id && 'bg-primary-soft ring-2 ring-inset ring-primary',
          )
          const content = (
            <>
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
            </>
          )

          return linkedDocuments.length > 0 ? (
            <button
              key={v.id}
              type="button"
              data-testid={`violation-row-${v.id}`}
              data-violation-row-id={v.id}
              data-highlighted={highlightedId === v.id ? 'true' : 'false'}
              className={`${rowClassName} text-start transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`}
              onClick={() =>
                onPreviewDocs(
                  linkedDocuments.map((document) => ({
                    id: document.id,
                    name: document.template_id,
                  })),
                )
              }
            >
              {content}
            </button>
          ) : (
            <div
              key={v.id}
              data-testid={`violation-row-${v.id}`}
              data-violation-row-id={v.id}
              data-highlighted={highlightedId === v.id ? 'true' : 'false'}
              className={rowClassName}
            >
              {content}
            </div>
          )
        })}
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
  targetNotFound,
  canCreate,
  canEdit,
  canDelete,
  onPreviewDocs,
}: {
  employeeId: string
  rows: ViolationRead[]
  highlightedId: number | null
  targetNotFound: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onPreviewDocs: (docs: PreviewDoc[], index?: number) => void
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
      targetNotFound={targetNotFound}
      employeeId={employeeId}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      onPreviewDocs={onPreviewDocs}
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
  onPreviewDocs,
}: Props): React.JSX.Element {
  const { has } = useCapabilities()
  const { t } = useTranslation()
  const canCreate = has('violations.create')
  const canEdit = has('violations.edit')
  const canDelete = has('violations.delete')
  const shouldLoadFull = canCreate || canEdit || canDelete || openId != null
  const fullQuery = useQuery({
    queryKey: ['violations', employeeId],
    queryFn: () => api.listViolations(employeeId),
    enabled: shouldLoadFull,
  })
  const { refetch: refetchFull } = fullQuery
  const refreshFull = useCallback(async () => {
    try {
      const result = await refetchFull()
      return result.isError ? undefined : result.data
    } catch {
      return undefined
    }
  }, [refetchFull])
  const rows = fullQuery.data ?? violations
  const manageRows = fullQuery.data ?? []
  const targetReady =
    !shouldLoadFull ||
    (!fullQuery.isError &&
      (fullQuery.data !== undefined || (!fullQuery.isPending && !fullQuery.isError)))
  const targetPresent = openId != null && rows.some((row) => row.id === openId)
  const { highlightedId, targetNotFoundId } = useViolationTarget({
    openId,
    targetPresent,
    ready: targetReady,
    refresh: shouldLoadFull ? refreshFull : undefined,
    onConsumed: onOpenConsumed,
  })
  const targetNotFound = openId != null && targetNotFoundId === openId

  if (shouldLoadFull && fullQuery.isError && (openId != null || fullQuery.data === undefined)) {
    return (
      <div className="space-y-3 rounded-2xl border border-destructive/30 bg-surface p-6 text-destructive">
        <p role="alert">{apiErrorMessage(fullQuery.error)}</p>
        <button type="button" className="underline" onClick={() => void fullQuery.refetch()}>
          {t('common.retry')}
        </button>
      </div>
    )
  }

  if (canCreate || canEdit || canDelete) {
    return (
      <ViolationsManage
        employeeId={employeeId}
        rows={manageRows}
        highlightedId={highlightedId}
        targetNotFound={targetNotFound}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        onPreviewDocs={onPreviewDocs}
      />
    )
  }
  return (
    <ViolationsReadOnly
      violations={rows}
      totalCount={totalCount}
      highlightedId={highlightedId}
      targetNotFound={targetNotFound}
      onPreviewDocs={onPreviewDocs}
    />
  )
}
