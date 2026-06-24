/**
 * NsControls — the Delay / Extend / Certificate controls for a National
 * Service leave row. Shared between the desktop RecordExpansion and the mobile
 * LeaveDetailDrawer so the mutation logic and layout pattern are identical on
 * both surfaces.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'

import { addDays } from './report/fmt'

const MICRO_LABEL =
  'text-[0.68em] font-semibold uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal'

/** Minimum shape needed from a leave record (both LeaveListItem and LeaveRead satisfy this). */
export interface NsLeaveRow {
  id: number
  employee_id: string
  start_date: string
  end_date: string
}

/** UTC-safe span in calendar days between two ISO dates. */
function spanDays(start: string, end: string): number {
  const [sy, sm, sd] = start.slice(0, 10).split('-').map(Number)
  const [ey, em, ed] = end.slice(0, 10).split('-').map(Number)
  return Math.round(
    (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000,
  )
}

export interface NsControlsProps {
  row: NsLeaveRow
  hasCertificate: boolean
  awaitingCert: boolean
  onMutated: () => void
}

export function NsControls({
  row,
  hasCertificate,
  awaitingCert,
  onMutated,
}: NsControlsProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [delayStart, setDelayStart] = useState(row.start_date)
  const [extendEnd, setExtendEnd] = useState(() => addDays(row.end_date, 7))

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync inputs when parent refetches new dates
    setDelayStart(row.start_date)
    setExtendEnd(addDays(row.end_date, 7))
  }, [row.start_date, row.end_date])

  const datesMutation = useMutation({
    mutationFn: ({ start_date, end_date }: { start_date: string; end_date: string }) =>
      api.updateLeave(row.id, { start_date, end_date }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leaves-list'] })
      void qc.invalidateQueries({ queryKey: ['leave', row.id] })
      void qc.invalidateQueries({ queryKey: ['leave-balance', row.employee_id] })
      toast.success(t('leaves.toast.datesChanged'))
      onMutated()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const certUploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadLeaveCertificate(row.id, file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leaves-list'] })
      void qc.invalidateQueries({ queryKey: ['leave', row.id] })
      void qc.invalidateQueries({ queryKey: ['leave-balance', row.employee_id] })
      toast.success(t('leaves.toast.certificateUploaded'))
      onMutated()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const certInputRef = useRef<HTMLInputElement>(null)

  function handleCertFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (file) certUploadMutation.mutate(file)
    e.target.value = ''
  }

  function handleViewCert(): void {
    void api.fetchLeaveCertificateBlob(row.id).then((blob) => {
      const url = URL.createObjectURL(blob)
      window.open(url)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
  }

  function handleDelay(): void {
    const span = spanDays(row.start_date, row.end_date)
    const newEnd = addDays(delayStart, span)
    datesMutation.mutate({ start_date: delayStart, end_date: newEnd })
  }

  const extendEndIsValid = extendEnd > row.end_date
  const anyPending = datesMutation.isPending || certUploadMutation.isPending

  return (
    <div className="flex flex-col gap-3">
      {/* Delay */}
      <div className="flex flex-col gap-1.5">
        <span className={MICRO_LABEL}>{t('leaves.report.delay')}</span>
        <p className="text-[0.72em] text-muted-foreground">
          {t('leaves.report.delayHint')}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={delayStart}
            onChange={(e) => setDelayStart(e.target.value)}
            aria-label={t('leaves.report.delay')}
            className="h-8 flex-1 rounded-md border border-hairline bg-surface px-2 font-mono text-[0.82em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            size="sm"
            onClick={handleDelay}
            disabled={anyPending || !delayStart}
            className="rounded-full"
          >
            {t('common.save')}
          </Button>
        </div>
      </div>

      {/* Extend */}
      <div className="flex flex-col gap-1.5">
        <span className={MICRO_LABEL}>{t('leaves.report.extend')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              datesMutation.mutate({
                start_date: row.start_date,
                end_date: addDays(row.end_date, 7),
              })
            }
            disabled={anyPending}
            className="rounded-full"
          >
            {t('leaves.report.extendWeek')}
          </Button>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={extendEnd}
              min={addDays(row.end_date, 1)}
              onChange={(e) => setExtendEnd(e.target.value)}
              aria-label={t('leaves.report.extendCustom')}
              className="h-8 rounded-md border border-hairline bg-surface px-2 font-mono text-[0.82em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              size="sm"
              onClick={() =>
                datesMutation.mutate({
                  start_date: row.start_date,
                  end_date: extendEnd,
                })
              }
              disabled={anyPending || !extendEndIsValid}
              className="rounded-full"
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>

      {/* Certificate */}
      <div className="flex flex-col gap-1.5">
        {awaitingCert && (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-[0.78em] text-foreground">
            {t('leaves.report.awaitingCertificate')}
          </p>
        )}
        <div className="flex items-center gap-2">
          {hasCertificate ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleViewCert}
              className="rounded-full"
            >
              {t('leaves.report.viewCertificate')}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={hasCertificate ? 'ghost' : 'secondary'}
            onClick={() => certInputRef.current?.click()}
            disabled={certUploadMutation.isPending}
            className="rounded-full"
          >
            {t('leaves.report.uploadCertificate')}
          </Button>
          <input
            ref={certInputRef}
            type="file"
            accept="application/pdf,image/*"
            className="sr-only"
            onChange={handleCertFile}
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  )
}
