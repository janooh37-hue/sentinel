/**
 * Builds the film-strip list for one record, in the order
 *   signed → generated (original) → imported → scans
 * (attachment_paths). Pure; consumed by RecordPaperViewer and the record
 * surfaces. Selection is always by `PaperKey`, never by index.
 *
 * URLs are relative API paths; the viewer appends `encoding=base64` itself
 * when fetching PDF bytes (IDM bypass — see DocPdfCanvas).
 */
import { api, type ApprovalLogItem } from '@/lib/api'
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

interface BookLike {
  id: number
  ref_number: string
  approval_state?: string | null
  attachment_paths?: string[] | null
  versions?: VersionLike[] | null
  imported_doc?: ImportedDocLike | null
  /** Advances on signed-copy replace/removal and included-papers save. */
  included_papers_revision?: number | null
}

/** Appends one query param, whichever of `?` / `&` the URL needs. */
function withParam(url: string, name: string, value: string | number): string {
  return `${url}${url.includes('?') ? '&' : '?'}${name}=${value}`
}

/** FNV-1a (32-bit) as hex: a short, stable content token for a stored path. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i

/** Stable identity of a paper: `?paper=<key>` and selection state use it. */
export type PaperKey = 'signed' | 'generated' | 'imported' | `scan-${number}`

/**
 * `scan-N` uses the `attachment_paths` index, so deleting an earlier scan shifts
 * the keys of the scans after it. The scan URL carries a hash of the stored
 * path, so the shifted paper is a new URL (and a new PDF cache entry).
 */
export function paperKey(p: Pick<Paper, 'kind' | 'attachmentIndex'>): PaperKey {
  return p.kind === 'scan' ? `scan-${p.attachmentIndex ?? 0}` : p.kind
}

/**
 * The one builder for a record document's inline/download URL.
 * `signed` appends a `rev` marker: the plain URL is identical before and after
 * signing (the server swaps in the signed artifact once the version is locked),
 * so without it the canvas keeps the cached unsigned bytes. `revision` (the
 * book's `included_papers_revision`) is folded into the same `rev` value so the
 * URL changes whenever the package does; the server ignores it.
 */
export function paperUrl({
  documentId,
  versionId,
  original,
  signed,
  revision,
}: {
  documentId: number
  versionId?: number | null
  original?: boolean
  signed?: boolean
  revision?: number | null
}): string {
  const url = api.documentDownloadUrl(documentId, 'pdf', versionId ?? undefined, original)
  const rev = [signed ? 'signed' : null, revision ?? null].filter((part) => part !== null).join('-')
  return rev ? withParam(url, 'rev', rev) : url
}

/** The newest version (highest `version_no`), whatever order the API sent. */
export function currentVersionOf<V extends VersionLike>(book: { versions?: V[] | null }): V | undefined {
  const versions = book.versions ?? []
  return versions.length > 0
    ? versions.reduce((a, b) => (b.version_no >= a.version_no ? b : a))
    : undefined
}

/**
 * @param opts.inmateReporter required, so every caller decides. For inmate
 *   reporters: every scan is dropped (the server does not hide attachments from
 *   this role), the generated original is dropped once a signed copy exists, and
 *   `original=true` is never emitted (the server answers 403 to it).
 */
