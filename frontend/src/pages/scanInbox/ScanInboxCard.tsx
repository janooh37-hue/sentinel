/**
 * ScanInboxCard — one triage card for a ScanInboxItem.
 *
 * Expands in place to show the scanned document + what the OCR read, so the
 * operator can verify before acting. Actions scale to state:
 *  - awaiting_confirmation → File-to-proposal chip + Match… + Dismiss
 *  - unrouted / error      → candidate chips (if any) + Match… + Dismiss
 *  - auto_filed            → destination deep-link + Undo + Wrong? Re-match
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { ScanInboxItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { Button } from '@/components/ui/button'
import { ScanMatchDialog } from './ScanMatchDialog'
import { isPdf } from './scanPreview'

export function ScanInboxCard({ item }: { item: ScanInboxItem }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)

  const empName =
    item.proposed_employee_name_en !== null
      ? pickEmployeeName(
          { name_en: item.proposed_employee_name_en, name_ar: item.proposed_employee_name_ar },
          i18n.language,
        )
      : ''

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['scan-inbox'] })
  const onErr = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t('scanInbox.toast.error'))

  const confirm = useMutation({
    mutationFn: () => api.confirmScanItem(item.id),
    onSuccess: () => { invalidate(); toast.success(t('scanInbox.toast.filed')) },
    onError: onErr,
  })
  const dismiss = useMutation({
    mutationFn: () => api.dismissScanItem(item.id),
    onSuccess: () => { invalidate(); toast.success(t('scanInbox.toast.dismissed')) },
    onError: onErr,
  })
  const undo = useMutation({
    mutationFn: () => api.undoScanItem(item.id),
    onSuccess: () => { invalidate(); toast.success(t('scanInbox.toast.undone')) },
    onError: onErr,
  })
  const chipRoute = useMutation({
    mutationFn: (employeeId: string) => api.routeScanItem(item.id, { employee_id: employeeId }),
    onSuccess: () => { invalidate(); toast.success(t('scanInbox.toast.filed')) },
    onError: onErr,
  })

  const destLabel =
    item.proposed_route === 'book_attach' ? item.proposed_ref ?? '' : empName
  const destHref =
    item.proposed_route === 'book_attach' && item.proposed_book_id !== null
      ? `/books/${item.proposed_book_id}`
      : item.proposed_employee_id !== null
        ? `/employees/${encodeURIComponent(item.proposed_employee_id)}`
        : null

  const headline = (() => {
    if (item.state === 'error') return t('scanInbox.errorRead')
    if (item.state === 'auto_filed') return t('scanInbox.filedTo', { dest: destLabel })
    if (item.proposed_route === 'book_attach' && item.proposed_ref)
      return t('scanInbox.confirmBook', { ref: item.proposed_ref })
    if (item.proposed_route === 'employee_doc' && empName)
      return t('scanInbox.confirmEmployee', { type: item.document_type ?? '', name: empName })
    return t('scanInbox.manual')
  })()

  const canConfirm =
    (item.state === 'awaiting_confirmation' || item.state === 'unrouted') &&
    item.confidence_tier !== 'manual' &&
    (item.proposed_route === 'book_attach' || item.proposed_route === 'employee_doc')

  const fieldEntries = Object.entries(item.fields ?? {}).filter(([, v]) => v)

  const url = api.scanDocumentUrl(item.id)

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[0.78em] text-muted-foreground" dir="auto">
            {item.email_sender ? t('scanInbox.fromEmail', { sender: item.email_sender }) : item.filename}
          </div>
          {item.email_subject && (
            <div className="truncate text-[0.86em] font-medium text-foreground" dir="auto">
              {item.email_subject}
            </div>
          )}
          <p className="mt-2 text-[0.95em] text-foreground" dir="auto">{headline}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={t(expanded ? 'scanInbox.hideDetails' : 'scanInbox.showDetails')}
          className="flex-none rounded-md p-1 text-muted-foreground hover:bg-surface-tinted"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 grid gap-3 rounded-lg border border-hairline bg-surface-raised p-3 sm:grid-cols-[minmax(0,180px)_1fr]">
          <div className="h-[180px] overflow-hidden rounded-md border border-border bg-surface">
            {isPdf(item.filename) ? (
              <object data={url} type="application/pdf" className="h-full w-full" aria-label={item.filename} />
            ) : (
              <img src={url} alt={item.filename} className="h-full w-full object-contain" />
            )}
          </div>
          <div className="min-w-0 text-[0.82em]">
            {item.state !== 'error' && fieldEntries.length > 0 && (
              <>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  {t('scanInbox.ocrRead')}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  {fieldEntries.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">
                        {t(`scanInbox.ocrField.${k}`, { defaultValue: k })}
                      </dt>
                      <dd className="truncate text-foreground" dir="auto">{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[0.9em] text-muted-foreground hover:text-foreground">
              {t('scanInbox.openFullDoc')}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </div>
      )}

      {/* Candidate chips (unrouted / couldn't-read) */}
      {item.state !== 'auto_filed' && item.candidates.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
            {t('scanInbox.bestGuesses')}
          </div>
          <div className="flex flex-wrap gap-2">
            {item.candidates.map((c) => (
              <button
                key={c.employee_id}
                type="button"
                disabled={chipRoute.isPending}
                onClick={() => chipRoute.mutate(c.employee_id)}
                className="rounded-full border border-primary/40 bg-primary-soft px-3 py-1 text-[0.8em] font-medium text-primary hover:bg-primary/10"
              >
                {t('scanInbox.fileTo', { dest: pickEmployeeName({ name_en: c.name_en, name_ar: c.name_ar }, i18n.language) })}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action row */}
      <div className="mt-3 flex flex-wrap gap-2">
        {item.state === 'auto_filed' ? (
          <>
            {destHref && (
              <a
                href={destHref}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[0.8em] font-medium text-primary hover:bg-surface-tinted"
              >
                {t('scanInbox.openInFile')}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
            <Button variant="outline" size="sm" onClick={() => undo.mutate()} disabled={undo.isPending}>
              {t('scanInbox.actions.undo')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={undo.isPending}
              onClick={async () => {
                try {
                  await undo.mutateAsync()
                  setMatchOpen(true)
                } catch { /* toast already shown */ }
              }}
            >
              {t('scanInbox.reMatch')}
            </Button>
          </>
        ) : (
          <>
            {canConfirm && (
              <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
                {t('scanInbox.fileTo', { dest: destLabel })}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setMatchOpen(true)}>
              {t('scanInbox.actions.match')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
              {t('scanInbox.actions.dismiss')}
            </Button>
          </>
        )}
      </div>

      {matchOpen && <ScanMatchDialog item={item} onClose={() => setMatchOpen(false)} />}
    </div>
  )
}
