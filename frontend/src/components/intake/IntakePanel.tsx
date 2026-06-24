/**
 * IntakePanel — the shared core for the global Scan intake surface.
 *
 * Flow:
 *   1. Dropzone → api.postIntake(file)
 *   2a. returned_form → confirm card with Attach / Dismiss
 *   2b. external → recognition card (detected type chip, matched-employee
 *       banner, read-only field list) + a single route CTA
 *
 * This is a RECOGNITION + ROUTING surface only — no editable form.
 * The ExtractionReviewPanel (editable) lives at the destination and is
 * pre-loaded via location.state.injectedExtraction (Task 5).
 *
 * A11y: RTL logical props, semantic tokens, never color-only signals.
 */

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, ScanLine, UserCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { ApiError, api, type ExternalOut, type IntakeResponse, type ReturnedFormOut } from '@/lib/api'
import type { ExtractionResponse } from '@/lib/extraction'
import { pickEmployeeName } from '@/lib/employeeName'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// ─── types ────────────────────────────────────────────────────────────────────

/** Reconstruct a full ExtractionResponse from an ExternalOut so consumers
 *  (TemplateForm, EmployeeForm) receive the exact shape they already handle.
 *  Synthetic id=0 since this wasn't persisted by the intake endpoint. */
function externalToInjection(ext: ExternalOut): ExtractionResponse {
  return {
    id: 0,
    document_type: ext.document_type,
    document_type_confidence: ext.document_type_confidence,
    alternatives: ext.alternatives,
    fields: ext.extraction,
    matched_employee_id: ext.matched_employee_id,
    match_score: ext.match_score,
    matched_employee_name_en: ext.matched_employee_name_en,
    matched_employee_name_ar: ext.matched_employee_name_ar,
  }
}

// ─── dropzone ─────────────────────────────────────────────────────────────────

const ACCEPT = 'image/*,application/pdf'

/** Max accepted file size on drop/pick (10 MB). */
const MAX_INTAKE_BYTES = 10 * 1024 * 1024

function isAcceptedType(file: File): boolean {
  return file.type === 'application/pdf' || file.type.startsWith('image/')
}

interface DropzoneProps {
  onResult: (file: File, result: IntakeResponse) => void
}

function Dropzone({ onResult }: DropzoneProps): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)

  async function runIntake(file: File): Promise<void> {
    setScanning(true)
    try {
      const result = await api.postIntake(file)
      onResult(file, result)
    } catch (err) {
      const is503 = err instanceof ApiError && err.status === 503
      const message = is503
        ? t('intake.error.unavailable')
        : t('intake.error.generic')
      toast.error(message)
    } finally {
      setScanning(false)
    }
  }

  function handleFiles(files: FileList | null): void {
    const file = files?.[0]
    if (!file) return
    if (!isAcceptedType(file)) {
      setRejected(t('intake.error.unsupportedType'))
      return
    }
    if (file.size > MAX_INTAKE_BYTES) {
      setRejected(t('intake.error.tooLarge', { max: '10 MB' }))
      return
    }
    setRejected(null)
    void runIntake(file)
  }

  return (
    <div className="space-y-1.5">
    <div
      role="button"
      tabIndex={0}
      aria-label={t('intake.scanButton')}
      onClick={() => !scanning && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !scanning) {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
      className={[
        'flex cursor-pointer flex-col items-center justify-center gap-1.5',
        'rounded-lg border border-dashed px-4 py-6 text-center',
        'transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        dragging
          ? 'border-primary bg-primary-soft'
          : 'border-border hover:border-primary hover:bg-surface-tinted',
        scanning ? 'pointer-events-none opacity-70' : '',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => handleFiles(e.target.files)}
        onClick={(e) => {
          ;(e.target as HTMLInputElement).value = ''
        }}
      />
      {scanning ? (
        <>
          <Loader2
            role="status"
            aria-label={t('extraction.dropzone.scanning')}
            strokeWidth={2}
            className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none"
          />
          <span className="text-xs text-muted-foreground">
            {t('extraction.dropzone.scanning')}
          </span>
        </>
      ) : (
        <>
          <ScanLine
            aria-hidden
            strokeWidth={1.75}
            className={dragging ? 'h-5 w-5 text-primary' : 'h-5 w-5 text-muted-foreground'}
          />
          <span className="text-sm font-medium text-foreground">
            {t('extraction.dropzone.cta')}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('extraction.dropzone.hint.generic')}
          </span>
        </>
      )}
    </div>
      {rejected && (
        <p role="alert" className="text-xs text-destructive">
          {rejected}
        </p>
      )}
    </div>
  )
}

