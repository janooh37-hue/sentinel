/** Shared PDF helpers for the base64 / IDM-safe download + decode path.
 *
 * Extracted from PdfViewer / DocPdfCanvas / RecordPaperViewer, which each had a
 * byte-identical copy. Pairs with the backend `maybe_base64` download shim. */

/** Append `encoding=base64` to a download URL so the backend returns the bytes
 * as text/plain (so Internet Download Manager / the browser PDF handler can't
 * hijack the download); pdf.js decodes them client-side via `base64ToBytes`. */
export function toBase64Url(url: string): string {
  return url.includes('?') ? `${url}&encoding=base64` : `${url}?encoding=base64`
}

/** Decode a base64 string to raw bytes for pdf.js `getDocument({ data })`. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}
