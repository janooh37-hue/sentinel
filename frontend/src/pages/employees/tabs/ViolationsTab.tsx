/**
 * Violations tab.
 *
 * Users with `violations.manage` see `ViolationsTable` (live-fetched, full
 * CRUD). Everyone else sees the read-only snapshot from the aggregate response.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ViolationsTable } from '@/components/employees/ViolationsTable'
import { api, apiErrorMessage } from '@/lib/api'
import type { RecentViolationRead, ViolationCreate, ViolationUpdate } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'

interface Props {
  employeeId: string
  violations: RecentViolationRead[]
  totalCount?: number
}

function ViolationsReadOnly({
  violations,
  totalCount,
}: {
  violations: RecentViolationRead[]
  totalCount?: number
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
            className="grid grid-cols-[120px_140px_1fr_100px] items-center gap-4 border-b border-hairline px-4 py-2.5 last:border-b-0"
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

function ViolationsManage({ employeeId }: { employeeId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: rows = [] } = useQuery({
    queryKey: ['violations', employeeId],
    queryFn: () => api.listViolations(employeeId),
  })

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

export function ViolationsTab({ employeeId, violations, totalCount }: Props): React.JSX.Element {
  const { has } = useCapabilities()
  if (has('violations.manage')) {
    return <ViolationsManage employeeId={employeeId} />
  }
  return <ViolationsReadOnly violations={violations} totalCount={totalCount} />
}
