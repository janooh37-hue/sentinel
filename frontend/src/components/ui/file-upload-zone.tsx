/**
 * FileUploadZone — generic drag-and-drop + click-to-browse file input.
 *
 * Modeled on ExtractionDropzone but content-agnostic: pass `accept`, `onFile`,
 * and a `label`. Shows a spinner when `busy`. Honors prefers-reduced-motion
 * (transitions only, no keyframe animations on the idle icon).
 */

import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface FileUploadZoneProps {
  accept: string
  onFile: (file: File) => void | Promise<void>
  label: string
  hint?: string
  busy?: boolean
  busyLabel?: string
  disabled?: boolean
}

export function FileUploadZone({
  accept,
  onFile,
  label,
  hint,
  busy = false,
  busyLabel,
  disabled = false,
}: FileUploadZoneProps): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const blocked = busy || disabled

  function handleFiles(files: FileList | null): void {
    const file = files?.[0]
    if (file) void onFile(file)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => !blocked && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !blocked) {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!blocked) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!blocked) handleFiles(e.dataTransfer.files)
      }}
      className={[
        'flex cursor-pointer flex-col items-center justify-center gap-1.5',
        'rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        dragging
          ? 'border-primary bg-primary-soft'
          : 'border-border hover:border-primary hover:bg-surface-tinted',
        blocked ? 'pointer-events-none opacity-70' : '',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => handleFiles(e.target.files)}
        onClick={(e) => {
          ;(e.target as HTMLInputElement).value = ''
        }}
      />
      {busy ? (
        <>
          <Loader2
            role="status"
            aria-label={busyLabel ?? t('common.loading')}
            strokeWidth={2}
            className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none"
          />
          <span className="text-xs text-muted-foreground">
            {busyLabel ?? t('common.loading')}
          </span>
        </>
      ) : (
        <>
          <Upload
            aria-hidden
            strokeWidth={1.75}
            className={dragging ? 'h-5 w-5 text-primary' : 'h-5 w-5 text-muted-foreground'}
          />
          <span className="text-sm font-medium text-foreground">{label}</span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </>
      )}
    </div>
  )
}
