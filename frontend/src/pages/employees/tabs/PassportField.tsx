/**
 * PassportField — passport number row with status badge, inline edit, and
 * "Read from scan" OCR action.
 *
 * Props:
 *   employeeId    — employee G-number (for PATCH + extract calls)
 *   passportNo    — current stored value (null = not set)
 *   source        — 'mrz' | 'manual' | null (provenance tag, shown as hint)
 *   hasScan       — whether a passport vault scan exists (drives 'review' badge
 *                   and shows the "Read from scan" button)
 *   canEdit       — gated by employees.edit; caller passes this in from
 *                   useCapabilities so tests can control it without mocking
 *                   the capability hook
 *
 * Badge logic:
 *   passportNo present  → "Verified"
 *   no value + hasScan  → "Needs review"
 *   no value + no scan  → "Missing"
 *
 * OCR flow: "Read from scan" → POST extract (never writes) → operator sees
 *   suggested value with Confirm / Dismiss buttons → Confirm → PATCH saves.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { PassportSuggestion } from '@/lib/api'

export interface PassportFieldProps {
  employeeId: string
  passportNo: string | null
  source: string | null
  hasScan: boolean
  canEdit?: boolean
  onSaved?: () => void
}

type BadgeKind = 'verified' | 'review' | 'missing'

function badgeOf(passportNo: string | null, hasScan: boolean): BadgeKind {
  if (passportNo) return 'verified'
  return hasScan ? 'review' : 'missing'
}

const BADGE_CLASSES: Record<BadgeKind, string> = {
  verified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  missing: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

export function PassportField({
  employeeId,
  passportNo,
  source,
  hasScan,
  canEdit = false,
  onSaved,
}: PassportFieldProps): React.JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = useState(passportNo ?? '')
  const [busy, setBusy] = useState(false)
  const [suggestion, setSuggestion] = useState<PassportSuggestion | null>(null)

  const kind = badgeOf(value.trim() || null, hasScan)

  async function readFromScan(): Promise<void> {
    setBusy(true)
    try {
      const s = await api.extractPassport(employeeId)
      setSuggestion(s)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function save(next: string): Promise<void> {
    const trimmed = next.trim()
    try {
      await api.updateEmployee(employeeId, { passport_no: trimmed || null })
      setValue(trimmed)
      toast.success(t('common.savedToast'))
      onSaved?.()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    }
  }

  return (
    <div className="rounded-2xl bg-surface p-4 md:p-5">
      {/* Header row: label + badge + source hint */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('employees.passport.label')}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-wide ${BADGE_CLASSES[kind]}`}>
          {t(`employees.passport.badge.${kind}`)}
        </span>
        {source && (
          <span className="text-[0.72em] uppercase tracking-wide text-faint">
            {source}
          </span>
        )}
      </div>

      {/* Value / editable input */}
      {canEdit ? (
        <div className="flex gap-2">
          <input
            id={`passport_no_${employeeId}`}
            className="h-8 flex-1 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (value.trim() !== (passportNo ?? '')) {
                void save(value)
              }
            }}
            placeholder={t('employees.fields.passport_no')}
          />
          {hasScan && (
            <button
              type="button"
              className="h-8 rounded border border-input px-3 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void readFromScan()}
              disabled={busy}
            >
              {busy ? t('common.loading') : t('employees.passport.readFromScan')}
            </button>
          )}
        </div>
      ) : (
        <div className="text-[0.95em] text-foreground">
          {value || <span className="text-faint">—</span>}
        </div>
      )}

      {/* OCR suggestion confirm/dismiss row */}
      {suggestion && (
        <div
          role="group"
          aria-label={t('employees.passport.suggested')}
          className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-sm"
        >
          {suggestion.number ? (
            <>
              <span className="text-muted-foreground">{t('employees.passport.suggested')}:</span>
              <span className="font-mono font-semibold">{suggestion.number}</span>
              <div className="ms-auto flex gap-2">
                <button
                  type="button"
                  className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                  onClick={() => {
                    void save(suggestion.number!)
                    setSuggestion(null)
                  }}
                >
                  {t('common.confirm')}
                </button>
                <button
                  type="button"
                  className="rounded border border-input px-2.5 py-1 text-xs font-medium hover:bg-muted"
                  onClick={() => setSuggestion(null)}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-muted-foreground">{t('employees.passport.notFound')}</span>
              <div className="ms-auto">
                <button
                  type="button"
                  className="rounded border border-input px-2.5 py-1 text-xs font-medium hover:bg-muted"
                  onClick={() => setSuggestion(null)}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
