/**
 * Every action a fine row offers, gated by payment/archive state — shared by
 * the vehicle-detail fines panel and the fleet-wide ledger so the gating
 * matrix (archived vs. active, unknown/unpaid/paid) lives in exactly one
 * place: the archive view only ever offers Restore (never edit/delete/
 * payment), an active paid row offers Archive (never edit/delete's
 * destructive twin), and payment actions never appear once a fine is paid.
 */

import { Archive, ArchiveRestore, Paperclip, Pencil, Tag, Trash2, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { VehicleFineRead } from '@/lib/api'

export interface FineActionCallbacks {
  onEdit: (fine: VehicleFineRead) => void
  onDelete: (fine: VehicleFineRead) => void
  onRecordPayment: (fine: VehicleFineRead) => void
  onAttachReceipt: (fine: VehicleFineRead) => void
  onMarkUnpaid: (fine: VehicleFineRead) => void
  onArchive: (fine: VehicleFineRead) => void
  onRestore: (fine: VehicleFineRead) => void
}

export function FineActions({
  fine,
  canEdit,
  canDelete,
  busy,
  onEdit,
  onDelete,
  onRecordPayment,
  onAttachReceipt,
  onMarkUnpaid,
  onArchive,
  onRestore,
}: FineActionCallbacks & {
  fine: VehicleFineRead
  canEdit: boolean
  canDelete: boolean
  busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const archived = Boolean(fine.archived_at)

  if (archived) {
    return (
      <div className="flex items-center justify-end gap-1">
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={t('vehicles.fines.restore')}
            title={t('vehicles.fines.restore')}
            onClick={() => onRestore(fine)}
          >
            <ArchiveRestore className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit && fine.payment_status === 'unknown' && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={t('vehicles.fines.markUnpaid')}
          title={t('vehicles.fines.markUnpaid')}
          onClick={() => onMarkUnpaid(fine)}
        >
          <Tag className="h-4 w-4" aria-hidden />
        </Button>
      )}
      {canEdit && fine.payment_status !== 'paid' && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('vehicles.fines.recordPayment')}
          title={t('vehicles.fines.recordPayment')}
          onClick={() => onRecordPayment(fine)}
        >
          <Wallet className="h-4 w-4" aria-hidden />
        </Button>
      )}
      {canEdit && fine.payment_status === 'paid' && !fine.receipt && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('vehicles.fines.attachReceipt')}
          title={t('vehicles.fines.attachReceipt')}
          onClick={() => onAttachReceipt(fine)}
        >
          <Paperclip className="h-4 w-4" aria-hidden />
        </Button>
      )}
      {canEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('vehicles.editFine')}
          title={t('vehicles.editFine')}
          onClick={() => onEdit(fine)}
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
      )}
      {canDelete && fine.payment_status === 'paid' && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={t('vehicles.fines.archive')}
          title={t('vehicles.fines.archive')}
          onClick={() => onArchive(fine)}
        >
          <Archive className="h-4 w-4" aria-hidden />
        </Button>
      )}
      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={busy}
          aria-label={t('vehicles.delete')}
          title={t('vehicles.delete')}
          onClick={() => onDelete(fine)}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}
