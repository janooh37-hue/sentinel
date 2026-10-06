/**
 * Item permits tab — the register of item-entry (إدخال مواد) permits. Same
 * shape as the security register: search + New toolbar, table, and URL-bound
 * detail / form dialogs (`item`, `itemAction`) that don't collide with the
 * security tab's `open` / `action`.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { PackagePlus, Plus } from 'lucide-react'

import { api, type ItemPermitRead } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonRow } from '@/components/ui/skeleton'
import { useCapabilities } from '@/lib/useCapabilities'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useSearchParam, useUrlOverlay } from '@/lib/urlState'
import { ItemPermitFormDialog } from './ItemPermitFormDialog'
import { ItemPermitDetailDialog } from './ItemPermitDetailDialog'
import { approvalTone, fmtDate, zoneTone, type PermitApprovalState } from './permitUtils'

const searchCls =
  'h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function ItemPermitsTab(): React.JSX.Element {
  const { t } = useTranslation()
  const { has, isLoading: capabilitiesLoading } = useCapabilities()
  const canCreate = has('permits.create')

  const [q, setQ] = useSearchParam('iq')
  const detailOverlay = useUrlOverlay('item')
  const actionOverlay = useUrlOverlay('itemAction')
  const [editing, setEditing] = useState<ItemPermitRead | null>(null)

  const debouncedQ = useDebouncedValue(q, 300)
  const params = useMemo(() => ({ q: debouncedQ || undefined, limit: 500 }), [debouncedQ])
  const detailId = detailOverlay.value === null ? null : Number(detailOverlay.value)
  const formOpen = actionOverlay.value === 'new' || editing !== null

  useEffect(() => {
    if (capabilitiesLoading || actionOverlay.value !== 'new' || canCreate) return
    actionOverlay.close()
  }, [actionOverlay, actionOverlay.value, canCreate, capabilitiesLoading])

  const listQuery = useQuery({
    queryKey: ['item-permits-list', params],
    queryFn: () => api.listItemPermits(params),
  })
  const rows = listQuery.data?.items ?? []

  const openNew = (): void => {
    setEditing(null)
    actionOverlay.open('new')
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className={searchCls}
          placeholder={t('permits.items.search')}
          aria-label={t('permits.items.search')}
          value={q}
          dir="auto"
          onChange={(e) => setQ(e.target.value || null)}
        />
        {canCreate && (
          <Button type="button" size="sm" className="ms-auto" onClick={openNew}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden />
            {t('permits.items.new')}
          </Button>
        )}
      </div>

      {listQuery.isError ? (
        <p className="py-8 text-center text-sm text-destructive">{t('permits.items.loadError')}</p>
      ) : listQuery.isLoading ? (
        <div className="overflow-hidden rounded-xl border border-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} cols={7} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          message={q ? t('permits.items.empty') : t('permits.items.emptyRegister')}
          {...(!q && canCreate ? { actionLabel: t('permits.items.new'), onAction: openNew } : {})}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('permits.items.columns.ref')}</TableHead>
                <TableHead>{t('permits.items.columns.employee')}</TableHead>
                <TableHead>{t('permits.items.columns.zone')}</TableHead>
                <TableHead>{t('permits.items.columns.items')}</TableHead>
                <TableHead>{t('permits.items.columns.approval')}</TableHead>
                <TableHead>{t('permits.items.columns.created')}</TableHead>
                <TableHead className="w-16 text-end">{t('permits.columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <ItemPermitRow
                  key={row.id}
                  row={row}
                  onOpen={() => detailOverlay.open(String(row.id))}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ItemPermitFormDialog
        open={formOpen}
        permit={editing}
        onOpenChange={(open) => {
          if (open) return
          setEditing(null)
          if (actionOverlay.value === 'new') actionOverlay.close()
        }}
        onSaved={(p) => {
          // After editing from the detail dialog, keep the detail open on it.
          if (editing && String(p.id) !== detailOverlay.value) detailOverlay.open(String(p.id))
        }}
      />
      {detailId !== null && Number.isFinite(detailId) && (
        <ItemPermitDetailDialog
          permitId={detailId}
          open
          onOpenChange={(open) => !open && detailOverlay.close()}
          onNotFound={() => detailOverlay.close()}
          onEdit={(p) => setEditing(p)}
        />
      )}
    </>
  )
}

function ItemPermitRow({
  row,
  onOpen,
}: {
  row: ItemPermitRead
  onOpen: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const approval = (row.approval_state ?? 'none') as PermitApprovalState
  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell className="whitespace-nowrap font-mono text-xs" dir="ltr">
        {row.book_ref ?? '—'}
      </TableCell>
      <TableCell>
        <div className="max-w-[14rem] truncate font-medium" dir="auto">
          {i18n.language.startsWith('ar') ? row.employee_name : row.employee_name_en}
        </div>
        <div className="font-mono text-xs text-muted-foreground" dir="ltr">
          {row.employee_id}
        </div>
      </TableCell>
      <TableCell>
        <Badge tone={zoneTone(row.zone)} shape="square">
          {t(`permits.zone.${row.zone}`)}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="text-xs font-medium">{t('permits.items.count', { count: row.items.length })}</div>
        <div className="max-w-[16rem] truncate text-xs text-muted-foreground" dir="auto">
          {row.items
            .slice(0, 3)
            .map((i) => i.name)
            .join(i18n.language.startsWith('ar') ? '، ' : ', ')}
          {row.items.length > 3 && ` ${t('permits.items.more', { count: row.items.length - 3 })}`}
        </div>
      </TableCell>
      <TableCell>
        {row.book_id ? (
          <Badge tone={approvalTone(approval)}>{t(`permits.approval.${approval}`)}</Badge>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {fmtDate(row.created_at)}
      </TableCell>
      {/* Keyboard-reachable open (the row's onClick is mouse-only). */}
      <TableCell className="w-16 text-end" onClick={(e) => e.stopPropagation()}>
        <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
          {t('permits.actions.view')}
        </Button>
      </TableCell>
    </TableRow>
  )
}