// ─── returned_form card ───────────────────────────────────────────────────────

export interface ReturnedFormCardProps {
  result: ReturnedFormOut
  file: File
  onDismiss: () => void
}

export function ReturnedFormCard({ result, file, onDismiss }: ReturnedFormCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [attaching, setAttaching] = useState(false)
  const [attached, setAttached] = useState(false)

  /** true for states where the document is a draft/pending approval and the
   *  scanned copy could be the signed version that should approve it. */
  const isDraft =
    result.approval_state === 'none' || result.approval_state === 'pending'

  const stateLabel =
    result.approval_state === 'none'
      ? t('intake.returnedForm.stateDraft')
      : result.approval_state === 'pending'
        ? t('intake.returnedForm.statePending')
        : result.approval_state === 'awaiting_scan'
          ? t('intake.returnedForm.stateAwaitingScan')
          : null

  async function run(asSigned: boolean): Promise<void> {
    setAttaching(true)
    try {
      await api.addBookAttachment(result.book_id, file, asSigned)
      setAttached(true)
      toast.success(
        asSigned
          ? t('intake.returnedForm.approved', { ref: result.ref_number })
          : t('intake.returnedForm.attached', { ref: result.ref_number }),
      )
      void qc.invalidateQueries({ queryKey: ['books'] })
    } catch {
      toast.error(t('intake.error.generic'))
    } finally {
      setAttaching(false)
    }
  }

  return (
    <Card className="border-border bg-surface-raised">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ScanLine aria-hidden strokeWidth={1.75} className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            {t('intake.returnedForm.title')}
          </h3>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-foreground">
          <strong>{result.ref_number}</strong>
          {result.category ? ` — ${result.category}` : ''}
          {result.employee_name ? ` · ${result.employee_name}` : ''}
          {stateLabel ? ` · ${stateLabel}` : ''}
        </p>

        {attached ? (
          <div className="flex items-center justify-between">
            <span className="text-sm text-success">
              {t('intake.returnedForm.attached', { ref: result.ref_number })}
            </span>
            <Link
              to={`/books?open=${result.book_id}`}
              className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
            >
              {t('intake.returnedForm.viewRecord')}
            </Link>
          </div>
        ) : isDraft ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium text-foreground">
              {t('intake.returnedForm.isSignedCopy')}
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
                {t('intake.returnedForm.dismiss')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={attaching}
                onClick={() => void run(false)}
              >
                {t('intake.returnedForm.justAttach')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={attaching}
                onClick={() => void run(true)}
              >
                {attaching ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                ) : null}
                {t('intake.returnedForm.approve')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
              {t('intake.returnedForm.dismiss')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={attaching}
              onClick={() => void run(false)}
            >
              {attaching ? (
                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : null}
              {t('intake.returnedForm.attach')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── external recognition card ────────────────────────────────────────────────

interface ExternalCardProps {
  result: ExternalOut
  onDismiss: () => void
}

function ExternalCard({ result, onDismiss }: ExternalCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const docTypeLabel = t(`extraction.doctype.${result.document_type}`, {
    defaultValue: result.document_type,
  })

  const injection = externalToInjection(result)
  const matched = !!result.matched_employee_id
  const matchedName = matched
    ? pickEmployeeName(
        {
          name_en: result.matched_employee_name_en ?? result.matched_employee_id ?? '',
          name_ar: result.matched_employee_name_ar,
        },
        i18n.language,
      )
    : null

  function handleRoute(): void {
    const { route_kind } = result
    const id = result.matched_employee_id

    if (route_kind === 'employee') {
      if (matched && id) {
        navigate(`/employees/${id}`, { state: { injectedExtraction: injection } })
      } else {
        navigate('/employees', { state: { injectedExtraction: injection, openCreate: true } })
      }
    } else if (route_kind === 'salary_transfer') {
      const q = matched && id ? `&employee_id=${id}` : ''
      navigate(`/application?form=${result.route_form_slug ?? 'salary_transfer_request'}${q}`, {
        state: { injectedExtraction: injection },
      })
    } else if (route_kind === 'leave') {
      const q = matched && id ? `&employee_id=${id}` : ''
      navigate(`/application?form=${result.route_form_slug ?? 'leave_application'}${q}`, {
        state: { injectedExtraction: injection },
      })
    }
    // manual handled separately (two buttons)
  }

  const isManual = result.route_kind === 'manual'

  return (
    <Card className="border-border bg-surface-raised">
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-center gap-2">
          <ScanLine aria-hidden strokeWidth={1.75} className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            {t('intake.external.detected')}
          </h3>
          <span className="ms-auto inline-flex items-center rounded-full bg-surface-tinted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {docTypeLabel}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Matched-employee banner */}
        {matched && matchedName && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-tinted px-3 py-2">
            <UserCheck aria-hidden strokeWidth={1.75} className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-xs text-foreground">
              {Number.isFinite(result.match_score)
                ? t('intake.external.matched', {
                    name: matchedName,
                    id: result.matched_employee_id,
                    pct: Math.round(result.match_score * 100),
                  })
                : t('intake.external.matchedNoPct', {
                    name: matchedName,
                    id: result.matched_employee_id,
                  })}
            </span>
          </div>
        )}

        {/* Read-only field list */}
        {result.extraction.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('intake.external.fields')}
            </p>
            {result.extraction.map((f) => (
              <div key={f.key} className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {t(`extraction.fields.${f.key}`, { defaultValue: f.key })}
                </span>
                <span
                  className="max-w-[60%] truncate text-end text-xs font-medium text-foreground"
                  dir="auto"
                >
                  {f.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Route CTAs */}
        <div className="border-t border-border pt-3">
          {isManual ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('intake.external.manualTitle')}</p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/application')}
                >
                  {t('intake.external.openForm')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/ledger')}
                >
                  {t('intake.external.logLedger')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
                {t('extraction.panel.dismiss')}
              </Button>
              <Button type="button" size="sm" onClick={handleRoute}>
                {result.route_kind === 'employee' && matched
                  ? t('intake.external.openRecord', { name: matchedName })
                  : result.route_kind === 'employee'
                    ? t('intake.external.createEmployee')
                    : result.route_kind === 'salary_transfer'
                      ? t('intake.external.newSalaryTransfer')
                      : t('intake.external.newLeave')}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── IntakePanel (exported) ───────────────────────────────────────────────────

interface ResultState {
  file: File
  result: IntakeResponse
}

export function IntakePanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [resultState, setResultState] = useState<ResultState | null>(null)

  function handleResult(file: File, result: IntakeResponse): void {
    setResultState({ file, result })
  }

  function handleDismiss(): void {
    setResultState(null)
  }

  return (
    <div className="space-y-4">
      {!resultState && (
        <Dropzone onResult={handleResult} />
      )}

      {resultState && resultState.result.mode === 'returned_form' && (
        <ReturnedFormCard
          result={resultState.result}
          file={resultState.file}
          onDismiss={handleDismiss}
        />
      )}

      {resultState && resultState.result.mode === 'external' && (
        <ExternalCard result={resultState.result} onDismiss={handleDismiss} />
      )}

      {resultState && (
        <button
          type="button"
          onClick={handleDismiss}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
        >
          {t('intake.scanAnother')}
        </button>
      )}
    </div>
  )
}
