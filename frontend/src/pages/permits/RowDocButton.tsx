/**
 * RowDocButton — compact per-row attachment control for a person's UAE ID or a
 * vehicle's licence. Shows a preview chip when a scan is attached (with an
 * optional replace), or an upload button when it isn't. Purely presentational
 * over callbacks so it works for either entity.
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCheck2, Upload } from 'lucide-react'

interface Props {
  /** Attached scan filename, or null when nothing is attached. */
  docName: string | null
  /** Short noun for the document, e.g. "UAE ID" or "Licence". */
  label: string
  canManage: boolean
  busy?: boolean
  onUpload: (file: File) => void
  onPreview: () => void
}

export function RowDocButton({
  docName,
  label,
  canManage,
  busy = false,
  onUpload,
  onPreview,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const ref = useRef<HTMLInputElement>(null)

  const pick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ''
  }

  if (!docName && !canManage) return null

  return (
    <span className="inline-flex items-center gap-1">
      <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={pick} />
      {docName ? (
        <>
          <button
            type="button"
            onClick={onPreview}
            title={docName}
            className="inline-flex items-center gap-1 rounded-md bg-success-soft px-2 py-1 text-[0.7rem] font-medium text-success hover:brightness-95"
          >
            <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
          {canManage && (
            <button
              type="button"
              disabled={busy}
              onClick={() => ref.current?.click()}
              className="text-[0.7rem] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              {t('permits.paper.replace')}
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => ref.current?.click()}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border-strong px-2 py-1 text-[0.7rem] font-medium text-muted-foreground hover:border-ring hover:text-foreground disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden />
          {t('permits.doc.upload', { label })}
        </button>
      )}
    </span>
  )
}
