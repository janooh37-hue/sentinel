/**
 * AttachmentsBlock — per-form attachment slots on the Services form page
 * (forms signing paths & required attachments, spec 2026-06-11 §6; prototype
 * docs/prototypes/forms-signing-attachments-2026-06-11.html §3).
 *
 * Renders between TemplateForm and the action row on EVERY form:
 *  - one dashed row per named slot from the template policy (label EN/AR,
 *    required star / optional pill, hint), filled rows flip to a solid border
 *    with a ✓ tile + filename + remove;
 *  - a "＋ Add attachment (optional)" affordance that appends free-form extras.
 *
 * Sources per row: **Upload** (file → POST /documents/attachments/stage →
 * token) and **From Records** (RecordPaperPickerDialog). The prototype's third
 * "Scan" button folds into Upload for v1 (scanner software produces a file).
 *
 * Controlled: the parent owns `AttachmentsState` (so it can persist it in the
 * localStorage form draft and assemble `payload.attachments` on commit).
 * `onValidityChange` mirrors `missingRequired(...) === []` for Save gating.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Check, FileText, Loader2, Paperclip, Plus, Upload, X } from 'lucide-react'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { AttachmentSlotRead } from '@/lib/api'
import { formatBytes } from '@/lib/fileTypes'
import { Button } from '@/components/ui/button'
import { missingRequired } from './attachmentsState'
import type { AttachmentsState, AttachmentValue } from './attachmentsState'
import { RecordPaperPickerDialog } from './RecordPaperPickerDialog'

export type { AttachmentsState, AttachmentValue } from './attachmentsState'

/** Sentinel row key for the open free-form extra row. */
const EXTRA_ROW = '__extra__'

/** Staging accepts what the backend validates (ALLOWED_DOC_EXTS). */
const ACCEPT = '.pdf,.png,.jpg,.jpeg'

export interface AttachmentsBlockProps {
  slots: AttachmentSlotRead[]
  state: AttachmentsState
  onChange: (next: AttachmentsState) => void
  /** Mirrors `missingRequired(slots, state).length === 0`. */
  onValidityChange?: (valid: boolean) => void
}

