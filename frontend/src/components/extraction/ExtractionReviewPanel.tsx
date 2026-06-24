/**
 * ExtractionReviewPanel — review and edit OCR-extracted fields before applying
 * them to a host form.
 *
 * Props:
 *   result    — the ExtractionResponse returned by POST /api/v1/extractions.
 *   fieldMap  — maps extracted field key → host form field name. Only keys
 *               present in fieldMap are shown.
 *   onAccept  — called with { [hostFieldName]: value } when "Apply" is pressed.
 *               Nothing is written to the form until the operator presses Apply.
 *   onDismiss — called when "Dismiss" is pressed.
 *
 * A11y: confidence is communicated via icon + text label + color — never color
 *       alone. RTL-aware via Tailwind logical-property utilities.
 */

import { useState } from 'react'
import { AlertTriangle, Check, ScanLine, UserCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ExtractionResponse } from '@/lib/extraction'
import { pickEmployeeName } from '@/lib/employeeName'

export interface ExtractionReviewPanelProps {
  result: ExtractionResponse
  /**
   * Maps extracted field key → the host form's field name.
   * Only fields whose key appears in this map are rendered.
   */
  fieldMap: Record<string, string>
  onAccept: (accepted: Record<string, string>) => void
  onDismiss: () => void
}

export function ExtractionReviewPanel({
  result,
  fieldMap,
  onAccept,
  onDismiss,
}: ExtractionReviewPanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()

  // Seed local state from result.fields — only include fields present in fieldMap.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of result.fields) {
      if (f.key in fieldMap) {
        init[f.key] = f.value
      }
    }
    return init
  })

  // Build a lookup for confidence by key.
  const confidenceByKey = Object.fromEntries(result.fields.map((f) => [f.key, f.confidence]))

  // Rows to render: extracted keys present in fieldMap.
  const rows = Object.entries(fieldMap).filter(([extractedKey]) => extractedKey in values)

  function handleApply(): void {
    // Map current (possibly edited) values through fieldMap: extracted key → host field.
    const accepted: Record<string, string> = {}
    for (const [extractedKey, hostField] of rows) {
      if (values[extractedKey] !== undefined) {
        accepted[hostField] = values[extractedKey]
      }
    }
    onAccept(accepted)
  }

  const hasAmbiguity = result.alternatives.length > 0
  const docTypeLabel = t(`extraction.doctype.${result.document_type}`, {
    defaultValue: result.document_type,
  })

  return (
    <Card className="border-border bg-surface-raised">
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-center gap-2">
          <ScanLine aria-hidden strokeWidth={1.75} className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t('extraction.panel.title')}</h3>
          <span className="ms-auto inline-flex items-center rounded-full bg-surface-tinted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {docTypeLabel}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t('extraction.panel.subtitle')}</p>
        {hasAmbiguity && (
          <p className="text-xs text-warning">
            {t('extraction.panel.ambiguity', {
              type: docTypeLabel,
              alts: result.alternatives
                .map((a) => t(`extraction.doctype.${a}`, { defaultValue: a }))
                .join(', '),
            })}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {result.matched_employee_id && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-tinted px-3 py-2">
            <UserCheck aria-hidden strokeWidth={1.75} className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-xs text-foreground">
              {(() => {
                const name = pickEmployeeName(
                  {
                    name_en: result.matched_employee_name_en ?? result.matched_employee_id ?? '',
                    name_ar: result.matched_employee_name_ar,
                  },
                  i18n.language,
                )
                const id = result.matched_employee_id
                return Number.isFinite(result.match_score) && result.match_score > 0
                  ? t('extraction.panel.matched', {
                      name,
                      id,
                      pct: Math.round(result.match_score * 100),
                    })
                  : t('extraction.panel.matchedNoPct', { name, id })
              })()}
            </span>
          </div>
        )}

        {rows.map(([extractedKey]) => {
          const conf = confidenceByKey[extractedKey] ?? 0
          const isConfident = conf >= 0.85
          return (
            <div key={extractedKey} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={`extraction-field-${extractedKey}`}
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t(`extraction.fields.${extractedKey}`, { defaultValue: extractedKey })}
                </label>
                {/* Confidence indicator — icon + text + color (never color alone). */}
                <span
                  data-testid={`confidence-${extractedKey}`}
                  data-confidence={isConfident ? 'confident' : 'review'}
                  className={[
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
                    'text-xs font-semibold leading-none',
                    isConfident ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
                  ].join(' ')}
                >
                  {isConfident ? (
                    <Check aria-hidden strokeWidth={2.5} className="h-3 w-3" />
                  ) : (
                    <AlertTriangle aria-hidden strokeWidth={2.5} className="h-3 w-3" />
                  )}
                  {isConfident ? t('extraction.panel.confident') : t('extraction.panel.review')}
                </span>
              </div>
              <Input
                id={`extraction-field-${extractedKey}`}
                value={values[extractedKey] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [extractedKey]: e.target.value }))
                }
                className={[
                  'h-9 text-sm',
                  isConfident ? '' : 'ring-1 ring-warning/30',
                ].join(' ')}
              />
            </div>
          )
        })}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            {t('extraction.panel.dismiss')}
          </Button>
          <Button type="button" size="sm" onClick={handleApply}>
            {t('extraction.panel.apply')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
