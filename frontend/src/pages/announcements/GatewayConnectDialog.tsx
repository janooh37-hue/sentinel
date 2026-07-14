/**
 * GatewayConnectDialog — admin-only QR scan dialog for linking the WhatsApp gateway.
 *
 * Opened from the "Reconnect" button in SendToGroupPage (settings.edit-gated, so
 * admin-only by construction). While open, it polls GET /announcements/qr every
 * 20 s and GET /announcements/status every 3 s. When status flips to 'connected',
 * it invalidates the groups + status queries and auto-closes after ~1.2 s.
 *
 * Mirrors RecipientManagerDialog for Dialog.Root/Portal/Overlay/Content structure.
 */

import { useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { QrCode } from 'lucide-react'

import { api } from '@/lib/api'

interface GatewayConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const OUTLINE_PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

export function GatewayConnectDialog({
  open,
  onOpenChange,
}: GatewayConnectDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: qrData, isError: qrError } = useQuery({
    queryKey: ['gateway-qr'],
    queryFn: api.gatewayQr,
    enabled: open,
    refetchInterval: 20_000,
  })

  const { data: statusData } = useQuery({
    queryKey: ['gateway-status'],
    queryFn: api.gatewayStatus,
    enabled: open,
    refetchInterval: 3_000,
  })

  const isConnected = statusData?.state === 'connected'

  // Auto-close after success — clean up timer on unmount or if open changes
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isConnected && open) {
      void qc.invalidateQueries({ queryKey: ['announce-groups'] })
      void qc.invalidateQueries({ queryKey: ['gateway-status'] })
      closeTimerRef.current = setTimeout(() => {
        onOpenChange(false)
      }, 1200)
    }
    return () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [isConnected, open, onOpenChange, qc])

  // Derive QR image src
  const qr = qrData?.qr ?? null
  const qrSrc =
    qr === null
      ? null
      : qr.startsWith('data:')
        ? qr
        : `data:image/png;base64,${qr}`

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 motion-reduce:animate-none" />
        <Dialog.Content className="modal-centered fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-6 shadow-xl focus:outline-none">
          {/* Header */}
          <div className="mb-4 border-b border-hairline pb-4">
            <div className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" aria-hidden />
              <Dialog.Title className="text-[1.05em] font-semibold tracking-tight text-foreground" dir="auto">
                {t('sendToGroup.qr.dialogTitle')}
              </Dialog.Title>
            </div>
            <Dialog.Description className="mt-1 text-[0.86em] text-muted-foreground" dir="auto">
              {t('sendToGroup.qr.dialogHint')}
            </Dialog.Description>
          </div>

          {/* Steps — listed BEFORE the QR so first-time users see instructions first */}
          <ol className="mb-5 space-y-2">
            {(['step1', 'step2', 'step3'] as const).map((step, idx) => (
              <li key={step} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.75em] font-bold text-primary">
                  {idx + 1}
                </span>
                <span className="text-[0.87em] text-foreground" dir="auto">
                  {t(`sendToGroup.qr.${step}`)}
                </span>
              </li>
            ))}
          </ol>

          {/* QR / status area */}
          <div className="flex flex-col items-center justify-center rounded-xl border border-hairline bg-surface-raised px-4 py-6">
            {isConnected ? (
              <p
                className="text-center text-[0.92em] font-semibold text-green-600"
                dir="auto"
                role="status"
              >
                {t('sendToGroup.qr.connected')}
              </p>
            ) : qrError || (qr === null && qrData !== undefined) ? (
              <p
                className="text-center text-[0.86em] text-muted-foreground"
                dir="auto"
                role="status"
              >
                {t('sendToGroup.qr.qrError')}
              </p>
            ) : qrSrc ? (
              <img
                src={qrSrc}
                alt={t('sendToGroup.qr.dialogTitle')}
                className="h-48 w-48 rounded-lg"
              />
            ) : (
              <p
                className="text-center text-[0.86em] text-muted-foreground"
                dir="auto"
                role="status"
              >
                {t('sendToGroup.qr.waiting')}
              </p>
            )}
          </div>

          {!isConnected && (
            <p className="mt-2 text-center text-[0.78em] text-muted-foreground" dir="auto">
              {t('sendToGroup.qr.refreshing')}
            </p>
          )}

          {/* Footer */}
          <div className="mt-5 flex justify-end border-t border-hairline pt-4">
            <Dialog.Close asChild>
              <button type="button" className={OUTLINE_PILL}>
                {t('common.close')}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