export function papersOf(book: BookLike, opts: { inmateReporter: boolean }): Paper[] {
  const { inmateReporter } = opts
  const signedPapers: Paper[] = []
  const generatedPapers: Paper[] = []
  const importedPapers: Paper[] = []
  const scanPapers: Paper[] = []

  // `revision` keeps the signed and generated URLs moving when the signed copy
  // or the included-papers package changes under an otherwise identical URL.
  const revision = book.included_papers_revision
  const current = currentVersionOf(book)
  if (current?.status === 'approved' && current.signed_pdf_url) {
    const signedUrl =
      revision == null ? current.signed_pdf_url : withParam(current.signed_pdf_url, 'rev', revision)
    signedPapers.push({
      kind: 'signed',
      url: signedUrl,
      downloadUrl: signedUrl,
      filename: `${book.ref_number}-signed.pdf`,
      isPdf: true,
    })
  }

  const docId = currentBookDocId(book)
  if (docId !== undefined && !(inmateReporter && signedPapers.length > 0)) {
    // Staff always request the pre-signature original: once a signed copy is
    // filed the plain download URL swaps to serving the signed artifact, which
    // would hide the original form. The signed copy has its own paper.
    const url = paperUrl({ documentId: docId, original: !inmateReporter, revision })
    generatedPapers.push({
      kind: 'generated',
      url,
      downloadUrl: url,
      filename: `${book.ref_number}.pdf`,
      isPdf: true,
    })
  }

  // Companion documents (annual-leave Undertaking, resignation Declaration) are
  // NOT separate papers: the download endpoint appends their pages onto the
  // generated PDF above, so the record shows one merged document.

  // v3-imported record: the file lives in the employee vault (no generated
  // document). Show it as a paper only when a PDF rendition is viewable; the
  // docx-only case is offered as a download on the record page instead.
  if (book.imported_doc?.pdf_url) {
    importedPapers.push({
      kind: 'imported',
      url: book.imported_doc.pdf_url,
      downloadUrl: book.imported_doc.download_url,
      filename: book.imported_doc.filename,
      isPdf: true,
    })
  }

  if (!inmateReporter) {
    ;(book.attachment_paths ?? []).forEach((path, index) => {
      const filename = path.split('/').pop() ?? `scan-${index}`
      // The stored path is unique per upload, so replacing the file at this
      // index (or shifting the index) yields a new URL and a fresh cache entry.
      const url = withParam(`/api/v1/books/${book.id}/attachments/${index}`, 'v', shortHash(path))
      scanPapers.push({
        kind: 'scan',
        url,
        downloadUrl: url,
        filename,
        isPdf: !IMAGE_EXT.test(filename),
        attachmentIndex: index,
      })
    })
  }

  return [...signedPapers, ...generatedPapers, ...importedPapers, ...scanPapers]
}

/**
 * Which paper a record opens on: the signed copy once approved and filed;
 * otherwise the first non-signed paper (generated or imported).
 */
export function defaultPaperKey(
  book: Pick<BookLike, 'approval_state'>,
  papers: Paper[],
): PaperKey | null {
  if (book.approval_state === 'approved' && papers.some((p) => p.kind === 'signed')) return 'signed'
  const first = papers.find((p) => p.kind !== 'signed') ?? papers[0]
  return first ? paperKey(first) : null
}

/**
 * Papers for the approvals-log dialog, which works on a log item pinned to a
 * version rather than a `BookRead`. Approved: the version's signed artifact plus
 * the pre-signature original (never for inmate reporters). Otherwise: the
 * generated paper pinned to the version.
 */
export function approvalItemPapers(
  item: ApprovalLogItem,
  opts: { inmateReporter: boolean },
): Paper[] {
  const papers: Paper[] = []
  if (item.status === 'approved' && item.version_id != null) {
    const signedUrl = api.signedDocumentUrl(item.book_id, item.version_id)
    papers.push({
      kind: 'signed',
      url: signedUrl,
      downloadUrl: signedUrl,
      filename: `${item.ref_number}-signed.pdf`,
      isPdf: true,
    })
    if (item.document_id != null && !opts.inmateReporter) {
      const url = paperUrl({
        documentId: item.document_id,
        versionId: item.version_id,
        original: true,
      })
      papers.push({
        kind: 'generated',
        url,
        downloadUrl: url,
        filename: `${item.ref_number}.pdf`,
        isPdf: true,
      })
    }
    return papers
  }
  if (item.document_id != null) {
    const url = paperUrl({ documentId: item.document_id, versionId: item.version_id })
    papers.push({
      kind: 'generated',
      url,
      downloadUrl: url,
      filename: `${item.ref_number}.pdf`,
      isPdf: true,
    })
  }
  return papers
}

/** Changes whenever the record, its state or its paper set changes (resets viewer selection). */
export function paperResetSignature(book: Pick<BookLike, 'id' | 'approval_state'>, papers: Paper[]): string {
  return `${book.id}:${book.approval_state}:${papers.map(paperKey).join()}`
}

/**
 * Count papers without building URL strings — for per-row chips in long lists.
 * Mirrors `papersOf`, including its `inmateReporter` rules, so every surface
 * shows the number of papers the record pane will list.
 */
export function paperCountOf(book: BookLike, opts: { inmateReporter: boolean }): number {
  const current = currentVersionOf(book)
  const signed = current?.status === 'approved' && current.signed_pdf_url ? 1 : 0
  const generated =
    currentBookDocId(book) !== undefined && !(opts.inmateReporter && signed > 0) ? 1 : 0
  const imported = book.imported_doc?.pdf_url ? 1 : 0
  const scans = opts.inmateReporter ? 0 : (book.attachment_paths?.length ?? 0)
  return generated + signed + imported + scans
}
