/**
 * IdentityDocCard — one identity document (Emirates ID or passport) on the
 * Profile tab. Shows the record NUMBER (read-only) over realistic card art; the
 * uploaded scan is opened in a local DocumentViewerDialog on click, with
 * Replace/Delete on hover (editors). No scan → an "Add scan" affordance.
 */

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RefreshCw, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DocumentTile } from '@/components/ui/document-tile'
import { FileUploadZone } from '@/components/ui/file-upload-zone'
import { DocumentViewerDialog, type DocViewerItem } from '@/components/ui/document-viewer-dialog'
import { api, apiErrorMessage } from '@/lib/api'
import type { VaultEntry } from '@/lib/api'
import { fileKindFromName } from '@/lib/fileTypes'

import { EmiratesIdArt, PassportArt } from './identity-art'

const ACCEPT = '.pdf,.png,.jpg,.jpeg'

export interface IdentityDocCardProps {
  employeeId: string
  kind: 'uae_id' | 'passport'
  docNumber: string | null
  entry: VaultEntry | null
  canEdit: boolean
  onChanged: () => void
}

export function IdentityDocCard({
  employeeId,
  kind,
  docNumber,
  entry,
  canEdit,
  onChanged,
}: IdentityDocCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const kindLabel = t(`vault.folders.${kind}`)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const art = kind === 'uae_id' ? <EmiratesIdArt /> : <PassportArt />

  const save = useMutation({
    mutationFn: async (file: File) => {
      const saved = await api.uploadVaultFile(employeeId, kind, file)
      if (entry && entry.filename !== saved.filename) {
        try {
          await api.deleteVaultFile(employeeId, kind, entry.filename)
        } catch {
          // Orphaned old file is harmless; the new one is already saved.
        }
      }
      return saved
    },
    onSuccess: () => {
      onChanged()
      toast.success(t('vault.toast.uploaded'))
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteVaultFile(employeeId, kind, entry!.filename),
    onSuccess: () => {
      onChanged()
      toast.success(t('vault.toast.deleted'))
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const onPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0]
    if (f) save.mutate(f)
    e.target.value = ''
  }

  const numberLabel = docNumber ?? '—'

  return (
    <div className="group relative">
      <DocumentTile
        preview={art}
        type={kindLabel}
        title={numberLabel}
        meta={entry ? entry.filename : t('employee.identity.noScan')}
        onClick={entry ? () => setViewerOpen(true) : undefined}
      />

      {/* Hover actions for a present scan (editors only) */}
      {entry && canEdit && (
        <div className="absolute end-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <label className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white/90 text-foreground shadow ring-1 ring-black/5 hover:bg-white">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">{t('common.replace')}</span>
            <input type="file" accept={ACCEPT} className="hidden" onChange={onPick} disabled={save.isPending} />
          </label>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-destructive shadow ring-1 ring-black/5 hover:bg-white disabled:opacity-60"
            disabled={remove.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">{t('common.delete')}</span>
          </button>
        </div>
      )}

      {/* Add-scan affordance when there is no scan (editors only) */}
      {!entry && canEdit && (
        <div className="mt-2">
          <FileUploadZone
            accept={ACCEPT}
            busy={save.isPending}
            label={t('employee.identity.addScan')}
            onFile={(file) => save.mutate(file)}
          />
        </div>
      )}

      {entry && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('vault.confirmDelete', { filename: entry.filename })}
          confirmLabel={t('common.delete')}
          onConfirm={() => remove.mutateAsync()}
          destructive
        />
      )}

      {viewerOpen && entry && (
        <DocumentViewerDialog
          items={[buildItem(employeeId, kind, entry)]}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  )
}

function buildItem(employeeId: string, kind: 'uae_id' | 'passport', entry: VaultEntry): DocViewerItem {
  const fk = fileKindFromName(entry.filename)
  return {
    name: entry.filename,
    kind: fk,
    imageUrl: fk === 'image' ? api.vaultPreviewUrl(employeeId, kind, entry.filename) : undefined,
    pdfBase64Url: fk === 'pdf' ? api.vaultBase64Url(employeeId, kind, entry.filename) : undefined,
    openUrl: api.vaultPreviewUrl(employeeId, kind, entry.filename),
    downloadUrl: api.vaultDownloadUrl(employeeId, kind, entry.filename),
  }
}
