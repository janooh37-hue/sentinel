/**
 * LeaveDigestPanel — per-unit annual-leave digest preview and send panel.
 *
 * Lets an operator preview the leave digest for the active duty unit (shows the
 * count of employees currently on annual leave + a sample message in the current
 * UI language), then send the digest to all configured supervisors for that unit.
 *
 * Props:
 *  - unit: the active duty unit key (Arabic name).  Must not be UNASSIGNED.
 *
 * Calls /digests/leave/preview (GET) and /digests/leave/send (POST).
 * Bilingual (AR/EN) via useTranslation(); logical CSS; dir="auto" on text.
 *
 * Sample language choice: shows sample_ar when the UI language is 'ar',
 * sample_en otherwise.  This matches the actual message that the AR-language
 * supervisor receives, so what the operator previews is what is sent.
 */

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, type DigestPreview, type DigestSendResult, type DigestSkipOut } from '@/lib/api'

interface Props {
  /** Active duty unit (Arabic name). Must not be UNASSIGNED. */
  unit: string
}

export function LeaveDigestPanel({ unit }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()

  const [preview, setPreview] = useState<DigestPreview | null>(null)
  const [sendResult, setSendResult] = useState<DigestSendResult | null>(null)

  const previewMut = useMutation({
    mutationFn: () => api.previewLeaveDigest(unit),
    onSuccess: (data) => {
      setPreview(data)
      setSendResult(null)
    },
    onError: () => {
      toast.error(t('leaveDigest.previewError'))
    },
  })

  const sendMut = useMutation({
    mutationFn: () => api.sendLeaveDigest(unit),
    onSuccess: (data) => {
      setSendResult(data)
      setPreview(null)
    },
    onError: () => {
      toast.error(t('leaveDigest.sendError'))
    },
  })

  function reasonLabel(skip: DigestSkipOut): string {
    if (skip.reason === 'no_supervisor') return t('leaveDigest.noSupervisor')
    if (skip.reason === 'no_leaves') return t('leaveDigest.noLeaves')
    return t('leaveDigest.unknownReason')
  }

  const sample =
    preview
      ? i18n.language === 'ar'
        ? preview.sample_ar
        : preview.sample_en
      : null

  return (
    <div className="border-t border-hairline px-4 py-4 sm:px-5">
      {/* Section header */}
      <div className="mb-3">
        <p className="text-[0.9em] font-semibold text-foreground">
          {t('leaveDigest.title')}
        </p>
        <p className="text-[0.78em] text-muted-foreground">
          {t('leaveDigest.subtitle')}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => previewMut.mutate()}
          disabled={previewMut.isPending || sendMut.isPending}
          className="h-8 rounded-md border border-border bg-surface px-3 text-[0.82em] font-medium text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
        >
          {t('leaveDigest.preview')}
        </button>
        <button
          type="button"
          onClick={() => sendMut.mutate()}
          disabled={sendMut.isPending || previewMut.isPending}
          className="h-8 rounded-md bg-primary px-3 text-[0.82em] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
        >
          {t('leaveDigest.sendNow')}
        </button>
      </div>

      {/* Preview result */}
      {preview && (
        <div className="mt-3 space-y-2">
          <p className="text-[0.84em] font-medium text-foreground" dir="auto">
            {t('leaveDigest.count', { count: preview.count })}
          </p>
          {sample && (
            <pre
              dir="auto"
              className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 px-3 py-2 text-[0.78em] text-foreground"
            >
              {sample}
            </pre>
          )}
        </div>
      )}

      {/* Send result */}
      {sendResult && (
        <div className="mt-3 space-y-1">
          <p className="text-[0.84em] font-medium text-foreground" dir="auto">
            {t('leaveDigest.sent', { count: sendResult.sent })}
          </p>
          {sendResult.skips.length > 0 && (
            <ul className="space-y-0.5">
              {sendResult.skips.map((skip) => (
                <li
                  key={skip.duty_unit}
                  className="text-[0.78em] text-muted-foreground"
                  dir="auto"
                >
                  {t('leaveDigest.skipped', { reason: reasonLabel(skip) })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
