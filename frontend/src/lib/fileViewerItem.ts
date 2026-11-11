import type { DocViewerItem } from '@/components/ui/document-viewer-dialog'
import { fileKindFromName } from '@/lib/fileTypes'
import { toBase64Url } from '@/lib/pdf'

export interface ViewerFile {
  name: string
  mediaType: string
  url: string
}

/**
 * A stored attachment as `DocumentViewerDialog` wants it. PDFs (by media type
 * or, failing that, by name) go through `?encoding=base64` because the
 * WebView2/IDM handler hijacks a raw PDF response; images are linked directly,
 * which the API serves `Content-Disposition: inline`.
 */
export function fileViewerItem({ name, mediaType, url }: ViewerFile): DocViewerItem {
  const nameKind = fileKindFromName(name)
  const isPdf = mediaType === 'application/pdf' || nameKind === 'pdf'
  return {
    name,
    kind: isPdf ? 'pdf' : nameKind,
    imageUrl: isPdf ? undefined : url,
    pdfBase64Url: isPdf ? toBase64Url(url) : undefined,
    openUrl: url,
    downloadUrl: url,
  }
}
