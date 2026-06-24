/**
 * SignatureDrawPanel — shared draw-pad block for employee signatures.
 *
 * Used by the on-form EmployeeSignatureCard (no-signature state + Replace
 * mode) and the profile signature manager. Emits a PNG data URL via onUse;
 * the caller decides what "use" means (bind to the form, upload, both).
 */
import { useCallback, useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { SIGNATURE_PEN } from '@/components/signature/penConfig'

export interface SignatureDrawPanelProps {
  onUse: (dataUrl: string, saveToProfile: boolean) => void
  /** Show the "Save to profile" toggle (default true, starts ticked). */
  showSaveToProfile?: boolean
  onCancel?: () => void
  busy?: boolean
}

export function SignatureDrawPanel({
  onUse,
  showSaveToProfile = true,
  onCancel,
  busy = false,
}: SignatureDrawPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const padRef = useRef<SignatureCanvas | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [width, setWidth] = useState(0)
  const [saveToProfile, setSaveToProfile] = useState(true)

  // Callback-ref ResizeObserver — same proven pattern as SignatureField.
  // Rewires the instant the wrapper DOM node changes, which a one-shot
  // useEffect misses when the node is swapped (e.g. Replace mode flip).
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
      setWidth(Math.floor(entries[0]?.contentRect.width ?? 0))
    })
    ro.observe(node)
    observerRef.current = ro
  }, [])

  const save = (): void => {
    const pad = padRef.current
    if (!pad || pad.isEmpty()) return
    onUse(
      pad.getCanvas().toDataURL('image/png'),
      showSaveToProfile ? saveToProfile : false,
    )
  }

  const clear = (): void => {
    padRef.current?.clear()
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      toast.error(t('empSig.uploadBadType'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUse(reader.result, showSaveToProfile ? saveToProfile : false)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-2.5">
      <div
        ref={setWrapRef}
        className="w-full overflow-hidden rounded-md border border-dashed border-border-strong bg-surface-raised"
      >
        {width > 0 && (
          <SignatureCanvas
            ref={padRef}
            {...SIGNATURE_PEN}
            canvasProps={{
              width,
              height: 160,
              'aria-label': t('empSig.drawHint'),
            }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={busy}>
          {t('empSig.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={busy}
        >
          {t('empSig.clear')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {t('empSig.upload')}
        </Button>
        <input
          ref={fileRef}
          data-testid="sig-upload-input"
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={onFile}
        />
        {showSaveToProfile && (
          <label className="ms-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={saveToProfile}
              onChange={(e) => setSaveToProfile(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
              aria-label={t('empSig.saveToProfile')}
            />
            {t('empSig.saveToProfile')}
          </label>
        )}
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className={showSaveToProfile ? '' : 'ms-auto'}
            disabled={busy}
          >
            {t('empSig.cancel')}
          </Button>
        )}
      </div>
    </div>
  )
}
