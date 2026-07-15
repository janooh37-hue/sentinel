/**
 * SendConfirmDialog — every Send on the Send-to-Group page passes through
 * this confirmation (spec 2026-07-16): "Ready to send?" with the message
 * rendered in the real PhonePreview, recipient pills, and — when an
 * attachment mode was chosen but nothing attached — an amber warning with
 * the primary button becoming "Send anyway". One dialog, both jobs.
 */

import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { PhonePreview, type PreviewAttachment } from './MessagePreview'

export type UnfulfilledAttachment = 'upload' | 'book' | null

export function SendConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  sending,
  text,
  chatName,
  mentionNames,
  attachment,
  unfulfilled,
  groupCount,
  directCount,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  sending: boolean
  text: string
  chatName: string | null
  mentionNames: string[]
  attachment: PreviewAttachment | null
  unfulfilled: UnfulfilledAttachment
  groupCount: number
  directCount: number
}): React.JSX.Element {
  const { t } = useTranslation()

  const sendLabel =
    unfulfilled === 'upload'
      ? t('sendToGroup.confirmSend.sendAnywayFile')
      : unfulfilled === 'book'
        ? t('sendToGroup.confirmSend.sendAnywayBook')
        : t('sendToGroup.confirmSend.send')

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('sendToGroup.confirmSend.title')}</DialogTitle>
          <DialogDescription>{t('sendToGroup.confirmSend.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-4 text-sm">
          {/* Warning row — shown only when an attachment mode is chosen but unfulfilled */}
          {unfulfilled !== null && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[0.85em] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t(
                unfulfilled === 'upload'
                  ? 'sendToGroup.confirmSend.warnUpload'
                  : 'sendToGroup.confirmSend.warnBook',
              )}
            </div>
          )}

          {/* Recipient pills — each hidden when count is 0 */}
          {(groupCount > 0 || directCount > 0) && (
            <div className="flex flex-wrap gap-2">
              {groupCount > 0 && (
                <span className="inline-flex rounded-full bg-surface-tinted px-2.5 py-1 text-[0.78em] text-muted-foreground">
                  {t('sendToGroup.confirmSend.groupsPill', { count: groupCount })}
                </span>
              )}
              {directCount > 0 && (
                <span className="inline-flex rounded-full bg-surface-tinted px-2.5 py-1 text-[0.78em] text-muted-foreground">
                  {t('sendToGroup.confirmSend.directPill', { count: directCount })}
                </span>
              )}
            </div>
          )}

          {/* Live phone preview — renders exactly what recipients see */}
          <PhonePreview
            groupName={chatName}
            text={text}
            mentionNames={mentionNames}
            attachment={attachment}
          />
        </div>

        {/* Footer: stacked full-width buttons + footnote */}
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={sending}
            className={`w-full rounded-md px-5 py-2 text-[0.9em] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50 ${
              unfulfilled !== null
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {sendLabel}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-md border border-border px-5 py-2 text-[0.9em] font-medium text-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {t('sendToGroup.confirmSend.continueEditing')}
          </button>
          <p className="text-center text-[0.72em] text-muted-foreground">
            {t('sendToGroup.confirmSend.note')}
          </p>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
