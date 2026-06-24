/**
 * ExtractionDropzone — file input / drag-and-drop trigger for OCR extraction.
 *
 * Props:
 *   expectedType — hint for the operator (e.g. 'emirates_id', 'bank_iban').
 *                  Not enforced client-side; the backend classifies the file.
 *   onExtracted  — called with the ExtractionResponse once OCR succeeds.
 *   capability   — optional override; defaults to 'documents.scan'.
 *
 * Behavior:
 *   - Gated behind <CapabilityGate cap="documents.scan"> — renders nothing if
 *     the user lacks the cap or while caps are loading.
 *   - Shows a loading spinner while the POST is in flight.
 *   - Surfaces errors via sonner toast and does not call onExtracted on error.
 *   - Accepts click-to-browse and drag-and-drop (image/* + application/pdf).
 *   - Honors prefers-reduced-motion (no CSS animations, transitions only).
 */

import { useRef, useState } from 'react'
import { Loader2, ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CapabilityGate } from '@/components/shell/CapabilityGate'
import { extractDocument, type ExtractionResponse } from '@/lib/extraction'

const ACCEPT = 'image/*,application/pdf'

export interface ExtractionDropzoneProps {
  expectedType?: string
  onExtracted: (r: ExtractionResponse) => void
  capability?: string
}

function Dropzone({
  expectedType,
  onExtracted,
}: Pick<ExtractionDropzoneProps, 'expectedType' | 'onExtracted'>): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [scanning, setScanning] = useState(false)

  async function runExtraction(file: File): Promise<void> {
    setScanning(true)
    try {
      const result = await extractDocument(file)
      onExtracted(result)
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes('OCR is not available')
          ? t('extraction.dropzone.errorUnavailable')
          : t('extraction.dropzone.errorGeneric')
      toast.error(message)
    } finally {
      setScanning(false)
    }
  }

  function handleFiles(files: FileList | null): void {
    const file = files?.[0]
    if (!file) return
    void runExtraction(file)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('extraction.dropzone.label')}
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
        // Reset the input so the same file can be re-selected.
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
            {t(`extraction.dropzone.hint.${expectedType ?? 'generic'}`, {
              defaultValue: t('extraction.dropzone.hint.generic'),
            })}
          </span>
        </>
      )}
    </div>
  )
}

export function ExtractionDropzone(props: ExtractionDropzoneProps): React.JSX.Element {
  const { expectedType, onExtracted, capability = 'documents.scan' } = props
  return (
    <CapabilityGate cap={capability}>
      <Dropzone expectedType={expectedType} onExtracted={onExtracted} />
    </CapabilityGate>
  )
}
