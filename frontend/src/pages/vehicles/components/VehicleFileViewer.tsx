/**
 * Vehicle attachments on screen: a thumbnail that opens the shared lightbox.
 *
 * `VehicleFileThumb` is the one clickable tile the module uses everywhere a
 * stored file appears — the main photo, the license scan, a gallery photo, an
 * accident photo strip, a maintenance receipt. `VehicleFileViewer` wraps
 * `DocumentViewerDialog` (zoom / rotate / arrow keys / download, all local) and
 * is what the tile opens; pages may also mount it directly.
 *
 * URLs come from `api.vehicleFileUrl`, and PDFs are read through
 * `?encoding=base64` so the WebView2/IDM PDF handler cannot hijack them.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FileTypeIcon } from '@/components/ledger/FileTypeIcon'
import { DocumentViewerDialog } from '@/components/ui/document-viewer-dialog'
import { api } from '@/lib/api'
import type { VehicleFileRead } from '@/lib/api'
import { fileKindFromName } from '@/lib/fileTypes'
import { cn } from '@/lib/utils'

import { fileLabel, vehicleFileViewerItem } from '../vehicleUtils'

interface ViewerProps {
  vehicleId: number
  /** The set the operator can arrow through. */
  files: readonly VehicleFileRead[]
  startIndex?: number
  onClose: () => void
}

export function VehicleFileViewer({
  vehicleId,
  files,
  startIndex = 0,
  onClose,
}: ViewerProps): React.JSX.Element | null {
  if (files.length === 0) return null
  return (
    <DocumentViewerDialog
      items={files.map((file) => vehicleFileViewerItem(file, api.vehicleFileUrl(vehicleId, file.id)))}
      startIndex={Math.min(Math.max(startIndex, 0), files.length - 1)}
      onClose={onClose}
    />
  )
}

interface ThumbProps {
  vehicleId: number
  file: VehicleFileRead
  /**
   * The other files of the same set, in order. Passing them lets the lightbox
   * page through the whole gallery from any tile; omit for a lone attachment.
   */
  siblings?: readonly VehicleFileRead[]
  /** Tailwind box classes for the tile (defaults to the 54×38 photo strip). */
  className?: string
  /** Shown under the image; the gallery labels its tiles, a strip does not. */
  showLabel?: boolean
}

export function VehicleFileThumb({
  vehicleId,
  file,
  siblings,
  className,
  showLabel = false,
}: ThumbProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const label = fileLabel(file, i18n.language)
  const isImage = file.media_type.startsWith('image/')
  const set = siblings && siblings.length > 0 ? siblings : [file]
  const startIndex = set.findIndex((candidate) => candidate.id === file.id)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        className={cn(
          'group flex flex-col items-stretch overflow-hidden rounded-lg border border-border bg-surface-raised',
          'transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          className ?? 'h-[38px] w-[54px]',
        )}
      >
        {isImage ? (
          <img
            src={api.vehicleFileUrl(vehicleId, file.id)}
            alt={label}
            loading="lazy"
            className="min-h-0 w-full flex-1 object-cover"
          />
        ) : (
          <span className="flex min-h-0 w-full flex-1 items-center justify-center gap-1.5 p-1.5">
            <FileTypeIcon kind={fileKindFromName(file.original_name)} size={22} />
            <span className="sr-only">{t('vehicles.scanPreview')}</span>
          </span>
        )}
        {showLabel && (
          <span className="truncate border-t border-hairline px-2 py-1 text-[0.68em] text-muted-foreground" dir="auto">
            {label}
          </span>
        )}
      </button>
      {open && (
        <VehicleFileViewer
          vehicleId={vehicleId}
          files={set}
          startIndex={startIndex < 0 ? 0 : startIndex}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
