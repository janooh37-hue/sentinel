/**
 * FileDropzone — the Send-to-Group upload control (spec 2026-07-16).
 * Replaces the bare native file input: a clickable dashed dropzone that
 * swaps to a file card (name, size, Replace/Remove) once a file is chosen.
 * Owns the hidden <input type="file"> around the page's existing fileRef so
 * the FormData send path is unchanged. Drag & drop assigns the dropped
 * FileList to the input (browser-only; jsdom can't construct FileList).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Paperclip } from 'lucide-react'

function fmtSize(bytes: number): string {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function FileDropzone({
  fileRef,
  hasFile,
  fileName,
  fileSize,
  onFileChange,
  onClear,
}: {
  fileRef: React.RefObject<HTMLInputElement | null>
  hasFile: boolean
  fileName: string | null
  fileSize: number | null
  onFileChange: () => void
  onClear: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [drag, setDrag] = useState(false)

  return (
    <div className="mt-3">
      <input
        ref={fileRef}
        type="file"
        onChange={onFileChange}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />

      {!hasFile ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={t('sendToGroup.uploadZone.main')}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            if (e.dataTransfer.files.length > 0 && fileRef.current) {
              fileRef.current.files = e.dataTransfer.files
              onFileChange()
            }
          }}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
            drag
              ? 'border-primary bg-primary/5'
              : 'border-border bg-surface-tinted hover:bg-primary/5'
          }`}
        >
          <Paperclip className="mx-auto mb-1.5 h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-[0.88em] font-semibold text-foreground">
            {t('sendToGroup.uploadZone.main')}
          </p>
          <p className="mt-0.5 text-[0.78em] text-muted-foreground">
            {t('sendToGroup.uploadZone.hint')}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10">
            <FileText className="h-4.5 w-4.5 text-primary" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.85em] font-semibold text-foreground" dir="ltr">
              {fileName}
            </p>
            <p className="text-[0.78em] text-muted-foreground">
              <span className="font-semibold text-green-600 dark:text-green-400">
                ✓ {t('sendToGroup.uploadZone.ready')}
              </span>
              {fileSize !== null && <> · {fmtSize(fileSize)}</>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-border px-3 py-1.5 text-[0.8em] font-medium text-foreground hover:bg-surface-tinted"
          >
            {t('sendToGroup.uploadZone.replace')}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-accent/40 px-3 py-1.5 text-[0.8em] font-medium text-accent hover:bg-accent/10"
          >
            {t('sendToGroup.uploadZone.remove')}
          </button>
        </div>
      )}
    </div>
  )
}
