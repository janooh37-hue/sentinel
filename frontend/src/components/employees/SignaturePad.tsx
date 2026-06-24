/**
 * SignaturePad — profile signature manager card.
 *
 * States:
 *  loading     → pulse placeholder
 *  saved + not replacing  → preview img + info line; if canEdit: Replace + Remove
 *  none / replacing + canEdit → SignatureDrawPanel (upload = save to profile)
 *  none + !canEdit         → muted one-liner
 *  saved + !canEdit        → preview + info line only
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SignatureDrawPanel } from '@/components/signature/SignatureDrawPanel'
import { api, ApiError } from '@/lib/api'

export function SignaturePad({
  employeeId,
  canEdit,
  onSaved,
}: {
  employeeId: string
  canEdit: boolean
  onSaved?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['employee-signature', employeeId],
    queryFn: () => api.getEmployeeSignature(employeeId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const save = async (dataUrl: string): Promise<void> => {
    setBusy(true)
    try {
      const blob = await (await fetch(dataUrl)).blob()
      await api.uploadSignature(employeeId, blob)
      toast.success(t('empSig.saved'))
      setReplacing(false)
      void qc.invalidateQueries({ queryKey: ['employee-signature', employeeId] })
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    try {
      await api.deleteEmployeeSignature(employeeId)
      toast.success(t('empSig.removed'))
      void qc.invalidateQueries({ queryKey: ['employee-signature', employeeId] })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err))
    }
  }

  // Status pill
  const hasSig = !!data?.dataUrl
  const pill = hasSig ? (
    <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
      ✓ {t('empSig.loaded')}
    </span>
  ) : isLoading ? null : (
    <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
      {t('empSig.none')}
    </span>
  )

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>{t('vault.signature.title')}</CardTitle>
            {pill}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            // Loading skeleton
            <div className="h-24 w-full animate-pulse rounded-md bg-surface-raised" />
          ) : hasSig && !replacing ? (
            // Saved + not replacing
            <div className="space-y-2">
              <div className="max-h-24 overflow-hidden rounded border border-border bg-white p-2">
                <img
                  src={data.dataUrl}
                  alt={t('vault.signature.title')}
                  className="max-h-20 object-contain"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('empSig.savedOn', { id: employeeId })}
                {' · '}
                {data.updatedAt
                  ? t('empSig.updatedAt', {
                      date: new Date(data.updatedAt).toLocaleDateString(),
                    })
                  : t('empSig.justNow')}
              </p>
              {canEdit && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setReplacing(true)}
                  >
                    {t('empSig.replace')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-accent"
                    onClick={() => setRemoveOpen(true)}
                  >
                    {t('empSig.remove')}
                  </Button>
                </div>
              )}
            </div>
          ) : canEdit ? (
            // None OR replacing → draw panel
            <SignatureDrawPanel
              showSaveToProfile={false}
              onUse={(d) => void save(d)}
              onCancel={replacing ? () => setReplacing(false) : undefined}
              busy={busy}
            />
          ) : (
            // None + viewer
            <p className="text-sm text-muted-foreground">{t('empSig.none')}</p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('empSig.removeConfirmTitle')}
        description={t('empSig.removeConfirmBody')}
        confirmLabel={t('empSig.remove')}
        onConfirm={() => void remove()}
        destructive
      />
    </>
  )
}
