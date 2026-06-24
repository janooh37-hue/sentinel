/**
 * SignatureField — wraps Phase 03's SignaturePad for use inside TemplateForm.
 *
 * Unlike the employee profile's SignaturePad (which uploads directly to the
 * vault), this version captures the signature data URL into RHF state so it
 * travels with the form submission.
 *
 * The `name` field receives a base64 data URL string. The backend's
 * DocumentGenerateRequest can then embed it directly or write it to a temp
 * file as needed (the docx_render `_resolve_sig` helper already accepts
 * `data:image/...;base64,...` for any `<name>_sig_path` token — see
 * backend/app/core/docx_render.py).
 *
 * Round 2 — Fix E:
 *  - The saved signature on file is surfaced as a thumbnail preview but
 *    NEVER auto-bound to the form value. Operators opt in explicitly via
 *    Replace (to draw) or — future — a dedicated "Use saved" button.
 *  - The paired inline checkbox is now an EMBED toggle (semantics inverted
 *    from the old "hand-sign" flag). Checked = embed the signature image;
 *    unchecked (default) = leave the cell blank for an ink signature.
 */

import { useCallback, useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { Controller, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { SIGNATURE_PEN } from '@/components/signature/penConfig'
import type { FieldProps } from '../types'

interface SignatureFieldProps extends FieldProps {
  /**
   * Optional paired embed-signature checkbox field name. When provided, the
   * signature card hosts a small "Embed saved signature" toggle as a footer
   * so the two controls live together visually. Bound RHF path is e.g.
   * "embed_signature.manager".
   */
  embedToggleName?: string
  /** Localized label for the paired embed-signature toggle. */
  embedToggleLabelEn?: string
  embedToggleLabelAr?: string
}

export function SignatureField({
  name,
  label_en,
  label_ar,
  embedToggleName,
  embedToggleLabelEn,
  embedToggleLabelAr,
}: SignatureFieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en
  const embedLabel = isAr ? embedToggleLabelAr : embedToggleLabelEn

  const { control, getValues } = useFormContext()
  const embedChecked = useWatch({
    control,
    name: embedToggleName ?? '__none__',
  }) as boolean | undefined

  // Fetch the user's saved signature once on mount. 404 → null (no sig on
  // file); other errors are swallowed (the field still works without a
  // saved sig — the operator can draw).
  const { data: savedSig, isLoading: savedLoading } = useQuery<string | null>({
    queryKey: ['signatures', 'me'],
    queryFn: () => api.getSavedSignature(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  // When the user explicitly clicks "Replace", we hide the saved-sig card and
  // show the draw pad. This stays local — we don't refetch the saved sig.
  const [replaceMode, setReplaceMode] = useState(false)

  const padRef = useRef<SignatureCanvas | null>(null)
  const [width, setWidth] = useState(0)

  // Callback ref so the observer rewires the instant the wrapper DOM node
  // changes — covers the saved-sig → draw-pad branch flip (Replace click),
  // which a one-shot `useEffect(ResizeObserver, [])` misses because the ref
  // re-points to a brand-new node without re-running the effect.
  const observerRef = useRef<ResizeObserver | null>(null)
  const setWrapRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) {
      setWidth(0)
      return
    }
    // Seed width synchronously so the canvas can mount on the same paint.
    setWidth(Math.floor(node.getBoundingClientRect().width))
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setWidth(Math.floor(w))
    })
    ro.observe(node)
    observerRef.current = ro
  }, [])

  // savedSig is intentionally not auto-bound. Round 2 — Fix E inverted the
  // signature-embed default (operator now opts in explicitly), so we no
  // longer copy the saved data URL into the form value on mount. A future
  // "Use saved" button will set the field value explicitly — until then the
  // saved-sig card surfaces it for visual confirmation only. `getValues` is
  // kept in scope intentionally; the next iteration of this card will use
  // it when wiring a "Use saved" affordance.
  void getValues

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const clear = () => {
          padRef.current?.clear()
          field.onChange(undefined)
        }

        const capture = () => {
          const pad = padRef.current
          if (!pad || pad.isEmpty()) return
          field.onChange(pad.getCanvas().toDataURL('image/png'))
        }

        // Saved-sig card is shown when a saved sig is on file and the
        // operator hasn't clicked Replace.
        const showSavedSigCard = !!savedSig && !replaceMode

        return (
          <Card className="col-span-1 sm:col-span-2">
            <CardHeader>
              <CardTitle>{label}</CardTitle>
              {!showSavedSigCard && (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={clear}
                  >
                    {t('vault.signature.clear')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={capture}
                  >
                    {t('vault.signature.save')}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {showSavedSigCard ? (
                <div
                  ref={setWrapRef}
                  className="flex flex-col items-stretch gap-3 rounded-md border border-border bg-surface-raised p-3 sm:flex-row sm:items-center"
                  data-testid="saved-signature-card"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={savedSig}
                      alt={t('application.savedSignature.heading')}
                      className="h-16 w-32 rounded border border-border bg-white object-contain"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">
                        {t('application.savedSignature.heading')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('application.savedSignature.inUse')}
                      </span>
                    </div>
                  </div>
                  <div className="flex sm:ms-auto">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-h-11 w-full sm:w-auto"
                      onClick={() => {
                        // Drop any captured data URL, flip into draw mode.
                        field.onChange(undefined)
                        setReplaceMode(true)
                      }}
                    >
                      {t('application.savedSignature.replace')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    ref={setWrapRef}
                    className="w-full overflow-hidden rounded-md border border-dashed border-border-strong bg-surface-raised"
                  >
                    {width > 0 && (
                      <SignatureCanvas
                        ref={padRef}
                        {...SIGNATURE_PEN}
                        canvasProps={{ width, height: 160 }}
                      />
                    )}
                  </div>
                  {field.value && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {t('vault.signature.saved')}
                    </p>
                  )}
                  {savedLoading && !savedSig && !replaceMode && (
                    <p
                      className="mt-1.5 text-xs text-muted-foreground"
                      role="status"
                    >
                      {t('common.loading')}
                    </p>
                  )}
                </>
              )}
              {embedToggleName && (
                <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-foreground">
                  <Controller
                    control={control}
                    name={embedToggleName}
                    render={({ field: emField }) => (
                      <input
                        type="checkbox"
                        checked={!!emField.value}
                        onChange={(e) => emField.onChange(e.target.checked)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                    )}
                  />
                  <span>
                    {embedLabel ??
                      (isAr ? 'تضمين التوقيع المحفوظ' : 'Embed saved signature')}
                  </span>
                  {!!embedChecked && (
                    <span className="text-muted-foreground">
                      {isAr ? '(سيتم التضمين)' : '(will be embedded)'}
                    </span>
                  )}
                </label>
              )}
            </CardContent>
          </Card>
        )
      }}
    />
  )
}
