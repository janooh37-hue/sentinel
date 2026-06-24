/**
 * Lazy-loaded thumbnail tile for a vault file.
 *
 * PDFs and PNG/JPEG both go through the backend's `/preview` endpoint —
 * PDFs are rendered with PyMuPDF and cached server-side; images are streamed
 * back as-is. The browser then caches by URL, so re-renders are free.
 */

import { useState } from 'react'

import { api, type VaultEntry, type VaultKind } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  employeeId: string
  kind: VaultKind
  entry: VaultEntry
  className?: string
}

export function PdfThumbnail({
  employeeId,
  kind,
  entry,
  className,
}: Props): React.JSX.Element {
  const [errored, setErrored] = useState(false)
  const src = api.vaultPreviewUrl(employeeId, kind, entry.filename)
  return (
    <div
      className={cn(
        'flex h-32 w-24 items-center justify-center overflow-hidden rounded-md border border-border bg-muted',
        className,
      )}
    >
      {errored ? (
        <span className="px-2 text-center text-xs text-muted-foreground break-all">
          {entry.filename}
        </span>
      ) : (
        <img
          src={src}
          alt={entry.filename}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      )}
    </div>
  )
}
