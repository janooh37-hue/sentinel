/**
 * Builds the Records-pane film-strip list for one book:
 *   generated PDF (current version document) → signed copy → scans
 * (attachment_paths). Pure; consumed by RecordPaperViewer.
 *
 * URLs are relative API paths; the viewer appends `encoding=base64` itself
 * when fetching PDF bytes (IDM bypass — see DocPdfCanvas).
 */
import { currentBookDocId } from '@/lib/bookDocument'

export type PaperKind = 'generated' | 'signed' | 'scan' | 'imported'

export interface Paper {
  kind: PaperKind
  /** inline-view URL (no encoding param) */
  url: string
  /** URL for the <a download> action */
  downloadUrl: string
  filename: string
  isPdf: boolean
}

interface VersionLike {
  version_no: number
  document_id?: number | null
  status: string
  signed_pdf_url?: string | null
}

interface ImportedDocLike {
  pdf_url?: string | null
  download_url: string
  filename: string
}

interface BookLike {
  id: number
  ref_number: string
  attachment_paths?: string[] | null
  versions?: VersionLike[] | null
  imported_doc?: ImportedDocLike | null
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i

export function papersOf(book: BookLike): Paper[] {
  const papers: Paper[] = []

  const docId = currentBookDocId(book)
  if (docId !== undefined) {
    const url = `/api/v1/documents/${docId}/download?format=pdf`
    papers.push({
      kind: 'generated',
      url,
      downloadUrl: url,
      filename: `${book.ref_number}.pdf`,
      isPdf: true,
    })
  }

  // v3-imported record: the file lives in the employee vault (no generated
  // document). Show it as a paper only when a PDF rendition is viewable; the
  // docx-only case is offered as a download on the record page instead.
  if (book.imported_doc?.pdf_url) {
    papers.push({
      kind: 'imported',
      url: book.imported_doc.pdf_url,
      downloadUrl: book.imported_doc.download_url,
      filename: book.imported_doc.filename,
      isPdf: true,
    })
  }

  const versions = book.versions ?? []
  const current =
    versions.length > 0
      ? versions.reduce((a, b) => (b.version_no >= a.version_no ? b : a))
      : undefined
  if (current?.status === 'approved' && current.signed_pdf_url) {
    papers.push({
      kind: 'signed',
      url: current.signed_pdf_url,
      downloadUrl: current.signed_pdf_url,
      filename: `${book.ref_number}-signed.pdf`,
      isPdf: true,
    })
  }

  const attachments = book.attachment_paths ?? []
  attachments.forEach((path, index) => {
    const filename = path.split('/').pop() ?? `scan-${index}`
    const url = `/api/v1/books/${book.id}/attachments/${index}`
    papers.push({
      kind: 'scan',
      url,
      downloadUrl: url,
      filename,
      isPdf: !IMAGE_EXT.test(filename),
    })
  })

  return papers
}

/** Count papers without building URL strings — for per-row chips in long lists. */
export function paperCountOf(book: BookLike): number {
  const versions = book.versions ?? []
  const current =
    versions.length > 0
      ? versions.reduce((a, b) => (b.version_no >= a.version_no ? b : a))
      : undefined
  const generated = currentBookDocId(book) !== undefined ? 1 : 0
  const signed = current?.status === 'approved' && current.signed_pdf_url ? 1 : 0
  const imported = book.imported_doc?.pdf_url ? 1 : 0
  return generated + signed + imported + (book.attachment_paths?.length ?? 0)
}
