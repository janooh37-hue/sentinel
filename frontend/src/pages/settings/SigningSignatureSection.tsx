/**
 * SigningSignatureSection — the per-user *signing* signature.
 *
 * Distinct from the email signature and the employee-vault signature: this is
 * the handwritten signature embedded into a book's PDF when the signed-in
 * manager approves/signs it (POST /auth/me/signature). `GET /auth/me` reports
 * whether one is on file via `has_signature`.
 *
 * Rendered as a TAMM section card on SettingsPage.
 *
 * Task 6 — Signature appearance block: Size + Boldness RangeSliders with a
 * debounced live preview image. Settings are read from the `settings` prop
 * (same pattern as AppearanceSection / DefaultsSection in SettingsPage) and
 * written via the `onUpdate` callback which calls the existing settings PATCH.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, FileSignature } from 'lucide-react'

import { api, apiErrorMessage } from '@/lib/api'
import type { AppSettingsRead, AppSettingsUpdate } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { RangeSlider } from '@/components/ui/range-slider'
import {
  BOLDNESS_LABELS,
  SIG_BOLDNESS_DEFAULT,
  SIG_BOLDNESS_MAX,
  SIG_BOLDNESS_MIN,
  SIG_PREVIEW_REFERENCE_MM,
  SIG_SIZE_DEFAULT_MM,
  SIG_SIZE_MAX_MM,
  SIG_SIZE_MIN_MM,
} from '@/components/signature/signatureAppearance'

// ---------------------------------------------------------------------------
// Appearance sub-block
// ---------------------------------------------------------------------------

interface AppearanceBlockProps {
  settings: AppSettingsRead
  onUpdate: (u: AppSettingsUpdate) => void
}

function AppearanceBlock({ settings, onUpdate }: AppearanceBlockProps): React.JSX.Element {
  const { t } = useTranslation()

  // Local slider state — initialised from settings so sliders respond
  // immediately without waiting for the debounced PATCH to round-trip.
  // After mount, local state is the source of truth; we intentionally do NOT
  // re-sync from the prop on each PATCH round-trip (that would fight an
  // in-progress drag). The component is keyed on the settings object in
  // SettingsPage so it resets correctly if settings are reloaded from scratch.
  const [sizeMm, setSizeMm] = useState<number>(
    settings.signature_size_mm ?? SIG_SIZE_DEFAULT_MM,
  )
  const [boldness, setBoldness] = useState<number>(
    settings.signature_boldness ?? SIG_BOLDNESS_DEFAULT,
  )

  // Debounce the PATCH so rapid slider drags don't flood the network (~400ms).
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedulePatch = useCallback(
    (patch: AppSettingsUpdate) => {
      if (patchTimer.current !== null) clearTimeout(patchTimer.current)
      patchTimer.current = setTimeout(() => {
        onUpdate(patch)
        patchTimer.current = null
      }, 400)
    },
    [onUpdate],
  )

  const handleSizeChange = useCallback(
    (next: number) => {
      setSizeMm(next)
      schedulePatch({ signature_size_mm: next })
    },
    [schedulePatch],
  )

  const handleBoldnessChange = useCallback(
    (next: number) => {
      setBoldness(next)
      schedulePatch({ signature_boldness: next })
    },
    [schedulePatch],
  )

  // Clean up any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (patchTimer.current !== null) clearTimeout(patchTimer.current)
    }
  }, [])

  // ---- Live preview via api.previewSignature (debounced ~250ms) ----
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewMissing, setPreviewMissing] = useState(false)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedulePreview = useCallback((size: number, bold: number) => {
    if (previewTimer.current !== null) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => {
      void api
        .previewSignature({ size_mm: size, boldness: bold })
        .then((res) => {
          previewTimer.current = null
          setPreviewUrl(res.data_url)
          setPreviewMissing(false)
        })
        .catch((err: unknown) => {
          previewTimer.current = null
          const status = (err as { status?: number }).status
          if (status === 404) {
            setPreviewUrl(null)
            setPreviewMissing(true)
          }
          // Other errors: leave the last preview intact (network blip).
        })
    }, 250)
  }, [])

  // Initial preview load + update whenever sliders change.
  useEffect(() => {
    schedulePreview(sizeMm, boldness)
    return () => {
      if (previewTimer.current !== null) clearTimeout(previewTimer.current)
    }
  }, [sizeMm, boldness, schedulePreview])

  return (
    <div className="mt-6 border-t border-hairline pt-6">
      {/* Section header */}
      <div className="mb-4">
        <h4 className="text-base font-semibold tracking-tight text-foreground">
          {t('settings.sigAppearance.title')}
        </h4>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t('settings.sigAppearance.description')}
        </p>
      </div>

      <div className="space-y-5">
        {/* Size slider */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-foreground">
              {t('settings.sigAppearance.size')}
            </div>
            <span className="text-sm text-muted-foreground">{sizeMm} mm</span>
          </div>
          <RangeSlider
            value={sizeMm}
            min={SIG_SIZE_MIN_MM}
            max={SIG_SIZE_MAX_MM}
            step={1}
            onChange={handleSizeChange}
            ariaLabel={t('settings.sigAppearance.size')}
          />
        </div>

        {/* Boldness slider */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-foreground">
              {t('settings.sigAppearance.boldness')}
            </div>
            <span className="text-sm text-muted-foreground">
              {t(`settings.sigAppearance.level.${BOLDNESS_LABELS[boldness] ?? 'none'}`)}
            </span>
          </div>
          <RangeSlider
            value={boldness}
            min={SIG_BOLDNESS_MIN}
            max={SIG_BOLDNESS_MAX}
            step={1}
            onChange={handleBoldnessChange}
            ariaLabel={t('settings.sigAppearance.boldness')}
          />
        </div>

        {/* Live preview — shown at true scale against a page-width reference so
            dragging Size visibly grows/shrinks the signature on its baseline. */}
        <div className="space-y-1.5">
          <div className="rounded-lg border border-hairline bg-surface-raised px-4 pb-3 pt-5">
            {previewMissing ? (
              <p className="py-4 text-center text-[0.82em] text-muted-foreground">
                {t('settings.sigAppearance.noSignature')}
              </p>
            ) : previewUrl === null ? (
              /* still loading the first preview — quiet placeholder */
              <div className="h-16" />
            ) : (
              <div className="relative w-full">
                {/* signature, bottom-resting on the line, width = page fraction */}
                <div className="flex h-20 items-end justify-center">
                  <img
                    src={previewUrl}
                    alt={t('settings.sigAppearance.title')}
                    className="block"
                    style={{
                      width: `${(sizeMm / SIG_PREVIEW_REFERENCE_MM) * 100}%`,
                      maxHeight: '5rem',
                      objectFit: 'contain',
                      objectPosition: 'bottom',
                    }}
                  />
                </div>
                {/* the page signature line */}
                <div className="border-t border-dashed border-border-strong" />
              </div>
            )}
          </div>
          {!previewMissing && previewUrl !== null && (
            <p className="text-center text-[0.72em] text-muted-foreground">
              {t('settings.sigAppearance.pageScaleHint')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main section export
// ---------------------------------------------------------------------------

export function SigningSignatureSection({
  settings,
  onUpdate,
}: {
  settings?: AppSettingsRead
  onUpdate?: (u: AppSettingsUpdate) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { user, refetch } = useAuth()
  const hasSignature = user?.has_signature ?? false

  const wrapRef = useRef<HTMLDivElement>(null)
  const padRef = useRef<SignatureCanvas | null>(null)
  const [width, setWidth] = useState(0)
  const [busy, setBusy] = useState(false)
  // Show the drawing pad immediately when there's no signature; otherwise the
  // operator opts in to replacing the existing one.
  const [editing, setEditing] = useState(!hasSignature)

  useEffect(() => {
    if (!editing) return
    const el = wrapRef.current
    if (!el) return
    setWidth(el.clientWidth)
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [editing])

  const clear = useCallback(() => {
    padRef.current?.clear()
  }, [])

  const save = useCallback(async () => {
    const pad = padRef.current
    if (!pad || pad.isEmpty()) return
    setBusy(true)
    try {
      const dataUrl = pad.getCanvas().toDataURL('image/png')
      const blob = await (await fetch(dataUrl)).blob()
      await api.uploadMySignature(blob)
      await refetch()
      toast.success(t('settings.signingSignature.saved'))
      setEditing(false)
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [refetch, t])

  const remove = useCallback(async () => {
    setBusy(true)
    try {
      await api.deleteMySignature()
      await refetch()
      toast.success(t('settings.signingSignature.removed'))
      setEditing(true)
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [refetch, t])

  return (
    <section className="rounded-2xl bg-surface p-6">
      <div className="mb-4 border-b border-hairline pb-4">
        <div className="flex items-start gap-2.5">
          <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />
          <div className="min-w-0">
            <h3 className="text-[1.05em] font-semibold tracking-tight text-foreground">
              {t('settings.signingSignature.title')}
            </h3>
            <p className="mt-1 text-[0.86em] text-muted-foreground">
              {t('settings.signingSignature.description')}
            </p>
          </div>
        </div>
      </div>

      {hasSignature && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-[0.84em] font-medium text-success">
            {t('settings.signingSignature.onFile')}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('settings.signingSignature.replace')}
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.82em] font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('settings.signingSignature.remove')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div
            ref={wrapRef}
            className="w-full overflow-hidden rounded-md border border-dashed border-border-strong bg-surface-raised"
          >
            {width > 0 && (
              <SignatureCanvas
                ref={padRef}
                penColor="#1a1a1f"
                canvasProps={{ width, height: 160 }}
              />
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            {hasSignature && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
            )}
            <button
              type="button"
              onClick={clear}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('settings.signingSignature.clear')}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('settings.signingSignature.save')}
            </button>
          </div>
        </div>
      )}

      {/* Appearance block — only rendered when settings are available */}
      {settings && onUpdate && (
        <AppearanceBlock settings={settings} onUpdate={onUpdate} />
      )}
    </section>
  )
}
