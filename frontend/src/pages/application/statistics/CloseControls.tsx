import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LockKeyhole, RotateCcw } from 'lucide-react'

import type { InmateRegisterClose, InmateRegisterMonth } from '@/lib/api'
import { useIdentity } from '@/lib/useIdentity'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatRegisterDate } from './registerModel'

interface CloseControlsProps {
  month: InmateRegisterMonth
  isWriting: boolean
  onClose: (body?: InmateRegisterClose) => void
  onReopen: () => void
}

export function CloseControls({
  month,
  isWriting,
  onClose,
  onReopen,
}: CloseControlsProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const { isAdmin } = useIdentity()
  const [closeOpen, setCloseOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [forceReason, setForceReason] = useState('')
  const [reasonError, setReasonError] = useState(false)

  if (!isAdmin) return null

  if (month.closed) {
    return (
      <div className="flex justify-end border-t border-hairline pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={isWriting}
          onClick={() => setReopenOpen(true)}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          {t('inmateStats.actions.reopen')}
        </Button>
        <ConfirmDialog
          open={reopenOpen}
          onOpenChange={setReopenOpen}
          title={t('inmateStats.close.reopenTitle')}
          description={t('inmateStats.close.reopenHint')}
          confirmLabel={t('inmateStats.close.reopenConfirm')}
          onConfirm={onReopen}
        />
      </div>
    )
  }

  const firstClosable = formatRegisterDate(month.first_closable_date, i18n.language)
  const dateToken = '__REGISTER_DATE__'
  const [notEndedBefore, notEndedAfter = ''] = t('inmateStats.close.notEnded', {
    date: dateToken,
  }).split(dateToken)
  const blocked = month.blocking.length > 0

  return (
    <section className="space-y-3 border-t border-hairline pt-4">
      {blocked ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft p-3">
          <h3 className="text-sm font-semibold">{t('inmateStats.close.blockingTitle')}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('inmateStats.close.blockingHint')}
          </p>
          <ul className="mt-3 space-y-2">
            {month.blocking.map((entry) => (
              <li key={entry.id} className="rounded-md bg-surface px-3 py-2 text-sm">
                <span className="font-medium" dir="auto">
                  {entry.name}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {entry.missing.map((field) => t(`inmateStats.missing.${field}`)).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="register-force-reason">{t('inmateStats.close.reasonLabel')}</Label>
            <Textarea
              id="register-force-reason"
              value={forceReason}
              onChange={(event) => {
                setForceReason(event.target.value)
                if (event.target.value.trim()) setReasonError(false)
              }}
              rows={3}
              dir="auto"
            />
            {reasonError ? (
              <p role="alert" className="text-xs text-destructive">
                {t('inmateStats.close.reasonRequired')}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="destructive"
            className="mt-3"
            disabled={isWriting || !month.can_close}
            onClick={() => {
              const reason = forceReason.trim()
              if (!reason) {
                setReasonError(true)
                return
              }
              onClose({ force_reason: reason })
            }}
          >
            <LockKeyhole className="h-4 w-4" aria-hidden />
            {t('inmateStats.actions.forceClose')}
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={isWriting || !month.can_close}
            onClick={() => setCloseOpen(true)}
          >
            <LockKeyhole className="h-4 w-4" aria-hidden />
            {t('inmateStats.actions.close')}
          </Button>
          <ConfirmDialog
            open={closeOpen}
            onOpenChange={setCloseOpen}
            title={t('inmateStats.close.title')}
            confirmLabel={t('inmateStats.close.confirm')}
            onConfirm={() => onClose()}
          />
        </div>
      )}

      {!month.can_close ? (
        <p className="text-xs text-muted-foreground">
          {notEndedBefore}
          <bdi dir="ltr">{firstClosable}</bdi>
          {notEndedAfter}
        </p>
      ) : null}
    </section>
  )
}
