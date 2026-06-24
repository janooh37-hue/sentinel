/**
 * LedgerAttachments — the attachment card grid (desktop) + compact rows
 * (mobile) for a ledger entry: preview, download, send-to-vault, and a
 * download-all-as-zip button.
 *
 * Extracted verbatim from LedgerEntryDrawer (email-detail attachments section
 * + its SendToVaultDialog / AttachmentPreviewDialog state) so both the drawer
 * and the Phase-5 reading pane share one implementation. Renders nothing when
 * there are no attachments.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Eye, FolderInput, Paperclip } from 'lucide-react'

import { api } from '@/lib/api'
import type { LedgerAttachmentMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { SendToVaultDialog } from '@/components/ledger/SendToVaultDialog'
import { AttachmentPreviewDialog } from '@/components/ledger/AttachmentPreviewDialog'
import { FileTypeIcon } from '@/components/ledger/FileTypeIcon'
import { fileKindFromName, fileMeta, formatBytes } from '@/lib/fileTypes'

interface LedgerAttachmentsProps {
  entryId: number
  attachments: LedgerAttachmentMeta[]
}

export function LedgerAttachments({
  entryId,
  attachments,
}: LedgerAttachmentsProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [vaultDialog, setVaultDialog] = useState<{
    index: number
    filename: string
  } | null>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  if (attachments.length === 0) return null

  return (
    <>
      <section
        className="rounded-2xl bg-surface px-4 py-4"
        aria-label={t('ledger.form.attachments')}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" strokeWidth={1.6} />
            {t('ledger.form.attachments')} ({attachments.length})
          </div>
          {attachments.length > 1 && (
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={() => {
                window.location.href = api.ledgerAttachmentsZipUrl(entryId)
              }}
            >
              <Download className="h-3.5 w-3.5" />
              {t('ledger.attachments.downloadAll')}
            </Button>
          )}
        </div>
        {/* Desktop card grid (≥ md) */}
        <ul className="hidden grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2 md:grid">
          {attachments.map((att, idx) => {
            const kind = fileKindFromName(att.name)
            const sizeLabel = formatBytes(att.size)
            const href = api.ledgerAttachmentUrl(entryId, att.index)
            const meta = (
              <>
                <span className="shrink-0">
                  <FileTypeIcon kind={kind} size={28} />
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-sm font-medium text-foreground"
                    dir="auto"
                    title={att.name}
                  >
                    {att.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                    <span>{fileMeta(kind).label}</span>
                    {sizeLabel && (
                      <>
                        <span className="text-border">·</span>
                        <span>{sizeLabel}</span>
                      </>
                    )}
                  </div>
                </div>
              </>
            )
            return (
              <li
                key={`${att.name}-${idx}`}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 transition hover:border-border-strong hover:bg-surface-tinted motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-sm"
              >
                {/* Click the file to preview it in-app (images/PDF/Excel
                 * render; other types show a can't-preview note). */}
                <button
                  type="button"
                  onClick={() => setPreviewIndex(idx)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={t('ledger.attachments.preview', { defaultValue: 'Preview' })}
                  aria-label={`${t('ledger.attachments.preview', { defaultValue: 'Preview' })}: ${att.name}`}
                >
                  {meta}
                </button>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(idx)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
                    aria-label={t('ledger.attachments.preview', {
                      defaultValue: 'Preview',
                    })}
                    title={t('ledger.attachments.preview', { defaultValue: 'Preview' })}
                  >
                    <Eye className="h-4 w-4" strokeWidth={1.7} />
                  </button>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
                    aria-label={t('common.download')}
                    title={t('common.download')}
                  >
                    <Download className="h-4 w-4" strokeWidth={1.7} />
                  </a>
                  <button
                    type="button"
                    onClick={() => setVaultDialog({ index: att.index, filename: att.name })}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
                    aria-label={t('ledger.vault.sendToVault', {
                      defaultValue: 'Send to vault',
                    })}
                    title={t('ledger.vault.sendToVault', {
                      defaultValue: 'Send to vault',
                    })}
                  >
                    <FolderInput className="h-4 w-4" strokeWidth={1.6} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        {/* Mobile compact attachment rows (< md) */}
        <ul className="flex flex-col divide-y divide-hairline md:hidden">
          {attachments.map((att, idx) => {
            const kind = fileKindFromName(att.name)
            const sizeLabel = formatBytes(att.size)
            const meta = fileMeta(kind)
            const href = api.ledgerAttachmentUrl(entryId, att.index)
            return (
              <li
                key={`${att.name}-${idx}-m`}
                className="flex items-center gap-2.5 py-2"
              >
                {/* Colored extension badge — design: .m-att-row__icon */}
                <span
                  aria-hidden="true"
                  className="inline-flex h-[38px] w-[34px] shrink-0 items-center justify-center rounded-md border text-[0.6rem] font-bold uppercase"
                  style={{
                    background: `color-mix(in oklab, ${meta.color} 14%, transparent)`,
                    color: meta.color,
                    borderColor: meta.color,
                  }}
                >
                  {meta.label}
                </span>
                {/* Filename + size */}
                <button
                  type="button"
                  onClick={() => setPreviewIndex(idx)}
                  className="min-w-0 flex-1 text-start"
                  aria-label={`${t('ledger.attachments.preview', { defaultValue: 'Preview' })}: ${att.name}`}
                >
                  <div
                    className="truncate text-sm font-medium text-foreground"
                    dir="ltr"
                    title={att.name}
                  >
                    {att.name}
                  </div>
                  {sizeLabel && (
                    <div className="font-mono text-xs text-muted-foreground">
                      {sizeLabel}
                    </div>
                  )}
                </button>
                {/* Download link */}
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
                  aria-label={t('common.download')}
                  title={t('common.download')}
                >
                  <Download className="h-4 w-4" strokeWidth={1.7} />
                </a>
              </li>
            )
          })}
        </ul>
      </section>

      {vaultDialog && (
        <SendToVaultDialog
          open={true}
          entryId={entryId}
          attachmentIndex={vaultDialog.index}
          filename={vaultDialog.filename}
          onClose={() => setVaultDialog(null)}
        />
      )}

      {previewIndex !== null && (
        <AttachmentPreviewDialog
          entryId={entryId}
          attachments={attachments}
          startIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </>
  )
}