export function AttachmentsBlock({
  slots,
  state,
  onChange,
  onValidityChange,
}: AttachmentsBlockProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')

  // Rows with a staging upload in flight (slot keys / EXTRA_ROW). A Set so
  // concurrent uploads each keep their own spinner — the first completion
  // must not clear the second row's busy state.
  const [busyRows, setBusyRows] = useState<ReadonlySet<string>>(() => new Set())
  // Which row the From-Records picker is targeting (null = closed).
  const [pickerRow, setPickerRow] = useState<string | null>(null)
  // Whether the free-form extra row is open (before it gets filled).
  const [extraOpen, setExtraOpen] = useState(false)

  const requiredTotal = slots.filter((s) => s.required).length
  const requiredFilled = slots.filter((s) => s.required && state.slots[s.key]).length
  const valid = missingRequired(slots, state).length === 0

  // Report validity to the parent whenever it flips (mount included). The
  // callback lives in a ref so an unstable parent closure doesn't re-fire it.
  const onValidityChangeRef = useRef(onValidityChange)
  useEffect(() => {
    onValidityChangeRef.current = onValidityChange
  })
  useEffect(() => {
    onValidityChangeRef.current?.(valid)
  }, [valid])

  // Latest state for the mutators below. `stageFile` commits after an await,
  // so building the next state from the render-time `state` prop would
  // overwrite anything that changed while the upload was in flight — a
  // concurrent upload's result silently dropped, or a removed attachment
  // resurrected. Synced after every render (parent-driven changes) AND
  // eagerly on commit (two uploads can resolve in the same microtask flush,
  // before React re-renders).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  const commit = (next: AttachmentsState): void => {
    stateRef.current = next
    onChange(next)
  }

  const applyValue = (rowKey: string, value: AttachmentValue): void => {
    const current = stateRef.current
    if (rowKey === EXTRA_ROW) {
      commit({ ...current, extras: [...current.extras, value] })
      setExtraOpen(false)
    } else {
      commit({ ...current, slots: { ...current.slots, [rowKey]: value } })
    }
  }

  const clearSlot = (slotKey: string): void => {
    const current = stateRef.current
    commit({ ...current, slots: { ...current.slots, [slotKey]: null } })
  }

  const removeExtra = (index: number): void => {
    const current = stateRef.current
    commit({ ...current, extras: current.extras.filter((_, i) => i !== index) })
  }

  const stageFile = async (rowKey: string, file: File): Promise<void> => {
    setBusyRows((prev) => new Set(prev).add(rowKey))
    try {
      const res = await api.stageAttachment(file)
      applyValue(rowKey, {
        kind: 'staged',
        token: res.token,
        filename: res.filename,
        size: res.size,
      })
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : t('application.attachments.uploadFailed'),
      )
    } finally {
      setBusyRows((prev) => {
        const next = new Set(prev)
        next.delete(rowKey)
        return next
      })
    }
  }

  const pickLabel = (slot: AttachmentSlotRead): string =>
    isAr ? slot.label_ar || slot.label_en : slot.label_en
  const pickHint = (slot: AttachmentSlotRead): string =>
    isAr ? slot.hint_ar || slot.hint_en : slot.hint_en

  return (
    <section
      aria-label={t('application.attachments.title')}
      className="mt-6 rounded-xl border border-hairline bg-surface-tinted/40 p-3.5"
    >
      {/* Header — title + required counter (or a quiet "optional" tag). */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-[0.82em] font-semibold text-foreground">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden />
          {t('application.attachments.title')}
        </h3>
        {requiredTotal > 0 ? (
          <span
            className={[
              'text-[0.72em] font-medium',
              requiredFilled >= requiredTotal ? 'text-success' : 'text-warning',
            ].join(' ')}
          >
            {t('application.attachments.requiredCount', {
              filled: requiredFilled,
              total: requiredTotal,
            })}
            {requiredFilled >= requiredTotal ? ' ✓' : ''}
          </span>
        ) : (
          <span className="text-[0.72em] font-medium text-faint">
            {t('application.attachments.optional')}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {/* Named slots from the template policy. */}
        {slots.map((slot) => {
          const value = state.slots[slot.key] ?? null
          return (
            <SlotRow
              key={slot.key}
              testId={`attach-slot-${slot.key}`}
              label={pickLabel(slot)}
              required={slot.required}
              hint={pickHint(slot)}
              value={value}
              busy={busyRows.has(slot.key)}
              onFile={(file) => void stageFile(slot.key, file)}
              onFromRecords={() => setPickerRow(slot.key)}
              onRemove={() => clearSlot(slot.key)}
              inputTestId={`attach-input-${slot.key}`}
            />
          )
        })}

        {/* Filled free-form extras. */}
        {state.extras.map((value, index) => (
          <SlotRow
            key={`extra-${index}`}
            testId={`attach-extra-${index}`}
            label={t('application.attachments.extra')}
            required={false}
            hint=""
            value={value}
            busy={false}
            onFile={() => undefined}
            onFromRecords={() => undefined}
            onRemove={() => removeExtra(index)}
            inputTestId={`attach-extra-input-${index}`}
          />
        ))}

        {/* Open (still empty) free-form row. */}
        {extraOpen && (
          <SlotRow
            testId="attach-extra-row"
            label={t('application.attachments.extra')}
            required={false}
            hint={t('application.attachments.extraHint')}
            value={null}
            busy={busyRows.has(EXTRA_ROW)}
            onFile={(file) => void stageFile(EXTRA_ROW, file)}
            onFromRecords={() => setPickerRow(EXTRA_ROW)}
            onRemove={() => setExtraOpen(false)}
            inputTestId="attach-extra-input"
            dismissible
          />
        )}
      </div>

      {/* ＋ Add attachment (optional) — appends a free-form extra row. */}
      {!extraOpen && (
        <button
          type="button"
          onClick={() => setExtraOpen(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-3 py-1.5 text-[0.78em] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          {t('application.attachments.addOptional')}
        </button>
      )}

      <RecordPaperPickerDialog
        open={pickerRow !== null}
        onOpenChange={(open) => {
          if (!open) setPickerRow(null)
        }}
        onPick={(value) => {
          if (pickerRow !== null) applyValue(pickerRow, value)
          setPickerRow(null)
        }}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// One slot / extra row — dashed when empty, solid + ✓ tile when filled.
// ---------------------------------------------------------------------------

function SlotRow({
  testId,
  label,
  required,
  hint,
  value,
  busy,
  onFile,
  onFromRecords,
  onRemove,
  inputTestId,
  dismissible = false,
}: {
  testId: string
  label: string
  required: boolean
  hint: string
  value: AttachmentValue | null
  busy: boolean
  onFile: (file: File) => void
  onFromRecords: () => void
  onRemove: () => void
  inputTestId: string
  /** Empty extra row: the ✕ closes the row rather than clearing a value. */
  dismissible?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const filled = value !== null

  return (
    <div
      data-testid={testId}
      className={[
        'flex items-center gap-2.5 rounded-lg border bg-surface px-3 py-2.5',
        filled ? 'border-solid border-border' : 'border-dashed border-border-strong',
      ].join(' ')}
    >
      {/* Icon tile — paper glyph when empty, ✓ when filled, spinner when busy. */}
      <span
        className={[
          'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
          filled ? 'bg-success-soft text-success' : 'bg-surface-tinted text-muted-foreground',
        ].join(' ')}
        aria-hidden
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={1.8} />
        ) : filled ? (
          <Check className="h-4 w-4" strokeWidth={2} />
        ) : (
          <FileText className="h-4 w-4" strokeWidth={1.8} />
        )}
      </span>

      {/* Label + meta / hint. */}
      <div className="min-w-0 flex-1">
        <div className="text-[0.8em] font-semibold leading-snug text-foreground">
          {label}{' '}
          {required ? (
            <span className="font-bold text-accent" aria-label={t('application.attachments.required')}>
              *
            </span>
          ) : (
            <span className="ms-0.5 inline-block rounded-full bg-surface-tinted px-1.5 py-px align-middle text-[0.78em] font-medium lowercase text-muted-foreground">
              {t('application.attachments.optional')}
            </span>
          )}
        </div>
        {filled ? (
          <div className="mt-0.5 truncate text-[0.74em] text-muted-foreground">
            <ValueMeta value={value} />
          </div>
        ) : (
          <>
            <div className="mt-0.5 text-[0.74em] text-muted-foreground">
              {busy
                ? t('application.attachments.uploading')
                : `${t('application.attachments.notAttached')}${
                    required ? ` · ${t('application.attachments.required')}` : ''
                  }`}
            </div>
            {hint && (
              <div className="mt-0.5 text-[0.72em] leading-snug text-faint">{hint}</div>
            )}
          </>
        )}
      </div>

      {/* Sources (empty) / remove (filled or dismissible-empty). */}
      {filled ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label={t('application.attachments.remove')}
          className="shrink-0 text-faint hover:text-accent"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        </Button>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            data-testid={inputTestId}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onFile(file)
              // Reset so re-picking the same file fires onChange again.
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3 w-3" strokeWidth={1.8} aria-hidden />
            {t('application.attachments.upload')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={onFromRecords}
          >
            <Archive className="h-3 w-3" strokeWidth={1.8} aria-hidden />
            {t('application.attachments.fromRecords')}
          </Button>
          {dismissible && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              aria-label={t('application.attachments.dismiss')}
              className="text-faint hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Filled-row meta line: filename · size for uploads; record label otherwise.
 * Filenames / refs are latin-script — pin them LTR inside RTL text. */
function ValueMeta({ value }: { value: AttachmentValue }): React.JSX.Element {
  const { t } = useTranslation()
  if (value.kind === 'staged') {
    const size = formatBytes(value.size)
    return (
      <>
        <span dir="ltr">{value.filename}</span>
        {size ? ` · ${size}` : ''} · {t('application.attachments.uploaded')}
      </>
    )
  }
  return (
    <>
      <Archive className="me-1 inline-block h-3 w-3 align-[-2px] text-muted-foreground" strokeWidth={1.8} aria-hidden />
      <span dir="ltr">{value.label}</span>
    </>
  )
}
