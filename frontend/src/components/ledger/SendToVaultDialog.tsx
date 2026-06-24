/**
 * SendToVaultDialog — copy a ledger attachment into an employee's vault folder.
 *
 * Opened from a per-attachment button in the ledger detail view. Picks an
 * employee + a vault kind, then calls `api.sendAttachmentToVault`. The source
 * file stays attached to the ledger entry — this is a copy, not a move.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FolderInput, Loader2 } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { VaultKind } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmployeePicker } from '@/pages/application/EmployeePicker'

const KIND_OPTIONS: readonly VaultKind[] = [
  'uae_id',
  'passport',
  'other',
  'leaves',
  'violations',
]

interface SendToVaultDialogProps {
  open: boolean
  entryId: number
  attachmentIndex: number
  filename: string
  onClose: () => void
}

export function SendToVaultDialog({
  open,
  entryId,
  attachmentIndex,
  filename,
  onClose,
}: SendToVaultDialogProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // The parent re-mounts this dialog on every open, so initial state is fresh
  // without needing a reset effect.
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [kind, setKind] = useState<VaultKind>('other')

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const sendMutation = useMutation({
    mutationFn: () =>
      api.sendAttachmentToVault(entryId, attachmentIndex, employeeId!, kind),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vault', employeeId] })
      toast.success(
        t('ledger.vault.dialog.sentTo', {
          defaultValue: 'Sent to {{id}}',
          id: employeeId,
        }),
      )
      onClose()
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('ledger.vault.dialog.title')}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-lg bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <FolderInput className="h-5 w-5 text-muted-foreground" strokeWidth={1.6} />
          <h2 className="text-base font-semibold text-foreground">
            {t('ledger.vault.dialog.title')}
          </h2>
        </div>

        <p className="text-xs text-muted-foreground" dir="auto">
          <span className="font-mono">{filename}</span>
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">
            {t('application.employeePicker.placeholder')}
          </span>
          <EmployeePicker selectedId={employeeId} onSelect={setEmployeeId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground" htmlFor="vault-kind">
            {t('ledger.vault.dialog.kind')}
          </label>
          <Select value={kind} onValueChange={(v) => setKind(v as VaultKind)}>
            <SelectTrigger id="vault-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`vault.folders.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => sendMutation.mutate()}
            disabled={!employeeId || sendMutation.isPending}
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderInput className="h-3.5 w-3.5" />
            )}
            {t('ledger.vault.dialog.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
