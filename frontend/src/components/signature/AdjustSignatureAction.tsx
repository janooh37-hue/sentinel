/**
 * AdjustSignatureAction — the entry point into the signature placement
 * workspace, keyed by Document ID (approval-signature-placement plan §9.1).
 *
 * Backed by the CHEAP unmeasured `GET /signature-editor` description — never
 * launches Word merely to decide whether to show the button. Renders
 * nothing for a reader without correction authority; an unavailable source
 * also renders nothing here (the workspace itself explains why, once
 * opened) rather than a fake selectable control.
 */

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { PenLine } from 'lucide-react'

import { api } from '@/lib/api'

/** Trigger data for a menu-hosted rendering of `AdjustSignatureAction` (record
 *  page Tools dropdown) — see `onTriggerChange` below. */
export interface AdjustSignatureTrigger {
  label: string
  icon: React.ReactNode
  onClick: () => void
}

interface AdjustSignatureActionProps {
  documentId: number
  /** Icon-only rendering to match `HeaderBtn`'s `iconOnly` treatment when
   *  placed in the record header's permanent-tools row. */
  iconOnly?: boolean
  className?: string
  /** Suppress the default standalone rendering — used when a caller renders
   *  the trigger itself (e.g. inside a dropdown menu item) via `onTriggerChange`.
   *  The eligibility query stays owned and mounted here regardless. */
  hideTrigger?: boolean
  /** Called with the current trigger affordance (or null when the reader has
   *  no adjust/identify eligibility) on every change, so a caller can render
   *  its own menu-item markup while this component keeps owning the
   *  eligibility check — mounted independently of the caller's container. */
  onTriggerChange?: (trigger: AdjustSignatureTrigger | null) => void
}

export function AdjustSignatureAction({
  documentId,
  iconOnly = false,
  className,
  hideTrigger,
  onTriggerChange,
}: AdjustSignatureActionProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['signature-editor', documentId, 'unmeasured'],
    queryFn: () => api.getSignatureEditor(documentId),
    enabled: Number.isFinite(documentId),
    staleTime: 30_000,
  })

  const eligible = Boolean(data && (data.can_adjust || data.can_identify))
  const label = t('signaturePlacement.adjustAction')

  useEffect(() => {
    onTriggerChange?.(
      eligible
        ? {
            label,
            icon: <PenLine className="h-3.5 w-3.5" aria-hidden="true" />,
            onClick: () => navigate(`/documents/${documentId}/signature-placement`),
          }
        : null,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, label, documentId, onTriggerChange])

  if (!eligible || hideTrigger) return null

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={() => navigate(`/documents/${documentId}/signature-placement`)}
        aria-label={label}
        title={label}
        className={
          className ??
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface text-primary transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        }
      >
        <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => navigate(`/documents/${documentId}/signature-placement`)}
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted'
      }
    >
      <PenLine className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
      {label}
    </button>
  )
}
