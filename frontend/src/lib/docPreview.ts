import type { DocViewerItem } from '@/components/ui/document-viewer-dialog'
import { api } from '@/lib/api'

export interface PreviewDoc {
  id: number
  name: string
}

export function generatedDocViewerItem(doc: PreviewDoc): DocViewerItem {
  const pdfUrl = api.documentDownloadUrl(doc.id, 'pdf')
  return {
    name: doc.name,
    kind: 'pdf',
    pdfBase64Url: `${pdfUrl}&encoding=base64`,
    openUrl: pdfUrl,
    downloadUrl: pdfUrl,
  }
}
