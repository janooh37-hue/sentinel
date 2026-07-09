/**
 * Builds the Records-pane film-strip list for one book:
 *   generated PDF (current version document) → signed copy → scans
 * (attachment_paths). Pure; consumed by RecordPaperViewer.
 *
 * URLs are relative API paths; the viewer appends `encoding=base64` itself
 * when fetching PDF bytes (IDM bypass — see DocPdfCanvas).
 */
import { currentBookDocId } from '@/lib/bookDocument'

export type PaperKind = 'generated' | 'companion' | 'signed' | 'scan' | 'imported'

export interface Paper {
  kind: PaperKind
  /** inline-view URL (no encoding param) */
  url: string
  /** URL for the <a download> action */
  downloadUrl: string
  filename: string
  isPdf: boolean
  /** index into `attachment_paths` — set only on `kind: 'scan'`, so the viewer
   * can wire delete/replace to the attachment endpoints. */
  attachmentIndex?: number
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

interface CompanionDocLike {
  document_id: number
  filename: string
}

interface BookLike {
  id: number
  ref_number: string
  attachment_paths?: string[] | null
  versions?: VersionLike[] | null
  imported_doc?: ImportedDocLike | null
  companion_docs?: CompanionDocLike[] | null
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i

export function papersOf(book: BookLike): Paper[] {
  const papers: Paper[] = []

  const docId = currentBookDocId(book)
  if (docId !== undefined) {
    // Always request the pre-signature original: once a signed copy is filed the
    // plain download URL swaps to serving the signed artifact, which would hide
    // the original form. `original=true` keeps this paper showing the real form
    // in every state; the signed copy gets its own paper below.
    const url = `/api/v1/documents/${docId}/download?format=pdf&original=true`
    papers.push({
      kind: 'generated',
      url,
      downloadUrl: url,
      filename: `${book.ref_number}.pdf`,
      isPdf: true,
    })
  }

  // Companion documents (annual-leave Undertaking, resignation Declaration) are
  // generated alongside the primary form but filed as separate Document rows, so
  // they get their own papers right after the original form.
  const companions = book.companion_docs ?? []
  companions.forEach((comp) => {
    const url = `/api/v1/documents/${comp.document_id}/download?format=pdf`
    papers.push({
      kind: 'companion',
      url,
      downloadUrl: url,
      filename: comp.filename,
      isPdf: true,
    })
  })

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
      attachmentIndex: index,
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
  const companions = book.companion_docs?.length ?? 0
  return generated + companions + signed + imported + (book.attachment_paths?.length ?? 0)
}
