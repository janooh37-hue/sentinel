/**
 * The set of backing-document ids selected for a compose attachment toggle.
 * Book references that carry a `docId` are deduped in order-stable fashion.
 */
import type { ComposeReference } from './composeReference'
export function desiredRefPdfDocIds(
  references: ComposeReference[],
  attachRefPdf: boolean,
): number[] {
  if (!attachRefPdf) return []
  const ids: number[] = []
  for (const r of references) {
    if (r.kind === 'book' && typeof r.docId === 'number' && !ids.includes(r.docId)) {
      ids.push(r.docId)
    }
  }
  return ids
}

/**
 * Decode a base64 document body (from `?encoding=base64`, served as text/plain)
 * into a PDF File. Fetching the PDF as base64 text instead of binary keeps
 * Internet Download Manager from intercepting the `application/pdf` response —
 * the same IDM-bypass the Records film-strip viewer uses.
 */
export function base64PdfToFile(b64: string, fileName: string): File {
  const bin = atob(b64.trim())
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], fileName, { type: 'application/pdf' })
}

/** Manual files first, then ref-derived PDFs, deduped by name+size. */
export function mergeFiles(manual: File[], refPdfs: File[]): File[] {
  const out = [...manual]
  for (const f of refPdfs) {
    if (!out.some((x) => x.name === f.name && x.size === f.size)) out.push(f)
  }
  return out
}
